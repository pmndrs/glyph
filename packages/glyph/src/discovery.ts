import type * as ast from 'oxc-parser';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
  DiscoverySources,
  unwrapExpression as unwrap,
  type DiscoverySource,
  type ImportedBinding,
} from './discovery-source.js';

export interface DiscoveryOptions {
  readonly entries?: readonly (string | URL)[];
  readonly projectRoot?: string | URL;
  readonly assetRoots?: readonly (string | URL)[];
  readonly signal?: AbortSignal;
}

export interface ResolvedRasterBaker {
  readonly packageName: string;
  readonly kind: string;
  readonly specifier: string;
  readonly resolvedFile: string;
  readonly options: unknown;
}

export interface DiscoveredFontDefinition {
  readonly expression: string;
  readonly sourceFile: string;
  readonly resolvedFile: string;
  readonly assetRoot: string;
  readonly publicPathname: string;
  readonly raster: ResolvedRasterBaker;
}

export interface DiscoveryDiagnostic {
  readonly code:
    | 'ambiguous-font-source'
    | 'dynamic-font-source'
    | 'invalid-font-source'
    | 'invalid-raster-options'
    | 'missing-font-source'
    | 'invalid-raster-manifest';
  readonly message: string;
  readonly sourceFile: string;
  readonly expression: string;
}

export interface DiscoveryReport {
  readonly fonts: readonly DiscoveredFontDefinition[];
  readonly diagnostics: readonly DiscoveryDiagnostic[];
}

interface StaticString {
  readonly exact?: string;
  readonly suffix?: string;
  readonly moduleRelative?: string;
  readonly declaringFile?: string;
}

interface ResolveResult {
  readonly resolvedFile?: string;
  readonly assetRoot?: string;
  readonly publicPathname?: string;
  readonly code?: DiscoveryDiagnostic['code'];
  readonly reason?: string;
}

interface OrderedFontDefinition {
  readonly value: DiscoveredFontDefinition;
  readonly sourceOffset: number;
}

interface OrderedDiagnostic {
  readonly value: DiscoveryDiagnostic;
  readonly sourceOffset: number;
}

export async function discoverProjectFonts(options: DiscoveryOptions = {}): Promise<DiscoveryReport> {
  options.signal?.throwIfAborted();
  const projectRoot = await canonicalDirectory(pathValue(options.projectRoot ?? process.cwd()));
  const entries = await resolveEntries(projectRoot, options.entries);
  const assetRoots = await resolveAssetRoots(projectRoot, options.assetRoots);
  const fonts: OrderedFontDefinition[] = [];
  const diagnostics: OrderedDiagnostic[] = [];
  const analyses: Promise<void>[] = [];
  const sources = new DiscoverySources(projectRoot, entries, options.signal);
  for (const sourceFile of sources.files.values()) {
    options.signal?.throwIfAborted();
    for (const node of sourceFile.calls) {
      if (!isGlyphFontFaceCall(node.callee, sources)) continue;
      const sourceOffset = node.start;
      analyses.push(
        analyzeDefinition(
          node.arguments[0],
          node.arguments[1],
          sources.text(node),
          sourceFile,
          sources,
          assetRoots,
        ).then((result) => {
          if (result === undefined) return;
          if ('fonts' in result) {
            for (const font of result.fonts) fonts.push({ value: font, sourceOffset });
          } else diagnostics.push({ value: result.diagnostic, sourceOffset });
        }),
      );
    }
  }
  await Promise.all(analyses);
  fonts.sort(compareSourcePosition);
  diagnostics.sort(compareSourcePosition);
  return {
    fonts: fonts.map(({ value }) => value),
    diagnostics: diagnostics.map(({ value }) => value),
  };
}

