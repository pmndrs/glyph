import { version as compilerVersion } from 'typescript';
import { API, SymbolFlags, type Checker, type Project, type Symbol } from 'typescript/unstable/sync';
import * as ast from 'typescript/unstable/ast';

export { ast };
export type CompilerChecker = Checker;
export type CompilerProject = Project;

export interface ImportedBinding {
  readonly module: string;
  readonly exported: string;
}

export const supportedTypeScriptVersion = '7.0.2' as const;

export interface CompilerProjectSnapshot {
  readonly projects: readonly Project[];
  close(): void;
}

export function openCompilerProjectSnapshot(projectRoot: string, entries: readonly string[]): CompilerProjectSnapshot {
  if (compilerVersion !== supportedTypeScriptVersion) {
    throw new Error(
      `@pmndrs/glyph discovery supports TypeScript ${supportedTypeScriptVersion}; received ${compilerVersion}`,
    );
  }

  const api = new API({ cwd: projectRoot });
  const snapshot = api.updateSnapshot({ openFiles: [...entries] });
  try {
    const projects = new Map<string, Project>();
    for (const entry of entries) {
      const project = snapshot.getDefaultProjectForFile(entry);
      if (project === undefined) throw new Error(`TypeScript did not create a project for ${entry}`);
      projects.set(project.configFileName, project);
    }
    let closed = false;
    return {
      projects: [...projects.values()],
      close() {
        if (closed) return;
        closed = true;
        snapshot.dispose();
        api.close();
      },
    };
  } catch (error) {
    snapshot.dispose();
    api.close();
    throw error;
  }
}

export function importedBinding(
  expression: ast.Expression,
  checker: Checker,
  project: Project,
): ImportedBinding | undefined {
  const value = unwrapExpression(expression);
  if (ast.isIdentifier(value)) {
    for (const handle of checker.getSymbolAtLocation(value)?.declarations ?? []) {
      const declaration = handle.resolve(project);
      if (declaration === undefined || !ast.isImportSpecifier(declaration)) continue;
      const importDeclaration = declaration.parent.parent.parent;
      if (!ast.isImportDeclaration(importDeclaration) || !ast.isStringLiteral(importDeclaration.moduleSpecifier)) {
        continue;
      }
      return {
        module: importDeclaration.moduleSpecifier.text,
        exported: declaration.propertyName?.text ?? declaration.name.text,
      };
    }
  }
  if (ast.isPropertyAccessExpression(value) && ast.isIdentifier(value.expression)) {
    for (const handle of checker.getSymbolAtLocation(value.expression)?.declarations ?? []) {
      const declaration = handle.resolve(project);
      if (declaration === undefined || !ast.isNamespaceImport(declaration)) continue;
      const importDeclaration = declaration.parent.parent;
      if (!ast.isImportDeclaration(importDeclaration) || !ast.isStringLiteral(importDeclaration.moduleSpecifier)) {
        continue;
      }
      return { module: importDeclaration.moduleSpecifier.text, exported: value.name.text };
    }
  }
  return undefined;
}

export function constantInitializer(
  expression: ast.Expression,
  checker: Checker,
  project: Project,
  seen: Set<number> = new Set<number>(),
): ast.Expression | undefined {
  if (!ast.isIdentifier(expression)) return undefined;
  return staticInitializer(resolveAlias(checker.getSymbolAtLocation(expression), checker), project, seen);
}

export function shorthandInitializer(
  expression: ast.ShorthandPropertyAssignment,
  checker: Checker,
  project: Project,
  seen: Set<number>,
): ast.Expression | undefined {
  const symbol = checker.getShorthandAssignmentValueSymbol(expression);
  return staticInitializer(resolveAlias(symbol, checker), project, seen);
}

export function unwrapExpression(expression: ast.Expression): ast.Expression {
  let value = expression;
  while (
    ast.isParenthesizedExpression(value) ||
    ast.isAsExpression(value) ||
    ast.isSatisfiesExpression(value) ||
    ast.isNonNullExpression(value)
  )
    value = value.expression;
  return value;
}

function resolveAlias(symbol: Symbol | undefined, checker: Checker): Symbol | undefined {
  return symbol !== undefined && (symbol.flags & SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(symbol) : symbol;
}

function staticInitializer(
  symbol: Symbol | undefined,
  project: Project,
  seen: Set<number>,
): ast.Expression | undefined {
  if (symbol === undefined || seen.has(symbol.id)) return undefined;
  seen.add(symbol.id);
  const declaration = symbol.valueDeclaration?.resolve(project);
  if (
    declaration === undefined ||
    !ast.isVariableDeclaration(declaration) ||
    declaration.initializer === undefined ||
    !ast.isVariableDeclarationList(declaration.parent) ||
    (declaration.parent.flags & ast.NodeFlags.Const) === 0
  )
    return undefined;
  return declaration.initializer;
}
