import { randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { brotliCompressSync, constants as zlibConstants, gzipSync } from 'node:zlib'

import { createFontBaker, type FontBakeDescriptorV0 } from '@pmndrs/text-font-baker'
import { validateFontArtifact } from '@pmndrs/text-font-baker/validate'

import type {
  AnyRasterBakerModule,
  BakeArtifactV0,
  BakeWarning,
  FontPayloadReport,
  RasterBakePlan,
} from '../bake.js'
import {
  discoverProjectFonts,
  type DiscoveryDiagnostic,
  type DiscoveredFontDefinition,
  type DiscoveryOptions,
  type ResolvedRasterBaker,
} from '../discovery.js'
import { composeFontBake } from '../internal/compose-bake.js'
import { deriveRasterKey } from '../internal/raster-identity.js'
import type { Sha256Hex } from '../identity.js'
import type { JsonValue } from '../raster.js'

export interface NodeBakeOptions<
  Rasters extends readonly RasterBakePlan<AnyRasterBakerModule>[] =
    readonly RasterBakePlan<AnyRasterBakerModule>[],
> {
  readonly input: string | URL
  readonly output: string | URL
  readonly font: Omit<FontBakeDescriptorV0, 'formatVersion'>
  readonly rasters?: Rasters
  readonly signal?: AbortSignal
}

type CheckedRasterPlans<Plans extends readonly RasterBakePlan<AnyRasterBakerModule>[]> = {
  readonly [Index in keyof Plans]: Plans[Index] extends {
    readonly baker: infer Module extends AnyRasterBakerModule
  }
    ? RasterBakePlan<Module>
    : never
}

export interface NodeBakeExecutionReport {
  readonly timingsMs: {
    readonly read: number
    readonly coreBake: number
    readonly rasterBake: number
    readonly compose: number
    readonly validate: number
    readonly transport: number
    readonly write: number
    readonly total: number
  }
  readonly memory: {
    readonly rssBeforeBytes: number
    readonly rssAfterBytes: number
    /** Process-lifetime peak reported by Node, not an isolated-operation allocation claim. */
    readonly processMaxRssBytes: number
  }
  readonly outputs: readonly {
    readonly role: BakeArtifactV0['role']
    readonly file: string
    readonly bytes: number
    readonly sha256: string
  }[]
}

export interface NodeFontBakeReport extends FontPayloadReport {
  readonly execution: NodeBakeExecutionReport
}

export interface ProjectBakeOptions extends DiscoveryOptions {
  readonly outputRoot?: string | URL
}

export interface ProjectBakeMapping {
  readonly expression: string
  readonly sourceFile: string
  readonly assetRoot: string
  readonly publicPathname: string
  readonly outputFile: string
}

export interface ProjectBakeDiagnostic extends BakeWarning {
  readonly sourceFile: string
  readonly expression: string
}

export interface ProjectBakeReport {
  readonly fonts: readonly NodeFontBakeReport[]
  readonly mappings: readonly ProjectBakeMapping[]
  readonly diagnostics: readonly ProjectBakeDiagnostic[]
}

export class NodeBakeError extends Error {
  readonly code: string
  readonly path: string | undefined

  constructor(code: string, message: string, path?: string) {
    super(message)
    this.name = 'NodeBakeError'
    this.code = code
    this.path = path
  }
}

let fontBakerPromise: ReturnType<typeof createFontBaker> | undefined

export async function bakeFont<
  const Rasters extends readonly RasterBakePlan<AnyRasterBakerModule>[],
>(
  options: NodeBakeOptions<Rasters> & { readonly rasters?: CheckedRasterPlans<Rasters> },
): Promise<NodeFontBakeReport> {
  const started = performance.now()
  const rssBeforeBytes = process.memoryUsage.rss()
  const timings = {
    read: 0,
    coreBake: 0,
    rasterBake: 0,
    compose: 0,
    validate: 0,
    transport: 0,
    write: 0,
  }
  options.signal?.throwIfAborted()
  const input = filePath(options.input, 'input')
  const output = filePath(options.output, 'output')
  if (resolve(input) === resolve(output)) {
    throw new NodeBakeError(
      'OUTPUT_OVERLAPS_INPUT',
      'font output must not overwrite its source',
      output,
    )
  }

  let phase = performance.now()
  const source = new Uint8Array(await readFile(input))
  timings.read = performance.now() - phase
  options.signal?.throwIfAborted()

  phase = performance.now()
  const fontBaker = await defaultFontBaker()
  const core = fontBaker.bake({
    source,
    descriptor: { formatVersion: 0, fontFaceIndex: options.font.fontFaceIndex },
  })
  timings.coreBake = performance.now() - phase
  options.signal?.throwIfAborted()

  phase = performance.now()
  const coreValidation = await validateFontArtifact(core.artifacts[0]!.bytes)
  timings.validate += performance.now() - phase
  const rasterInputs = []
  for (const plan of options.rasters ?? []) {
    options.signal?.throwIfAborted()
    const descriptor = plan.baker.descriptor(plan.options) as JsonValue
    const rasterKey = await deriveRasterKey({
      descriptor,
      extension: plan.baker.extension,
      kind: plan.baker.kind,
      version: plan.baker.version,
    })
    const raster = await plan.baker.bake({
      font: {
        source,
        fontFaceIndex: options.font.fontFaceIndex,
        glyphCount: coreValidation.glyphCount,
        shapingHash: coreValidation.shapingHash as Sha256Hex,
      },
      rasterKey,
      packaging: plan.packaging,
      descriptor,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
    rasterInputs.push({ raster, packaging: plan.packaging })
  }
  timings.rasterBake = performance.now() - phase

  phase = performance.now()
  const composed = await composeFontBake(core, rasterInputs)
  timings.compose = performance.now() - phase
  options.signal?.throwIfAborted()

  phase = performance.now()
  await validateFontArtifact(composed.artifacts[0]!.bytes)
  timings.validate += performance.now() - phase
  phase = performance.now()
  const report = finalizeTransport(composed.report, composed.artifacts)
  timings.transport = performance.now() - phase

  phase = performance.now()
  const outputs = outputTargets(output, composed.artifacts)
  await publishArtifactsWithRollback(outputs, options.signal)
  timings.write = performance.now() - phase
  const rssAfterBytes = process.memoryUsage.rss()
  return {
    ...report,
    execution: {
      timingsMs: { ...timings, total: performance.now() - started },
      memory: {
        rssBeforeBytes,
        rssAfterBytes,
        processMaxRssBytes: process.resourceUsage().maxRSS * 1024,
      },
      outputs: outputs.map(({ artifact, file }) => ({
        role: artifact.role,
        file,
        bytes: artifact.bytes.byteLength,
        sha256: artifact.sha256,
      })),
    },
  }
}

export async function bakeProject(options: ProjectBakeOptions = {}): Promise<ProjectBakeReport> {
  options.signal?.throwIfAborted()
  const discovery = await discoverProjectFonts(options)
  const projectRoot = await canonicalProjectRoot(options.projectRoot)
  const outputRoot =
    options.outputRoot === undefined
      ? undefined
      : resolve(projectRoot, filePath(options.outputRoot, 'outputRoot'))
  const groups = groupDefinitions(discovery.fonts, outputRoot)
  const fonts: NodeFontBakeReport[] = []
  for (const group of groups) {
    options.signal?.throwIfAborted()
    const plans = await loadProjectPlans(group.rasters)
    fonts.push(
      await bakeFont({
        input: group.input,
        output: group.output,
        font: { fontFaceIndex: 0 },
        rasters: plans,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      }),
    )
  }
  const outputs = new Map(groups.map((group) => [group.input, group.output]))
  return {
    fonts,
    mappings: discovery.fonts.map((font) => ({
      expression: font.expression,
      sourceFile: font.sourceFile,
      assetRoot: font.assetRoot,
      publicPathname: font.publicPathname,
      outputFile: outputs.get(font.resolvedFile)!,
    })),
    diagnostics: discovery.diagnostics.map(mapDiagnostic),
  }
}

interface ProjectGroup {
  readonly input: string
  readonly output: string
  readonly rasters: readonly ResolvedRasterBaker[]
}

function groupDefinitions(
  fonts: readonly DiscoveredFontDefinition[],
  outputRoot: string | undefined,
): ProjectGroup[] {
  const groups = new Map<string, { output: string; rasters: Map<string, ResolvedRasterBaker> }>()
  for (const font of fonts) {
    const output = outputPath(font, outputRoot)
    const group = groups.get(font.resolvedFile) ?? { output, rasters: new Map() }
    if (group.output !== output) {
      throw new NodeBakeError(
        'OUTPUT_CONFLICT',
        'one source resolved to conflicting output paths',
        output,
      )
    }
    const key = `${font.raster.specifier}\0${JSON.stringify(font.raster.options)}`
    group.rasters.set(key, font.raster)
    groups.set(font.resolvedFile, group)
  }
  return [...groups]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([input, group]) => ({
      input,
      output: group.output,
      rasters: [...group.rasters.values()].sort((left, right) =>
        left.specifier.localeCompare(right.specifier),
      ),
    }))
}

async function loadRasterPlan(
  raster: ResolvedRasterBaker,
): Promise<RasterBakePlan<AnyRasterBakerModule>> {
  const namespace = await import(pathToFileURL(raster.resolvedFile).href)
  const baker = namespace.default
  if (!isRasterBaker(baker) || baker.kind !== raster.kind) {
    throw new NodeBakeError(
      'INVALID_RASTER_BAKER',
      `${raster.specifier} default export is not the declared ${raster.kind} ESM baker`,
      raster.resolvedFile,
    )
  }
  return {
    baker,
    packaging: { artifact: 'embedded', pages: 'embedded' },
    options: raster.options,
  }
}

async function loadProjectPlans(
  rasters: readonly ResolvedRasterBaker[],
): Promise<RasterBakePlan<AnyRasterBakerModule>[]> {
  const loaded = await Promise.all(rasters.map(loadRasterPlan))
  const keyed = await Promise.all(
    loaded.map(async (plan) => ({
      plan,
      key: await deriveRasterKey({
        descriptor: plan.baker.descriptor(plan.options) as JsonValue,
        extension: plan.baker.extension,
        kind: plan.baker.kind,
        version: plan.baker.version,
      }),
    })),
  )
  keyed.sort(
    (left, right) =>
      left.plan.baker.extension.localeCompare(right.plan.baker.extension) ||
      left.key.localeCompare(right.key),
  )
  const embeddedExtensions = new Set<string>()
  return keyed.map(({ plan }) => {
    const embedded = !embeddedExtensions.has(plan.baker.extension)
    embeddedExtensions.add(plan.baker.extension)
    return {
      ...plan,
      packaging: { artifact: embedded ? 'embedded' : 'external', pages: 'embedded' },
    }
  })
}

function isRasterBaker(value: unknown): value is AnyRasterBakerModule {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<AnyRasterBakerModule>
  return (
    typeof candidate.kind === 'string' &&
    typeof candidate.extension === 'string' &&
    Number.isSafeInteger(candidate.version) &&
    typeof candidate.descriptor === 'function' &&
    typeof candidate.bake === 'function'
  )
}

function outputPath(font: DiscoveredFontDefinition, outputRoot: string | undefined): string {
  const sourceRelative = relative(font.assetRoot, font.resolvedFile)
  if (
    sourceRelative === '..' ||
    sourceRelative.startsWith(`..${sep}`) ||
    isAbsolute(sourceRelative)
  ) {
    throw new NodeBakeError('SOURCE_OUTSIDE_ASSET_ROOT', 'resolved font escaped its asset root')
  }
  const base = outputRoot === undefined ? font.assetRoot : outputRoot
  return join(base, bakedSiblingPath(sourceRelative))
}

function bakedSiblingPath(path: string): string {
  const extension = extname(path)
  return /\.(?:ttf|otf|woff2?)$/i.test(extension)
    ? `${path.slice(0, -extension.length)}.font.glb`
    : `${path}.font.glb`
}

async function defaultFontBaker() {
  fontBakerPromise ??= Promise.resolve(
    import.meta.resolve('@pmndrs/text-font-baker/font-baker.wasm'),
  )
    .then((url) => readFile(new URL(url)))
    .then(createFontBaker)
  return fontBakerPromise
}

function outputTargets(
  fontOutput: string,
  artifacts: readonly BakeArtifactV0[],
): readonly { artifact: BakeArtifactV0; file: string }[] {
  const directory = dirname(fontOutput)
  const targets = artifacts.map((artifact) => {
    if (artifact.role === 'font') return { artifact, file: fontOutput }
    if (
      artifact.id === '' ||
      artifact.id === '.' ||
      artifact.id === '..' ||
      artifact.id.includes('\0') ||
      artifact.id !== artifact.id.split(/[\\/]/).at(-1)
    ) {
      throw new NodeBakeError(
        'UNSAFE_ARTIFACT_ID',
        'artifact ID must be a single filename',
        artifact.id,
      )
    }
    return { artifact, file: join(directory, artifact.id) }
  })
  const files = new Set<string>()
  for (const target of targets) {
    const canonical = resolve(target.file)
    if (files.has(canonical)) {
      throw new NodeBakeError(
        'OUTPUT_CONFLICT',
        'multiple artifacts resolve to one output',
        canonical,
      )
    }
    files.add(canonical)
  }
  return targets
}

interface StagedArtifactOutput {
  readonly temporaryFile: string
  readonly target: string
  backupFile?: string
  published: boolean
}

async function publishArtifactsWithRollback(
  outputs: readonly { artifact: BakeArtifactV0; file: string }[],
  signal?: AbortSignal,
): Promise<void> {
  const staged: StagedArtifactOutput[] = []
  let publicationCompleted = false
  let rollbackCompleted = false
  try {
    for (const { artifact, file } of outputs) {
      signal?.throwIfAborted()
      await mkdir(dirname(file), { recursive: true })
      const temporaryFile = join(dirname(file), `.${file.split(sep).at(-1)}.${randomUUID()}.tmp`)
      staged.push({ temporaryFile, target: file, published: false })
      const handle = await open(temporaryFile, 'wx')
      try {
        await handle.writeFile(artifact.bytes)
        await handle.sync()
      } finally {
        await handle.close()
      }
    }
    signal?.throwIfAborted()
    for (const entry of staged) await preservePreviousTarget(entry)
    for (const entry of staged) {
      await rename(entry.temporaryFile, entry.target)
      entry.published = true
    }
    publicationCompleted = true
  } catch (error) {
    try {
      await rollbackPublication(staged)
      rollbackCompleted = true
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        'artifact publication failed and rollback was incomplete',
      )
    }
    throw error
  } finally {
    await Promise.all(
      staged.flatMap(({ temporaryFile, backupFile }) => [
        rm(temporaryFile, { force: true }),
        ...(backupFile === undefined || (!publicationCompleted && !rollbackCompleted)
          ? []
          : [rm(backupFile, { force: true })]),
      ]),
    )
  }
}

async function preservePreviousTarget(entry: StagedArtifactOutput): Promise<void> {
  try {
    const previous = await lstat(entry.target)
    if (previous.isDirectory()) return
    if (!previous.isFile()) {
      throw new NodeBakeError(
        'OUTPUT_TARGET_TYPE',
        'existing artifact output must be a regular file',
        entry.target,
      )
    }
    const backupFile = join(
      dirname(entry.target),
      `.${entry.target.split(sep).at(-1)}.${randomUUID()}.bak`,
    )
    await rename(entry.target, backupFile)
    entry.backupFile = backupFile
  } catch (error) {
    if (isMissing(error)) return
    throw error
  }
}

async function rollbackPublication(staged: readonly StagedArtifactOutput[]): Promise<void> {
  const failures: unknown[] = []
  for (const entry of [...staged].reverse()) {
    try {
      if (entry.published) await rm(entry.target, { force: true })
      if (entry.backupFile !== undefined) {
        await rename(entry.backupFile, entry.target)
        delete entry.backupFile
      }
    } catch (error) {
      failures.push(error)
    }
  }
  if (failures.length !== 0) {
    throw new AggregateError(failures, 'failed to restore pre-existing artifact outputs')
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function finalizeTransport(
  report: FontPayloadReport,
  artifacts: readonly BakeArtifactV0[],
): FontPayloadReport {
  return {
    ...report,
    transport: artifacts.flatMap(({ id, role, bytes }) => {
      const raw = { artifactId: id, format: 'raw', bytes: bytes.byteLength }
      if (role === 'raster-page') return [raw]
      return [
        raw,
        { artifactId: id, format: 'gzip', bytes: gzipSync(bytes, { level: 9 }).byteLength },
        {
          artifactId: id,
          format: 'brotli',
          bytes: brotliCompressSync(bytes, {
            params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 },
          }).byteLength,
        },
      ]
    }),
  }
}

function mapDiagnostic(diagnostic: DiscoveryDiagnostic): ProjectBakeDiagnostic {
  return {
    code: diagnostic.code,
    message: diagnostic.message,
    path: diagnostic.sourceFile,
    sourceFile: diagnostic.sourceFile,
    expression: diagnostic.expression,
  }
}

async function canonicalProjectRoot(value: string | URL | undefined): Promise<string> {
  const candidate = value === undefined ? process.cwd() : filePath(value, 'projectRoot')
  return resolve(candidate)
}

function filePath(value: string | URL, field: string): string {
  if (value instanceof URL) {
    if (value.protocol !== 'file:') {
      throw new NodeBakeError('NON_FILE_URL', `${field} must be a file URL`, value.href)
    }
    return fileURLToPath(value)
  }
  return value
}
