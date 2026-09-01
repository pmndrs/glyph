import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { brotliCompressSync, constants as zlibConstants, gzipSync } from 'node:zlib';

import {
  createFontBaker,
  type FontBakeDescriptor,
  type FontInspection,
  type PreparedFontReport,
  type UnicodeRange,
} from '../font-baker/index.js';
import { fontBakerWasmUrl } from '../font-baker/wasm-url.js';
import { validateFontArtifact } from '../font-baker/validator.js';
import { GlyphError } from '../glyph-error.js';

export {
  FontBakeError,
  createFontBaker,
  createFontBakerFromInstance,
  fontBakerAbi,
  type FontBakeCore,
  type FontBakeDescriptor,
  type FontBakeRequest,
  type FontBakeResult,
  type FontBakerAbi,
  type FontBakerWasmSource,
  type SerializedBakeError,
} from '../font-baker/index.js';
export { fontBakerWasmUrl } from '../font-baker/wasm-url.js';
export * from '../font-baker/validator.js';

import type { BakeArtifact, BakeWarning, FontPayloadReport, RasterBakePlan, RasterBakerModule } from '../bake.js';
import type { JsonValue } from '../raster.js';
import type { Fingerprint } from '../identity.js';
import type {
  DiscoveryDiagnostic,
  DiscoveredFontDefinition,
  DiscoveryOptions,
  ResolvedRasterBaker,
} from '../discovery.js';
import { fontBakeDescriptor } from '../internal/core-bake-policy.js';
import { bakeFontPipeline } from '../internal/font-bake-pipeline.js';
import { resolveRasterBakePlan, type ResolvedRasterBakePlan } from '../internal/raster-bake-plan.js';
import { cacheSuccessfulPromise } from '../internal/successful-promise-cache.js';
import { fingerprint128, fingerprintDomain } from '../internal/fingerprint.js';
import { compatibilityFingerprint } from '../internal/raster-identity.js';
import { parseGlb } from '../font-baker/validator.js';

export interface NodeBakeOptions<Rasters extends readonly object[] = readonly []> {
  readonly input: string | URL;
  readonly output: string | URL;
  readonly font: Omit<FontBakeDescriptor, 'formatVersion'>;
  readonly unicodeRanges?: readonly UnicodeRange[];
  readonly rasters?: Rasters;
  readonly signal?: AbortSignal;
}

type CheckedRasterPlans<Plans extends readonly object[]> = {
  readonly [Index in keyof Plans]: Plans[Index] extends {
    readonly baker: infer Module;
  }
    ? RasterBakePlan<Module>
    : never;
};

export interface NodeBakeExecutionReport {
  readonly timingsMs: {
    readonly read: number;
    readonly coreBake: number;
    readonly rasterBake: number;
    readonly compose: number;
    readonly validate: number;
    readonly transport: number;
    readonly write: number;
    readonly total: number;
  };
  readonly memory: {
    readonly rssBeforeBytes: number;
    readonly rssAfterBytes: number;
    /** Process-lifetime peak reported by Node, not an isolated-operation allocation claim. */
    readonly processMaxRssBytes: number;
  };
  readonly outputs: readonly {
    readonly role: BakeArtifact['role'];
    readonly file: string;
    readonly bytes: number;
    readonly fingerprint: Fingerprint;
  }[];
}

export interface NodeFontBakeReport extends FontPayloadReport {
  readonly preparation?: PreparedFontReport;
  readonly execution: NodeBakeExecutionReport;
}

export interface NodeFontInspectOptions {
  readonly input: string | URL;
  readonly fontFaceIndex?: number;
}

export interface ProjectBakeOptions extends DiscoveryOptions {
  readonly outputRoot?: string | URL;
}

export interface ProjectBakeMapping {
  readonly expression: string;
  readonly sourceFile: string;
  readonly assetRoot: string;
  readonly publicPathname: string;
  readonly outputFile: string;
}

export interface ProjectBakeDiagnostic extends BakeWarning {
  readonly sourceFile: string;
  readonly expression: string;
}

export interface ProjectBakeReport {
  readonly fonts: readonly NodeFontBakeReport[];
  readonly mappings: readonly ProjectBakeMapping[];
  readonly diagnostics: readonly ProjectBakeDiagnostic[];
}

export class NodeBakeError extends GlyphError<'bake-failed'> {
  readonly reason: string;
  readonly path: string | undefined;

