import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
  ast as ts,
  constantInitializer,
  importedBinding,
  openCompilerProjectSnapshot,
  shorthandInitializer,
  unwrapExpression as unwrap,
  type CompilerChecker as Checker,
  type CompilerProject as Project,
  type ImportedBinding,
} from './compiler-adapter.js';

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
  const snapshot = openCompilerProjectSnapshot(projectRoot, entries);
  try {
    for (const project of snapshot.projects) {
      const checker = project.checker;
      for (const fileName of project.program.getSourceFileNames()) {
        const sourceFile = project.program.getSourceFile(fileName);
        if (sourceFile === undefined || sourceFile.isDeclarationFile || !within(projectRoot, fileName)) continue;
        options.signal?.throwIfAborted();
        const visit = (node: ts.Node): void => {
          if (ts.isCallExpression(node)) {
            const binding = importedBinding(node.expression, checker, project);
            if (binding?.module === '@pmndrs/text' && binding.exported === 'defineFont') {
              const sourceOffset = node.getStart(sourceFile);
              analyses.push(
                analyzeDefinition(
                  node.arguments[0],
                  node.arguments[1],
                  node.getText(sourceFile),
                  sourceFile,
                  checker,
                  project,
                  assetRoots,
                ).then((result) => {
                  if (result === undefined) return;
                  if ('font' in result) fonts.push({ value: result.font, sourceOffset });
                  else diagnostics.push({ value: result.diagnostic, sourceOffset });
                }),
              );
            }
          }
          node.forEachChild(visit);
        };
        visit(sourceFile);
      }
    }
    await Promise.all(analyses);
  } finally {
    snapshot.close();
  }
  fonts.sort(compareSourcePosition);
  diagnostics.sort(compareSourcePosition);
  return {
    fonts: fonts.map(({ value }) => value),
    diagnostics: diagnostics.map(({ value }) => value),
  };
}

async function analyzeDefinition(
  input: ts.Expression | undefined,
  rasterExpression: ts.Expression | undefined,
  expression: string,
  sourceFile: ts.SourceFile,
  checker: Checker,
  project: Project,
  assetRoots: readonly string[],
): Promise<{ font: DiscoveredFontDefinition } | { diagnostic: DiscoveryDiagnostic } | undefined> {
  if (input === undefined) {
    return failure('dynamic-font-source', 'defineFont has no source input', sourceFile, expression);
  }
  const selection = fontSourceSelection(input, checker, project);
  if (selection?.baked === true) return undefined;
  const source = selection === undefined ? undefined : staticString(selection.source, checker, project);
  if (source === undefined) {
    return failure(
      'dynamic-font-source',
      'font source has no statically provable local pathname',
      sourceFile,
      expression,
    );
  }
  const resolved = await resolveFontSource(source, sourceFile.fileName, assetRoots);
  if (resolved.resolvedFile === undefined) {
    return failure(
      resolved.code ?? 'missing-font-source',
      resolved.reason ?? 'font source did not resolve',
      sourceFile,
      expression,
    );
  }
  const raster = await resolveRaster(rasterExpression, checker, project, sourceFile);
  if ('diagnostic' in raster) return raster;
  return {
    font: {
      expression,
      sourceFile: sourceFile.fileName,
      resolvedFile: resolved.resolvedFile,
      assetRoot: resolved.assetRoot!,
      publicPathname: resolved.publicPathname!,
      raster: raster.raster,
    },
  };
}

function fontSourceSelection(
  expression: ts.Expression,
  checker: Checker,
  project: Project,
  seen = new Set<number>(),
): { readonly source: ts.Expression; readonly baked?: false } | { readonly baked: true } | undefined {
  const value = unwrap(expression);
  if (ts.isIdentifier(value)) {
    const initializer = constantInitializer(value, checker, project, seen);
    if (initializer !== undefined) return fontSourceSelection(initializer, checker, project, seen);
  }
  if (!ts.isObjectLiteralExpression(value)) return { source: value };
  const source = objectPropertyExpression(value, 'source');
  if (source !== undefined) return { source };
  return objectPropertyExpression(value, 'baked') === undefined ? undefined : { baked: true };
}