async function analyzeDefinition(
  sourceExpression: ast.Node | undefined,
  configExpression: ast.Node | undefined,
  expression: string,
  sourceFile: DiscoverySource,
  sources: DiscoverySources,
  assetRoots: readonly string[],
): Promise<{ fonts: readonly DiscoveredFontDefinition[] } | { diagnostic: DiscoveryDiagnostic } | undefined> {
  if (sourceExpression === undefined) {
    return failure('dynamic-font-source', 'glyph.fontFace() has no source input', sourceFile, expression);
  }
  const source = staticString(sourceExpression, sources);
  if (source === undefined) {
    return failure(
      'dynamic-font-source',
      'font source has no statically provable local pathname',
      sourceFile,
      expression,
    );
  }
  const sourcePath = source.exact ?? source.suffix ?? source.moduleRelative ?? '';
  if (/\.glb(?:[?#]|$)/iu.test(sourcePath)) return undefined;
  const resolved = await resolveFontSource(source, sourceFile.fileName, assetRoots);
  if (resolved.resolvedFile === undefined) {
    return failure(
      resolved.code ?? 'missing-font-source',
      resolved.reason ?? 'font source did not resolve',
      sourceFile,
      expression,
    );
  }
  const resolvedFile = resolved.resolvedFile;
  const rasters = await resolveFontFaceRasters(configExpression, sources, sourceFile);
  if ('diagnostic' in rasters) return rasters;
  return {
    fonts: rasters.rasters.map((raster) => ({
      expression,
      sourceFile: sourceFile.fileName,
      resolvedFile,
      assetRoot: resolved.assetRoot!,
      publicPathname: resolved.publicPathname!,
      raster,
    })),
  };
}

function isGlyphFontFaceCall(expression: ast.Node, sources: DiscoverySources): boolean {
  const value = unwrap(expression);
  if (
    value.type !== 'MemberExpression' ||
    value.computed ||
    value.property.type !== 'Identifier' ||
    value.property.name !== 'fontFace'
  )
    return false;
  const binding = sources.importedBinding(value.object);
  return binding?.module === '@pmndrs/glyph' && binding.exported === 'glyph';
}

async function resolveFontFaceRasters(
  configExpression: ast.Node | undefined,
  sources: DiscoverySources,
  sourceFile: DiscoverySource,
): Promise<{ rasters: readonly ResolvedRasterBaker[] } | { diagnostic: DiscoveryDiagnostic }> {
  if (configExpression === undefined) return { rasters: await defaultRasterBakers(sourceFile.fileName) };
  const config = constantExpression(configExpression, sources);
  if (config.type !== 'ObjectExpression') {
    return failure(
      'invalid-raster-options',
      'FontFace config must be a statically visible object',
      sourceFile,
      sources.text(configExpression),
    );
  }
  const format = objectPropertyExpression(config, 'format');
  if (format === undefined) return { rasters: await defaultRasterBakers(sourceFile.fileName) };
  const selected = constantExpression(format, sources);
  const expressions = selected.type === 'ArrayExpression' ? [...selected.elements] : [selected];
  if (expressions.length === 0) {
    return failure(
      'invalid-raster-options',
      'FontFace format array must not be empty',
      sourceFile,
      sources.text(format),
    );
  }
  const rasters: ResolvedRasterBaker[] = [];
  for (const expression of expressions) {
    if (expression === null || expression.type === 'SpreadElement') {
      return failure(
        'invalid-raster-options',
        'FontFace formats must be statically visible',
        sourceFile,
        sources.text(format),
      );
    }
    const raster = await resolveRaster(expression, sources, sourceFile);
    if ('diagnostic' in raster) return raster;
    rasters.push(raster.raster);
  }
  return { rasters };
}

async function resolveRaster(
  expression: ast.Node | undefined,
  sources: DiscoverySources,
  sourceFile: DiscoverySource,
): Promise<{ raster: ResolvedRasterBaker } | { diagnostic: DiscoveryDiagnostic }> {
  const text = expression === undefined ? '<missing raster>' : sources.text(expression);
  const value = expression === undefined ? undefined : constantExpression(expression, sources);
  if (value === undefined) {
    return failure('invalid-raster-options', 'raster must be a statically visible factory call', sourceFile, text);
  }
  const formatKey =
    value.type === 'Literal' && typeof value.value === 'string'
      ? value.value
      : value.type === 'TemplateLiteral' && value.expressions.length === 0
        ? value.quasis[0]!.value.cooked
        : undefined;
  if (formatKey !== undefined && formatKey !== null) {
    try {
      return { raster: await builtInRasterBaker(formatKey, sourceFile.fileName) };
    } catch (error) {
      return failure(
        'invalid-raster-manifest',
        error instanceof Error ? error.message : String(error),
        sourceFile,
        text,
      );
    }
  }
  const moduleExpression =
    value.type === 'CallExpression'
      ? value.callee
      : value.type === 'ObjectExpression'
        ? objectPropertyExpression(value, 'raster')
        : value;
  const optionsExpression =
    value.type === 'CallExpression'
      ? value.arguments[0]
      : value.type === 'ObjectExpression'
        ? objectPropertyExpression(value, 'options')
        : undefined;
  const binding = moduleExpression === undefined ? undefined : sources.importedBinding(moduleExpression);
  if (binding === undefined) {
    return failure('invalid-raster-options', 'raster factory is not an imported ESM binding', sourceFile, text);
  }
  const options = optionsExpression === undefined ? {} : staticJson(optionsExpression, sources);
  if (options === undefined) {
    return failure('invalid-raster-options', 'raster options are not immutable JSON literals', sourceFile, text);
  }
  try {
    const manifest = await rasterManifest(binding, binding.sourceFile);
    return { raster: { ...manifest, options } };
  } catch (error) {
    return failure('invalid-raster-manifest', error instanceof Error ? error.message : String(error), sourceFile, text);
  }
}

async function defaultRasterBakers(sourceFile: string): Promise<readonly ResolvedRasterBaker[]> {
  return Promise.all([
    builtInRasterBaker('bitmap', sourceFile, { strikes: [8, 16] }),
    builtInRasterBaker('msdf', sourceFile),
    builtInRasterBaker('slug', sourceFile),
  ]);
}

async function builtInRasterBaker(
  kind: string,
  sourceFile: string,
  options: unknown = {},
): Promise<ResolvedRasterBaker> {
  if (kind !== 'bitmap' && kind !== 'msdf' && kind !== 'slug') {
    throw new Error(`FontFace format key ${JSON.stringify(kind)} has no statically imported raster baker`);
  }
  const manifest = await rasterManifest({ module: '@pmndrs/glyph', exported: kind, sourceFile }, sourceFile);
  return { ...manifest, options };
}

async function rasterManifest(
  binding: ImportedBinding,
  sourceFile: string,
): Promise<Omit<ResolvedRasterBaker, 'options'>> {
  const packageName = packageNameFromSpecifier(binding.module);
  const require = createRequire(sourceFile);
  const manifestPath = require.resolve(`${packageName}/package.json`);
  const manifest = requireNonArrayObject(JSON.parse(await readFile(manifestPath, 'utf8')), 'raster package manifest');
  if (manifest.name !== packageName) throw new Error(`raster manifest name does not match ${packageName}`);
  const packageRoot = await canonicalDirectory(dirname(manifestPath));
  const pmndrs = nonArrayObjectOrUndefined(manifest.pmndrs);
  const map = nonArrayObjectOrUndefined(pmndrs?.glyph);
  const target = map?.[binding.exported];
  if (typeof target !== 'string' || !target.startsWith('./')) {
    throw new Error(`raster manifest has no pmndrs.glyph entry for ${binding.exported}`);
  }
  const exports = nonArrayObjectOrUndefined(manifest.exports);
  const exported = exports?.[target];
  const importTarget = esmExportTarget(exported, manifest.type);
  if (importTarget === undefined) throw new Error(`raster baker ${target} is not an exported ESM subpath`);
  const bakerFile = await realpath(resolve(packageRoot, importTarget));
  if (!within(packageRoot, bakerFile) || !(await stat(bakerFile)).isFile()) {
    throw new Error(`raster baker ${target} resolves outside its package`);
  }
  return {
    packageName,
    kind: binding.exported,
    specifier: `${packageName}${target.slice(1)}`,
    resolvedFile: bakerFile,
  };
}

function esmExportTarget(value: unknown, packageType: unknown): string | undefined {
  if (typeof value === 'string') {
    return value.endsWith('.mjs') || (value.endsWith('.js') && packageType === 'module') ? value : undefined;
  }
  const object = nonArrayObjectOrUndefined(value);
  const target = object?.import;
  return typeof target === 'string' &&
    object?.require === undefined &&
    (target.endsWith('.mjs') || (target.endsWith('.js') && packageType === 'module'))
    ? target
    : undefined;
}

function staticString(
  expression: ast.Node,
  sources: DiscoverySources,
  seen = new Set<ast.Node>(),
): StaticString | undefined {
  const value = unwrap(expression);
  if (value.type === 'Literal' && typeof value.value === 'string') return { exact: value.value, suffix: value.value };
  if (value.type === 'Identifier') {
    const initializer = sources.constantInitializer(value, seen);
    return initializer === undefined ? undefined : staticString(initializer, sources, seen);
  }
  if (value.type === 'BinaryExpression' && value.operator === '+') {
    const left = staticString(value.left, sources, new Set(seen));
    const right = staticString(value.right, sources, new Set(seen));
    if (left?.exact !== undefined && right?.exact !== undefined) {
      const exact = left.exact + right.exact;
      return { exact, suffix: exact };
    }
    if (right?.exact !== undefined) {
      const suffix = `${left?.suffix ?? ''}${right.exact}`;
      return suffix === '' ? undefined : { suffix };
    }
    return right?.suffix === undefined || right.suffix === '' ? undefined : { suffix: right.suffix };
  }
  if (value.type === 'TemplateLiteral') {
    let exact: string | undefined = value.quasis[0]!.value.cooked ?? undefined;
    let suffix = exact ?? '';
    for (let index = 0; index < value.expressions.length; index++) {
      const part = staticString(value.expressions[index]!, sources, new Set(seen));
      const tail = value.quasis[index + 1]!.value.cooked;
      if (tail === null || tail === undefined) return undefined;
      exact = exact === undefined || part?.exact === undefined ? undefined : exact + part.exact + tail;
      suffix = part?.exact === undefined ? tail : suffix + part.exact + tail;
    }
    return exact === undefined ? (suffix === '' ? undefined : { suffix }) : { exact, suffix: exact };
  }
  if (value.type === 'NewExpression' && value.callee.type === 'Identifier' && value.callee.name === 'URL') {
    const first =
      value.arguments[0] === undefined ? undefined : staticString(value.arguments[0], sources, new Set(seen));
    if (first?.exact !== undefined && value.arguments.length === 2 && isImportMetaUrl(value.arguments[1]!)) {
      return { moduleRelative: first.exact, declaringFile: sources.source(value).fileName };
    }
    if (first?.exact !== undefined && value.arguments.length === 1) {
      try {
        const exact = new URL(first.exact).href;
        return { exact, suffix: exact };
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

function staticJson(expression: ast.Node, sources: DiscoverySources, seen = new Set<ast.Node>()): unknown | undefined {
  const value = unwrap(expression);
  if (
    value.type === 'Literal' &&
    !('regex' in value) &&
    (typeof value.value === 'string' ||
      typeof value.value === 'number' ||
      typeof value.value === 'boolean' ||
      value.value === null)
  )
    return value.value;
  if (
    value.type === 'UnaryExpression' &&
    value.operator === '-' &&
    value.argument.type === 'Literal' &&
    typeof value.argument.value === 'number'
  ) {
    return -value.argument.value;
  }
  if (value.type === 'TemplateLiteral' && value.expressions.length === 0)
    return value.quasis[0]!.value.cooked ?? undefined;
  if (value.type === 'Identifier') {
    const initializer = sources.constantInitializer(value, seen);
    return initializer === undefined ? undefined : staticJson(initializer, sources, seen);
  }
  if (value.type === 'ArrayExpression') {
    const result: unknown[] = [];
    for (const element of value.elements) {
      if (element === null || element.type === 'SpreadElement') return undefined;
      const item = staticJson(element, sources, new Set(seen));
      if (item === undefined) return undefined;
      result.push(item);
    }
    return result;
  }
  if (value.type === 'ObjectExpression') {
    const result: Record<string, unknown> = {};
    for (const property of value.properties) {
      if (property.type !== 'Property' || property.computed || property.method || property.kind !== 'init')
        return undefined;
      const name = propertyName(property.key);
      const item = staticJson(property.value, sources, new Set(seen));
      if (name === undefined || item === undefined) return undefined;
      Object.defineProperty(result, name, { value: item, enumerable: true, configurable: true, writable: true });
    }
    return result;
  }
  return undefined;
}

async function resolveFontSource(
  source: StaticString,
  sourceFile: string,
  assetRoots: readonly string[],
): Promise<ResolveResult> {
  let candidates: { file: string; root: string; pathname: string }[] = [];
  try {
    if (source.moduleRelative !== undefined) {
      const pathname = safePathname(source.moduleRelative);
      const file = resolve(
        dirname(source.declaringFile ?? sourceFile),
        `.${pathname.startsWith('/') ? pathname : `/${pathname}`}`,
      );
      for (const root of assetRoots)
        if (within(root, file)) candidates.push({ file, root, pathname: publicPath(root, file) });
    } else {
      const pathname = safePathname(source.exact ?? source.suffix ?? '');
      if (source.exact?.startsWith('.') === true) {
        const file = resolve(dirname(sourceFile), pathname);
        for (const root of assetRoots)
          if (within(root, file)) candidates.push({ file, root, pathname: publicPath(root, file) });
      } else {
        for (const root of assetRoots) {
          const file = join(root, pathname.replace(/^\/+/, ''));
          candidates.push({ file, root, pathname: `/${pathname.replace(/^\/+/, '')}` });
        }
      }
    }
  } catch (error) {
    return {
      code: 'invalid-font-source',
      reason: error instanceof Error ? error.message : String(error),
    };
  }
  const existing: typeof candidates = [];
  for (const candidate of candidates) {
    try {
      const file = await realpath(candidate.file);
      if (!within(candidate.root, file) || !(await stat(file)).isFile()) continue;
      existing.push({ ...candidate, file });
    } catch {
      // Missing candidates are reported after every configured root is checked.
    }
  }
  const unique = [...new Map(existing.map((candidate) => [candidate.file, candidate])).values()];
  if (unique.length === 0)
    return { code: 'missing-font-source', reason: 'no configured asset root contains the source' };
  if (unique.length > 1)
    return {
      code: 'ambiguous-font-source',
      reason: 'more than one configured asset root contains the source',
    };
  const match = unique[0]!;
  return { resolvedFile: match.file, assetRoot: match.root, publicPathname: match.pathname };
}

function safePathname(input: string): string {
  let pathname = input;
  try {
    if (/^[a-z][a-z\d+.-]*:/i.test(input)) pathname = new URL(input).pathname;
  } catch {
    throw new Error('font source URL is invalid');
  }
  pathname = pathname.split('#', 1)[0]!.split('?', 1)[0]!;
  const segments = pathname.split('/').map((raw) => ({ raw, decoded: decodeURIComponent(raw) }));
  for (const { raw, decoded } of segments) {
    if (
      decoded === '..' ||
      (decoded === '.' && raw !== '.') ||
      decoded.includes('/') ||
      decoded.includes('\\') ||
      decoded.includes('\0')
    ) {
      throw new Error('font source contains unsafe encoded path segments');
    }
  }
  return segments.map(({ decoded }) => decoded).join('/');
}

function isImportMetaUrl(expression: ast.Node): boolean {
  return (
    expression.type === 'MemberExpression' &&
    !expression.computed &&
    expression.property.type === 'Identifier' &&
    expression.property.name === 'url' &&
    expression.object.type === 'MetaProperty' &&
    expression.object.meta.name === 'import' &&
    expression.object.property.name === 'meta'
  );
}

function constantExpression(expression: ast.Node, sources: DiscoverySources, seen = new Set<ast.Node>()): ast.Node {
  const value = unwrap(expression);
  if (value.type !== 'Identifier') return value;
  const initializer = sources.constantInitializer(value, seen);
  return initializer === undefined ? value : constantExpression(initializer, sources, seen);
}

function objectPropertyExpression(object: ast.ObjectExpression, name: string): ast.Node | undefined {
  for (const property of object.properties) {
    if (
      property.type === 'Property' &&
      !property.computed &&
      !property.method &&
      property.kind === 'init' &&
      propertyName(property.key) === name
    )
      return property.value;
  }
  return undefined;
}

function propertyName(name: ast.Node): string | undefined {
  if (name.type === 'Identifier') return name.name;
  return name.type === 'Literal' && (typeof name.value === 'string' || typeof name.value === 'number')
    ? String(name.value)
    : undefined;
}

function packageNameFromSpecifier(specifier: string): string {
  if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('node:')) {
    throw new Error(`raster factory ${specifier} is not imported from a package`);
  }
  const parts = specifier.split('/');
  const name = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!;
  if (name === '' || name === '@' || (specifier.startsWith('@') && parts.length < 2)) {
    throw new Error(`raster factory ${specifier} has an invalid package name`);
  }
  return name;
}

function requireNonArrayObject(value: unknown, name: string): Record<string, unknown> {
  assertNonArrayObject(value, name);
  return value;
}

function assertNonArrayObject(value: unknown, name: string): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be a non-array object`);
  }
}

function nonArrayObjectOrUndefined(value: unknown): Record<string, unknown> | undefined {
  return isNonArrayObject(value) ? value : undefined;
}

function isNonArrayObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function failure(
  code: DiscoveryDiagnostic['code'],
  message: string,
  sourceFile: DiscoverySource,
  expression: string,
): { diagnostic: DiscoveryDiagnostic } {
  return { diagnostic: { code, message, sourceFile: sourceFile.fileName, expression } };
}

async function resolveEntries(projectRoot: string, values: DiscoveryOptions['entries']): Promise<string[]> {
  if (values !== undefined) return values.map((value) => resolve(projectRoot, pathValue(value)));
  const sourceRoot = join(projectRoot, 'src');
  return collectSourceFiles(sourceRoot);
}

async function collectSourceFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) return files;
    throw error;
  }
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectSourceFiles(path)));
    else if (entry.isFile() && /\.[cm]?[jt]sx?$/.test(entry.name)) files.push(path);
  }
  return files.sort();
}

async function resolveAssetRoots(projectRoot: string, values: DiscoveryOptions['assetRoots']): Promise<string[]> {
  if (values !== undefined)
    return Promise.all(values.map((value) => canonicalDirectory(resolve(projectRoot, pathValue(value)))));
  try {
    return [await canonicalDirectory(join(projectRoot, 'public'))];
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
}

async function canonicalDirectory(path: string): Promise<string> {
  const canonical = await realpath(path);
  if (!(await stat(canonical)).isDirectory()) throw new Error(`${path} is not a directory`);
  return canonical;
}

function pathValue(value: string | URL): string {
  return value instanceof URL ? fileURLToPath(value) : value;
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function within(root: string, candidate: string): boolean {
  const path = relative(resolve(root), resolve(candidate));
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}

function publicPath(root: string, file: string): string {
  return `/${relative(root, file).split(sep).join('/')}`;
}

function compareSourcePosition(
  a: { readonly value: { readonly sourceFile: string }; readonly sourceOffset: number },
  b: { readonly value: { readonly sourceFile: string }; readonly sourceOffset: number },
): number {
  return a.value.sourceFile.localeCompare(b.value.sourceFile) || a.sourceOffset - b.sourceOffset;
}