  constructor(reason: string, message: string, path?: string, options?: ErrorOptions) {
    super('bake-failed', message, options);
    this.name = 'NodeBakeError';
    this.reason = reason;
    this.path = path;
  }
}

const defaultFontBaker = cacheSuccessfulPromise(async () => createFontBaker(await readFile(new URL(fontBakerWasmUrl))));

export async function bakeFont<const Rasters extends readonly object[]>(
  options: NodeBakeOptions<Rasters> & { readonly rasters?: Rasters & CheckedRasterPlans<Rasters> },
): Promise<NodeFontBakeReport> {
  return bakeFontWithResolvedPlans(options);
}

export async function inspectFont(options: NodeFontInspectOptions): Promise<FontInspection> {
  const source = new Uint8Array(await readFile(filePath(options.input, 'input')));
  const fontBaker = await defaultFontBaker();
  return fontBaker.inspect({
    source,
    descriptor: fontBakeDescriptor(options.fontFaceIndex ?? 0),
  });
}

async function bakeFontWithResolvedPlans<const Rasters extends readonly object[]>(
  options: NodeBakeOptions<Rasters> & { readonly rasters?: Rasters & CheckedRasterPlans<Rasters> },
  preparedRasters?: readonly ResolvedRasterBakePlan[],
): Promise<NodeFontBakeReport> {
  const started = performance.now();
  const rssBeforeBytes = process.memoryUsage.rss();
  const timings = {
    read: 0,
    coreBake: 0,
    rasterBake: 0,
    compose: 0,
    validate: 0,
    transport: 0,
    write: 0,
  };
  options.signal?.throwIfAborted();
  const input = filePath(options.input, 'input');
  const output = filePath(options.output, 'output');
  await assertDistinctInputOutput(input, output);

  let phase = performance.now();
  const originalSource = new Uint8Array(await readFile(input));
  timings.read = performance.now() - phase;
  options.signal?.throwIfAborted();

  const fontBaker = await defaultFontBaker();
  const rasters = preparedRasters ?? (await Promise.all((options.rasters ?? []).map(resolveRasterBakePlan)));
  const pipeline = await bakeFontPipeline({
    fontBaker,
    source: originalSource,
    fontFaceIndex: options.font.fontFaceIndex,
    ...(options.unicodeRanges === undefined ? {} : { unicodeRanges: options.unicodeRanges }),
    rasters,
    validateArtifact: validateFontArtifact,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  timings.coreBake = pipeline.timings.coreBake;
  timings.rasterBake = pipeline.timings.rasterBake;
  timings.compose = pipeline.timings.compose;
  timings.validate = pipeline.timings.validate;
  const { composed, preparation } = pipeline;
  phase = performance.now();
  const report = finalizeTransport(composed.report, composed.artifacts);
  timings.transport = performance.now() - phase;

  phase = performance.now();
  const outputs = outputTargets(output, composed.artifacts);
  await publishArtifactsWithRollback(outputs, options.signal);
  timings.write = performance.now() - phase;
  const rssAfterBytes = process.memoryUsage.rss();
  return {
    ...report,
    ...(preparation === undefined ? {} : { preparation }),
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
        fingerprint: artifact.fingerprint,
      })),
    },
  };
}

export async function bakeProject(options: ProjectBakeOptions = {}): Promise<ProjectBakeReport> {
  options.signal?.throwIfAborted();
  const { discoverProjectFonts } = await import('../discovery.js');
  const discovery = await discoverProjectFonts(options);
  const projectRoot = await canonicalProjectRoot(options.projectRoot);
  const outputRoot =
    options.outputRoot === undefined ? undefined : resolve(projectRoot, filePath(options.outputRoot, 'outputRoot'));
  const groups = groupDefinitions(discovery.fonts, outputRoot);
  const fonts: NodeFontBakeReport[] = [];
  for (const group of groups) {
    options.signal?.throwIfAborted();
    const plans = await loadProjectPlans(group.rasters);
    fonts.push(
      await bakeFontWithResolvedPlans(
        {
          input: group.input,
          output: group.output,
          font: { fontFaceIndex: 0 },
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        },
        plans,
      ),
    );
  }
  const outputs = new Map(groups.map((group) => [group.input, group.output]));
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
  };
}

interface ProjectGroup {
  readonly input: string;
  readonly output: string;
  readonly rasters: readonly ResolvedRasterBaker[];
}