async function resolveRaster(
  expression: ts.Expression | undefined,
  checker: Checker,
  project: Project,
  sourceFile: ts.SourceFile,
): Promise<{ raster: ResolvedRasterBaker } | { diagnostic: DiscoveryDiagnostic }> {
  const text = expression?.getText(sourceFile) ?? '<missing raster>';
  const value = expression === undefined ? undefined : constantExpression(expression, checker, project);
  if (value === undefined) {
    return failure('invalid-raster-options', 'raster must be a statically visible factory call', sourceFile, text);
  }
  const moduleExpression = ts.isCallExpression(value)
    ? value.expression
    : ts.isObjectLiteralExpression(value)
      ? objectPropertyExpression(value, 'module')
      : value;
  const optionsExpression = ts.isCallExpression(value)
    ? value.arguments[0]
    : ts.isObjectLiteralExpression(value)
      ? objectPropertyExpression(value, 'options')
      : undefined;
  const binding = moduleExpression === undefined ? undefined : importedBinding(moduleExpression, checker, project);
  if (binding === undefined) {
    return failure('invalid-raster-options', 'raster factory is not an imported ESM binding', sourceFile, text);
  }
  const options = optionsExpression === undefined ? {} : staticJson(optionsExpression, checker, project);
  if (options === undefined) {
    return failure('invalid-raster-options', 'raster options are not immutable JSON literals', sourceFile, text);
  }
  try {
    const manifest = await rasterManifest(binding, sourceFile.fileName);
    return { raster: { ...manifest, options } };
  } catch (error) {
    return failure('invalid-raster-manifest', error instanceof Error ? error.message : String(error), sourceFile, text);
  }
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
  const map = nonArrayObjectOrUndefined(pmndrs?.text);
  const target = map?.[binding.exported];
  if (typeof target !== 'string' || !target.startsWith('./')) {
    throw new Error(`raster manifest has no pmndrs.text entry for ${binding.exported}`);
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
  expression: ts.Expression,
  checker: Checker,
  project: Project,
  seen = new Set<number>(),
): StaticString | undefined {
  const value = unwrap(expression);
  if (ts.isStringLiteralLikeNode(value)) return { exact: value.text, suffix: value.text };
  if (ts.isIdentifier(value)) {
    const initializer = constantInitializer(value, checker, project, seen);
    return initializer === undefined ? undefined : staticString(initializer, checker, project, seen);
  }
  if (ts.isBinaryExpression(value) && value.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = staticString(value.left, checker, project, new Set(seen));
    const right = staticString(value.right, checker, project, new Set(seen));
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
  if (ts.isTemplateExpression(value)) {
    let exact: string | undefined = value.head.text;
    let suffix = value.head.text;
    for (const span of value.templateSpans) {
      const part = staticString(span.expression, checker, project, new Set(seen));
      exact = exact === undefined || part?.exact === undefined ? undefined : exact + part.exact + span.literal.text;
      suffix = part?.exact === undefined ? span.literal.text : suffix + part.exact + span.literal.text;
    }
    return exact === undefined ? (suffix === '' ? undefined : { suffix }) : { exact, suffix: exact };
  }
  if (
    ts.isNewExpression(value) &&
    ts.isIdentifier(value.expression) &&
    value.expression.text === 'URL' &&
    value.arguments !== undefined
  ) {
    const first =
      value.arguments[0] === undefined ? undefined : staticString(value.arguments[0], checker, project, new Set(seen));
    if (first?.exact !== undefined && value.arguments.length === 2 && isImportMetaUrl(value.arguments[1]!)) {
      return { moduleRelative: first.exact };
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

function staticJson(
  expression: ts.Expression,
  checker: Checker,
  project: Project,
  seen = new Set<number>(),
): unknown | undefined {
  const value = unwrap(expression);
  if (ts.isStringLiteralLikeNode(value)) return value.text;
  if (ts.isNumericLiteral(value)) return Number(value.text);
  if (value.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (value.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (value.kind === ts.SyntaxKind.NullKeyword) return null;
  if (
    ts.isPrefixUnaryExpression(value) &&
    value.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(value.operand)
  ) {
    return -Number(value.operand.text);
  }
  if (ts.isIdentifier(value)) {
    const initializer = constantInitializer(value, checker, project, seen);
    return initializer === undefined ? undefined : staticJson(initializer, checker, project, seen);
  }
  if (ts.isArrayLiteralExpression(value)) {
    const result: unknown[] = [];
    for (const element of value.elements) {
      if (ts.isSpreadElement(element)) return undefined;
      const item = staticJson(element, checker, project, new Set(seen));
      if (item === undefined) return undefined;
      result.push(item);
    }
    return result;
  }
  if (ts.isObjectLiteralExpression(value)) {
    const result: Record<string, unknown> = {};
    for (const property of value.properties) {
      if (ts.isSpreadAssignment(property)) return undefined;
      const name = propertyName(property.name);
      const propertySeen = new Set(seen);
      const item = ts.isPropertyAssignment(property)
        ? staticJson(property.initializer, checker, project, propertySeen)
        : ts.isShorthandPropertyAssignment(property)
          ? staticJsonInitializer(
              shorthandInitializer(property, checker, project, propertySeen),
              checker,
              project,
              propertySeen,
            )
          : undefined;
      if (name === undefined || item === undefined) return undefined;
      result[name] = item;
    }
    return result;
  }
  return undefined;
}

function staticJsonInitializer(
  initializer: ts.Expression | undefined,
  checker: Checker,
  project: Project,
  seen: Set<number>,
): unknown | undefined {
  return initializer === undefined ? undefined : staticJson(initializer, checker, project, seen);
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
      const file = resolve(dirname(sourceFile), `.${pathname.startsWith('/') ? pathname : `/${pathname}`}`);
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

function isImportMetaUrl(expression: ts.Expression): boolean {
  return (
    ts.isPropertyAccessExpression(expression) &&
    expression.name.text === 'url' &&
    ts.isMetaProperty(expression.expression) &&
    expression.expression.keywordToken === ts.SyntaxKind.ImportKeyword
  );
}

function constantExpression(
  expression: ts.Expression,
  checker: Checker,
  project: Project,
  seen = new Set<number>(),
): ts.Expression {
  const value = unwrap(expression);
  if (!ts.isIdentifier(value)) return value;
  const initializer = constantInitializer(value, checker, project, seen);
  return initializer === undefined ? value : constantExpression(initializer, checker, project, seen);
}

function objectPropertyExpression(object: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  for (const property of object.properties) {
    if (ts.isPropertyAssignment(property) && propertyName(property.name) === name) return property.initializer;
    if (ts.isShorthandPropertyAssignment(property) && ts.isIdentifier(property.name) && property.name.text === name)
      return property.name;
  }
  return undefined;
}

function propertyName(name: ts.PropertyName): string | undefined {
  return ts.isIdentifier(name) || ts.isStringLiteralLikeNode(name) || ts.isNumericLiteral(name) ? name.text : undefined;
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
  sourceFile: ts.SourceFile,
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
