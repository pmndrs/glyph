import { readFileSync } from 'node:fs';
import { isAbsolute, relative, sep } from 'node:path';
import { parseSync, type Node } from 'oxc-parser';
import type * as ast from 'oxc-parser';
import { ScopeTracker, walk, type ScopeTrackerNode } from 'oxc-walker';
import { ResolverFactory } from 'oxc-resolver';

export interface ImportedBinding {
  readonly module: string;
  readonly exported: string;
  readonly sourceFile: string;
}

export interface DiscoverySource {
  readonly fileName: string;
  readonly text: string;
  readonly program: ast.Program;
  readonly scope: ScopeTracker;
  readonly calls: readonly ast.CallExpression[];
}

type ResolvedBinding =
  | { readonly kind: 'import'; readonly binding: ImportedBinding }
  | { readonly kind: 'constant'; readonly declaration: ast.VariableDeclarator }
  | { readonly kind: 'expression'; readonly expression: ast.Node };

/** A read-only source graph. Oxc owns syntax, lexical scopes, and module resolution. */
export class DiscoverySources {
  readonly files: Map<string, DiscoverySource> = new Map();
  readonly #bindings = new WeakMap<ast.Node, ScopeTrackerNode>();
  readonly #writes = new Set<ScopeTrackerNode>();
  readonly #owners = new WeakMap<ast.Node, DiscoverySource>();
  readonly #resolver = new ResolverFactory({
    tsconfig: 'auto',
    symlinks: false,
    conditionNames: ['source', 'import', 'node', 'default'],
    extensions: ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'],
    extensionAlias: {
      '.js': ['.ts', '.tsx', '.js'],
      '.jsx': ['.tsx', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
      '.cjs': ['.cts', '.cjs'],
    },
  });

  constructor(
    readonly projectRoot: string,
    entries: readonly string[],
    signal?: AbortSignal,
  ) {
    const queue = [...entries];
    for (const fileName of queue) {
      signal?.throwIfAborted();
      if (this.files.has(fileName) || !this.#isProjectSource(fileName)) continue;
      const file = this.#read(fileName);
      this.files.set(fileName, file);
      for (const statement of file.program.body) {
        if (
          (statement.type === 'ImportDeclaration' && statement.importKind !== 'type') ||
          ((statement.type === 'ExportNamedDeclaration' || statement.type === 'ExportAllDeclaration') &&
            statement.exportKind !== 'type')
        ) {
          if (statement.source === null || statement.source === undefined) continue;
          const resolved = this.#resolve(fileName, statement.source.value);
          if (resolved !== undefined) queue.push(resolved);
        }
      }
    }
  }

  source(node: ast.Node): DiscoverySource {
    return this.#owners.get(node)!;
  }

  text(node: ast.Node): string {
    return this.source(node).text.slice(node.start, node.end);
  }

  importedBinding(expression: ast.Node): ImportedBinding | undefined {
    // The authored package/export pair selects a baker manifest even when the package is workspace-linked.
    const resolved = this.#binding(unwrapExpression(expression), new Set(), false);
    return resolved?.kind === 'import' ? resolved.binding : undefined;
  }

  constantInitializer(expression: ast.Node, seen: Set<ast.Node>): ast.Node | undefined {
    const resolved = this.#binding(unwrapExpression(expression), new Set());
    if (resolved === undefined || resolved.kind === 'import') return undefined;
    const identity = resolved.kind === 'constant' ? resolved.declaration : resolved.expression;
    if (seen.has(identity)) return undefined;
    seen.add(identity);
    return resolved.kind === 'constant' ? (resolved.declaration.init ?? undefined) : resolved.expression;
  }

  #binding(node: ast.Node, seen: Set<ast.Node>, followImports = true): ResolvedBinding | undefined {
    if (node.type === 'Identifier') {
      const binding = this.#bindings.get(node);
      return binding === undefined ? undefined : this.#resolveBinding(binding, seen, followImports);
    }
    if (
      node.type === 'MemberExpression' &&
      !node.computed &&
      node.object.type === 'Identifier' &&
      node.property.type === 'Identifier'
    ) {
      const binding = this.#bindings.get(node.object);
      if (binding?.type === 'Import' && binding.node.type === 'ImportNamespaceSpecifier') {
        const declaration = binding.importNode;
        if (declaration.importKind !== 'type') {
          return this.#import(declaration, node.property.name, seen, followImports);
        }
      }
    }
    return undefined;
  }

  #resolveBinding(binding: ScopeTrackerNode, seen: Set<ast.Node>, followImports = true): ResolvedBinding | undefined {
    const node = binding.node;
    if (seen.has(node)) return undefined;
    seen.add(node);
    if (binding.type === 'Variable' && binding.variableNode.kind === 'const' && !this.#writes.has(binding)) {
      const declaration = binding.variableNode.declarations.find((entry) => entry.id === node);
      if (declaration !== undefined) return { kind: 'constant', declaration };
    }
    if (binding.type !== 'Import' || binding.importNode.importKind === 'type') return undefined;
    const specifier = binding.node;
    if (specifier.type === 'ImportSpecifier' && specifier.importKind !== 'type') {
      return this.#import(
        binding.importNode,
        specifier.imported.type === 'Identifier' ? specifier.imported.name : specifier.imported.value,
        seen,
        followImports,
      );
    }
    if (specifier.type === 'ImportDefaultSpecifier')
      return this.#import(binding.importNode, 'default', seen, followImports);
    return undefined;
  }

  #import(
    declaration: ast.ImportDeclaration | ast.ExportNamedDeclaration | ast.ExportAllDeclaration,
    name: string,
    seen: Set<ast.Node>,
    followImports = true,
  ): ResolvedBinding | undefined {
    const specifier = declaration.source!.value;
    const sourceFile = this.source(declaration).fileName;
    const imported: ResolvedBinding = { kind: 'import', binding: { module: specifier, exported: name, sourceFile } };
    if (!followImports) return imported;
    const resolved = this.#resolve(sourceFile, specifier);
    const file = resolved === undefined ? undefined : this.files.get(resolved);
    if (file !== undefined) return this.#export(file, name, seen);
    if (specifier.startsWith('.') || isAbsolute(specifier)) return undefined;
    return imported;
  }

  #export(file: DiscoverySource, name: string, seen: Set<ast.Node>): ResolvedBinding | undefined {
    for (const statement of file.program.body) {
      if (seen.has(statement)) continue;
      if (statement.type === 'ExportDefaultDeclaration' && name === 'default') {
        return { kind: 'expression', expression: statement.declaration };
      }
      if (statement.type !== 'ExportNamedDeclaration' || statement.exportKind === 'type') continue;
      if (statement.declaration !== null && statement.declaration !== undefined) {
        const binding = file.scope.getDeclaration(name);
        if (binding?.type === 'Variable' && binding.variableNode === statement.declaration) {
          return this.#resolveBinding(binding, seen);
        }
      }
      for (const specifier of statement.specifiers) {
        if (specifier.type !== 'ExportSpecifier' || specifier.exportKind === 'type') continue;
        const exported = specifier.exported.type === 'Identifier' ? specifier.exported.name : specifier.exported.value;
        if (exported !== name) continue;
        seen.add(statement);
        if (statement.source !== null && statement.source !== undefined) {
          return this.#import(
            statement,
            specifier.local.type === 'Identifier' ? specifier.local.name : specifier.local.value,
            seen,
          );
        }
        const binding = file.scope.getDeclaration(
          specifier.local.type === 'Identifier' ? specifier.local.name : specifier.local.value,
        );
        return binding === null ? undefined : this.#resolveBinding(binding, seen);
      }
    }
    if (name === 'default') return undefined;
    let result: ResolvedBinding | undefined;
    for (const statement of file.program.body) {
      if (
        statement.type !== 'ExportAllDeclaration' ||
        statement.exported !== null ||
        statement.exportKind === 'type' ||
        seen.has(statement)
      )
        continue;
      const branch = new Set(seen).add(statement);
      const candidate = this.#import(statement, name, branch);
      if (candidate === undefined) continue;
      // Ambiguous star exports must not silently select one font declaration.
      if (result !== undefined && !sameBinding(result, candidate)) return undefined;
      result = candidate;
    }
    return result;
  }

  #resolve(fileName: string, specifier: string): string | undefined {
    const path = this.#resolver.resolveFileSync(fileName, specifier).path;
    return path !== undefined && this.#isProjectSource(path) ? path : undefined;
  }

  #isProjectSource(fileName: string): boolean {
    const path = relative(this.projectRoot, fileName);
    return (
      !isAbsolute(path) &&
      path !== '..' &&
      !path.startsWith(`..${sep}`) &&
      !path.split(sep).includes('node_modules') &&
      /\.[cm]?[jt]sx?$/.test(path) &&
      !/\.d\.[cm]?ts$/.test(path)
    );
  }

  #read(fileName: string): DiscoverySource {
    const text = readFileSync(fileName, 'utf8');
    const parsed = parseSync(fileName, text, { sourceType: 'unambiguous', showSemanticErrors: true });
    const errors = parsed.errors.filter((error) => error.severity === 'Error');
    if (errors.length > 0) throw new SyntaxError(`${fileName}: ${errors.map((error) => error.message).join('; ')}`);
    const program = parsed.program;
    const scope = new ScopeTracker({ preserveExitedScopes: true });
    const calls: ast.CallExpression[] = [];
    const writes: Node[] = [];
    const file: DiscoverySource = { fileName, text, program, scope, calls };
    // Collect all declarations before resolving references, including references before a declaration.
    walk(program, {
      scopeTracker: scope,
      enter: (node) => {
        this.#owners.set(node, file);
        if (node.type === 'CallExpression') calls.push(node);
        if (node.type === 'AssignmentExpression') writes.push(node.left);
        if (node.type === 'UpdateExpression') writes.push(node.argument);
        if (
          (node.type === 'ForInStatement' || node.type === 'ForOfStatement') &&
          node.left.type !== 'VariableDeclaration'
        )
          writes.push(node.left);
      },
    });
    scope.freeze();
    walk(program, {
      scopeTracker: scope,
      enter: (node) => {
        if (node.type !== 'Identifier') return;
        const binding = scope.getDeclaration(node.name);
        if (binding !== null) this.#bindings.set(node, binding);
      },
    });
    for (const target of writes) this.#markWrite(target);
    return file;
  }

  #markWrite(target: Node): void {
    const node = unwrapExpression(target);
    switch (node.type) {
      case 'Identifier': {
        const binding = this.#bindings.get(node);
        if (binding !== undefined) this.#writes.add(binding);
        break;
      }
      case 'ArrayPattern':
        for (const element of node.elements) if (element !== null) this.#markWrite(element);
        break;
      case 'ObjectPattern':
        for (const property of node.properties)
          this.#markWrite(property.type === 'RestElement' ? property.argument : property.value);
        break;
      case 'AssignmentPattern':
        this.#markWrite(node.left);
        break;
      case 'RestElement':
        this.#markWrite(node.argument);
        break;
    }
  }
}

function sameBinding(left: ResolvedBinding, right: ResolvedBinding): boolean {
  switch (left.kind) {
    case 'constant':
      return right.kind === 'constant' && left.declaration === right.declaration;
    case 'expression':
      return right.kind === 'expression' && left.expression === right.expression;
    case 'import':
      return (
        right.kind === 'import' &&
        left.binding.module === right.binding.module &&
        left.binding.exported === right.binding.exported &&
        left.binding.sourceFile === right.binding.sourceFile
      );
  }
}

export function unwrapExpression(expression: ast.Node): ast.Node {
  let value = expression;
  while (
    value.type === 'TSAsExpression' ||
    value.type === 'TSSatisfiesExpression' ||
    value.type === 'TSNonNullExpression' ||
    value.type === 'TSTypeAssertion' ||
    value.type === 'ParenthesizedExpression' ||
    value.type === 'TSInstantiationExpression'
  ) {
    value = value.expression;
  }
  return value;
}