function groupDefinitions(fonts: readonly DiscoveredFontDefinition[], outputRoot: string | undefined): ProjectGroup[] {
  const groups = new Map<string, { output: string; rasters: Map<string, ResolvedRasterBaker> }>();
  const inputsByOutput = new Map<string, string>();
  for (const font of fonts) {
    const output = outputPath(font, outputRoot);
    const canonicalOutput = resolve(output);
    const existingInput = inputsByOutput.get(canonicalOutput);
    if (existingInput !== undefined && existingInput !== font.resolvedFile) {
      throw new NodeBakeError('OUTPUT_CONFLICT', 'multiple font sources resolve to one output path', output);
    }
    inputsByOutput.set(canonicalOutput, font.resolvedFile);
    const group = groups.get(font.resolvedFile) ?? { output, rasters: new Map() };
    if (group.output !== output) {
      throw new NodeBakeError('OUTPUT_CONFLICT', 'one source resolved to conflicting output paths', output);
    }
    const key = `${font.raster.specifier}\0${JSON.stringify(font.raster.options)}`;
    group.rasters.set(key, font.raster);
    groups.set(font.resolvedFile, group);
  }
  return [...groups]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([input, group]) => ({
      input,
      output: group.output,
      rasters: [...group.rasters.values()].sort((left, right) => left.specifier.localeCompare(right.specifier)),
    }));
}

async function loadRasterPlan(raster: ResolvedRasterBaker): Promise<ResolvedRasterBakePlan> {
  const namespace = await import(pathToFileURL(raster.resolvedFile).href);
  const baker = namespace.default;
  if (!isRasterBaker<typeof raster.options>(baker) || baker.kind !== raster.kind) {
    throw new NodeBakeError(
      'INVALID_RASTER_BAKER',
      `${raster.specifier} default export is not the declared ${raster.kind} ESM baker`,
      raster.resolvedFile,
    );
  }
  return resolveRasterBakePlan({
    baker,
    packaging: { artifact: 'embedded' },
    options: raster.options,
  });
}

async function loadProjectPlans(rasters: readonly ResolvedRasterBaker[]): Promise<ResolvedRasterBakePlan[]> {
  const resolved = await Promise.all(rasters.map(loadRasterPlan));
  resolved.sort(
    (left, right) =>
      left.baker.extension.localeCompare(right.baker.extension) || left.rasterKey.localeCompare(right.rasterKey),
  );
  // One raster per technique: more strikes or different settings belong to a single raster's
  // options, not a second raster of the same extension. External packaging is something a caller
  // asks for, never a fallback for a collision.
  const declared = new Set<string>();
  return resolved.map((plan) => {
    if (declared.has(plan.baker.extension)) {
      throw new NodeBakeError(
        'RASTER_EXTENSION_DUPLICATE',
        `a font may declare one ${plan.baker.kind} raster; combine the declarations into a single one whose options cover both`,
        plan.baker.extension,
      );
    }
    declared.add(plan.baker.extension);
    return {
      ...plan,
      packaging: { artifact: 'embedded' },
    };
  });
}

function isRasterBaker<Options>(value: unknown): value is RasterBakerModule<string, Options, JsonValue> {
  if (typeof value !== 'object' || value === null) return false;
  return (
    'kind' in value &&
    typeof value.kind === 'string' &&
    'extension' in value &&
    typeof value.extension === 'string' &&
    'version' in value &&
    Number.isSafeInteger(value.version) &&
    'descriptor' in value &&
    typeof value.descriptor === 'function' &&
    'bake' in value &&
    typeof value.bake === 'function'
  );
}

function outputPath(font: DiscoveredFontDefinition, outputRoot: string | undefined): string {
  const sourceRelative = relative(font.assetRoot, font.resolvedFile);
  if (sourceRelative === '..' || sourceRelative.startsWith(`..${sep}`) || isAbsolute(sourceRelative)) {
    throw new NodeBakeError('SOURCE_OUTSIDE_ASSET_ROOT', 'resolved font escaped its asset root');
  }
  const base = outputRoot === undefined ? font.assetRoot : outputRoot;
  return join(base, bakedSiblingPath(sourceRelative));
}

function bakedSiblingPath(path: string): string {
  const extension = extname(path);
  return /\.(?:ttf|otf|woff2?)$/i.test(extension) ? `${path.slice(0, -extension.length)}.font.glb` : `${path}.font.glb`;
}

function outputTargets(
  fontOutput: string,
  artifacts: readonly BakeArtifact[],
): readonly { artifact: BakeArtifact; file: string }[] {
  const directory = dirname(fontOutput);
  const targets = artifacts.map((artifact) => {
    if (artifact.role === 'font') return { artifact, file: fontOutput };
    if (
      artifact.id === '' ||
      artifact.id === '.' ||
      artifact.id === '..' ||
      artifact.id.includes('\0') ||
      artifact.id !== artifact.id.split(/[\\/]/).at(-1)
    ) {
      throw new NodeBakeError('UNSAFE_ARTIFACT_ID', 'artifact ID must be a single filename', artifact.id);
    }
    return { artifact, file: join(directory, artifact.id) };
  });
  const files = new Set<string>();
  for (const target of targets) {
    const canonical = resolve(target.file);
    if (files.has(canonical)) {
      throw new NodeBakeError('OUTPUT_CONFLICT', 'multiple artifacts resolve to one output', canonical);
    }
    files.add(canonical);
  }
  return targets;
}

interface StagedArtifactOutput {
  readonly temporaryFile: string;
  readonly target: string;
  backupFile?: string;
  published: boolean;
}

async function publishArtifactsWithRollback(
  outputs: readonly { artifact: BakeArtifact; file: string }[],
  signal?: AbortSignal,
): Promise<void> {
  const staged: StagedArtifactOutput[] = [];
  let publicationCompleted = false;
  let rollbackCompleted = false;
  try {
    for (const { artifact, file } of outputs) {
      signal?.throwIfAborted();
      await mkdir(dirname(file), { recursive: true });
      const temporaryFile = join(dirname(file), `.${file.split(sep).at(-1)}.${randomUUID()}.tmp`);
      staged.push({ temporaryFile, target: file, published: false });
      const handle = await open(temporaryFile, 'wx');
      try {
        await handle.writeFile(artifact.bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
    }
    signal?.throwIfAborted();
    for (const entry of staged) await preservePreviousTarget(entry);
    for (const entry of staged) {
      await rename(entry.temporaryFile, entry.target);
      entry.published = true;
    }
    publicationCompleted = true;
  } catch (error) {
    try {
      await rollbackPublication(staged);
      rollbackCompleted = true;
    } catch (rollbackError) {
      throw new Error(
        `artifact publication failed (${error instanceof Error ? error.message : String(error)}) ` +
          `and rollback was incomplete: ${
            rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
          }`,
        { cause: rollbackError },
      );
    }
    throw error;
  } finally {
    await Promise.all(
      staged.flatMap(({ temporaryFile, backupFile }) => [
        rm(temporaryFile, { force: true }),
        ...(backupFile === undefined || (!publicationCompleted && !rollbackCompleted)
          ? []
          : [rm(backupFile, { force: true })]),
      ]),
    );
  }
}

async function preservePreviousTarget(entry: StagedArtifactOutput): Promise<void> {
  try {
    const previous = await lstat(entry.target);
    if (!previous.isFile()) {
      throw new NodeBakeError('OUTPUT_TARGET_TYPE', 'existing artifact output must be a regular file', entry.target);
    }
    const backupFile = join(dirname(entry.target), `.${entry.target.split(sep).at(-1)}.${randomUUID()}.bak`);
    await rename(entry.target, backupFile);
    entry.backupFile = backupFile;
  } catch (error) {
    if (isMissing(error)) return;
    throw error;
  }
}

async function assertDistinctInputOutput(input: string, output: string): Promise<void> {
  if (resolve(input) === resolve(output)) {
    throw new NodeBakeError('OUTPUT_OVERLAPS_INPUT', 'font output must not overwrite its source', output);
  }
  const inputIdentity = await stat(input);
  let outputIdentity;
  try {
    outputIdentity = await stat(output);
  } catch (error) {
    if (isMissing(error)) return;
    throw error;
  }
  if (inputIdentity.dev === outputIdentity.dev && inputIdentity.ino === outputIdentity.ino) {
    throw new NodeBakeError('OUTPUT_OVERLAPS_INPUT', 'font output must not alias its source', output);
  }
  if (!outputIdentity.isFile()) {
    throw new NodeBakeError('OUTPUT_TARGET_TYPE', 'existing artifact output must be a regular file', output);
  }
}

async function rollbackPublication(staged: readonly StagedArtifactOutput[]): Promise<void> {
  const failures: unknown[] = [];
  for (const entry of [...staged].reverse()) {
    try {
      if (entry.published) await rm(entry.target, { force: true });
      if (entry.backupFile !== undefined) {
        await rename(entry.backupFile, entry.target);
        delete entry.backupFile;
      }
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length !== 0) {
    throw new AggregateError(failures, 'failed to restore pre-existing artifact outputs');
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function finalizeTransport(report: FontPayloadReport, artifacts: readonly BakeArtifact[]): FontPayloadReport {
  return {
    ...report,
    transport: artifacts.flatMap(({ id, bytes }) => {
      const raw = { artifactId: id, format: 'raw', bytes: bytes.byteLength };
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
      ];
    }),
  };
}

function mapDiagnostic(diagnostic: DiscoveryDiagnostic): ProjectBakeDiagnostic {
  return {
    code: diagnostic.code,
    message: diagnostic.message,
    path: diagnostic.sourceFile,
    sourceFile: diagnostic.sourceFile,
    expression: diagnostic.expression,
  };
}

async function canonicalProjectRoot(value: string | URL | undefined): Promise<string> {
  const candidate = value === undefined ? process.cwd() : filePath(value, 'projectRoot');
  return resolve(candidate);
}

function filePath(value: string | URL, field: string): string {
  if (value instanceof URL) {
    if (value.protocol !== 'file:') {
      throw new NodeBakeError('NON_FILE_URL', `${field} must be a file URL`, value.href);
    }
    return fileURLToPath(value);
  }
  return value;
}

export interface FontFreshness {
  readonly fresh: boolean;
  readonly reason: string;
}

/**
 * Decide whether an existing font already contains exactly what a bake would produce.
 *
 * Rasterizing is the expensive half of a bake and preparing the source is the cheap half, so the
 * check pays only the cheap half: the artifact records a fingerprint over its prepared source, and
 * every raster records the single value that has to agree for it to be usable. Matching both means
 * the bake would reproduce what is already on disk.
 */
export async function fontIsUpToDate(request: {
  readonly output: string;
  readonly input: string;
  readonly fontFaceIndex: number;
  readonly unicodeRanges?: readonly UnicodeRange[];
  readonly rasters: readonly { readonly rasterKey: string; readonly kind: string; readonly version: number }[];
}): Promise<FontFreshness> {
  let existing: Uint8Array;
  try {
    existing = await readFile(request.output);
  } catch {
    return { fresh: false, reason: 'no font at the output path' };
  }

  const baker = await defaultFontBaker();
  const source = await readFile(request.input);
  const prepared = baker.prepare({
    source,
    selection: {
      formatVersion: 0,
      fontFaceIndex: request.fontFaceIndex,
      ...(request.unicodeRanges === undefined ? { unicodeRanges: [] } : { unicodeRanges: request.unicodeRanges }),
    },
  });
  const sourceFingerprint = fingerprint128(prepared.bytes, fingerprintDomain.source);

  let document: Readonly<Record<string, unknown>>;
  try {
    document = parseGlb(existing).document;
  } catch {
    return { fresh: false, reason: 'the existing font could not be parsed' };
  }
  const font = (document.extensions as Record<string, Record<string, Record<string, unknown>>> | undefined)
    ?.PMNDRS_font;
  if (font === undefined) return { fresh: false, reason: 'the existing font is not a glyph font' };
  if (font.provenance?.sourceFingerprint !== sourceFingerprint) {
    return { fresh: false, reason: 'the source font, face, or unicode ranges changed' };
  }

  // Comparing raster keys alone would call an artifact fresh after the format changed, because a
  // key describes the request and not what was written. Compare the digest each raster actually
  // carries, which no artifact predating the field can satisfy.
  const metrics = font.metrics ?? {};
  const glyphCount = Number(metrics.glyphCount);
  const glyphIdWidth = Number(metrics.glyphIdWidth);
  const shaping = String((font.shaping ?? {}).fingerprint);
  const directory = Array.isArray(font.rasters) ? (font.rasters as Record<string, unknown>[]) : [];
  const extensions = (document.extensions ?? {}) as Record<string, Record<string, unknown> | undefined>;
  for (const raster of request.rasters) {
    const entry = directory.find((candidate) => candidate.rasterKey === raster.rasterKey);
    if (entry === undefined) return { fresh: false, reason: `${raster.kind} is not in the font` };
    const carried = extensions[String(entry.extension)]?.fingerprint;
    const expected = compatibilityFingerprint({
      glyphCount,
      glyphIdWidth,
      kind: raster.kind,
      rasterKey: raster.rasterKey,
      shaping,
      version: raster.version,
    });
    if (carried !== expected) return { fresh: false, reason: `${raster.kind} was baked by a different contract` };
  }
  return { fresh: true, reason: 'every requested raster is already baked from this exact source' };
}
