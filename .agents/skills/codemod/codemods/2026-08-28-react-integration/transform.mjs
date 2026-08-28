export const metadata = Object.freeze({ id: '2026-08-28-react-integration' });

const REACT_MODULES = new Set(['@pmndrs/glyph/react', '../../src/react.js']);
const CONVENIENCE_HOOKS = new Set(['useBitmapFont', 'useMSDF', 'useSlug']);

export function transform({ project, renameSymbol, tsMorph }) {
  for (const sourceFile of project.getSourceFiles()) {
    if (sourceFile.isDeclarationFile()) continue;
    const imports = sourceFile
      .getImportDeclarations()
      .filter((declaration) => REACT_MODULES.has(declaration.getModuleSpecifierValue()));
    if (imports.length === 0) continue;

    const boundHooks = new Set();
    for (const declaration of sourceFile.getDescendantsOfKind(tsMorph.SyntaxKind.VariableDeclaration)) {
      const initializer = declaration.getInitializerIfKind(tsMorph.SyntaxKind.CallExpression);
      if (initializer?.getExpression().getText() !== 'createUseFont') continue;
      boundHooks.add(declaration.getName());
      initializer.replaceWithText('useFont');
    }

    replaceImportedType(sourceFile, imports, 'BoundUseFont', 'UseFont');
    replaceTextSpan(sourceFile, imports);
    renameInlineTextAliases(sourceFile, renameSymbol, tsMorph);
    rewriteFontCalls(sourceFile, boundHooks, tsMorph);
    removeUnusedImports(sourceFile, imports, ['createUseFont', 'GlyphProvider'], tsMorph);
    ensureUseFontImport(imports, sourceFile, boundHooks.size > 0);
  }
}

function renameInlineTextAliases(sourceFile, renameSymbol, tsMorph) {
  for (const declaration of sourceFile.getDescendantsOfKind(tsMorph.SyntaxKind.VariableDeclaration)) {
    const name = declaration.getName();
    if (!name.endsWith('TextSpan') || !declaration.getInitializer()?.getText().startsWith('Text<')) continue;
    renameSymbol(declaration, `${name.slice(0, -'TextSpan'.length)}InlineText`);
  }
}

function replaceImportedType(_sourceFile, imports, from, to) {
  for (const declaration of imports) {
    const imported = declaration.getNamedImports().find((entry) => entry.getName() === from);
    if (imported === undefined) continue;
    const local = imported.getAliasNode()?.getText() ?? imported.getName();
    const replacement = local === from ? to : local;
    for (const reference of imported.getNameNode().findReferencesAsNodes()) reference.replaceWithText(replacement);
    imported.replaceWithText(local === from ? `type ${to}` : `type ${to} as ${local}`);
  }
}

function replaceTextSpan(sourceFile, imports) {
  const textImport = imports.flatMap((entry) => entry.getNamedImports()).find((entry) => entry.getName() === 'Text');
  const textName = textImport?.getAliasNode()?.getText() ?? 'Text';
  for (const declaration of imports) {
    const span = declaration.getNamedImports().find((entry) => entry.getName() === 'TextSpan');
    if (span === undefined) continue;
    const local = span.getAliasNode()?.getText() ?? span.getName();
    for (const reference of span.getNameNode().findReferencesAsNodes()) reference.replaceWithText(textName);
    span.remove();
    if (textImport === undefined) declaration.addNamedImport({ name: 'Text' });
    void local;
  }
  void sourceFile;
}

function rewriteFontCalls(sourceFile, boundHooks, tsMorph) {
  for (const call of [...sourceFile.getDescendantsOfKind(tsMorph.SyntaxKind.CallExpression)]) {
    const expression = call.getExpression();
    let hook;
    let operation;
    if (tsMorph.Node.isIdentifier(expression)) hook = expression.getText();
    else if (tsMorph.Node.isPropertyAccessExpression(expression)) {
      hook = expression.getExpression().getText();
      operation = expression.getName();
    } else continue;

    if (CONVENIENCE_HOOKS.has(hook) && (operation === 'preload' || operation === 'clear')) {
      const arguments_ = call.getArguments();
      if (arguments_.length >= 3 || isFontLibraryExpression(arguments_[0], tsMorph)) call.removeArgument(0);
      continue;
    }
    if (hook !== 'useFont' && !boundHooks.has(hook)) continue;
    const arguments_ = call.getArguments();
    const requestExpression =
      hook === 'useFont' && operation !== undefined && arguments_.length === 2 ? arguments_[1] : arguments_[0];
    const request = requestArguments(requestExpression, tsMorph);
    if (request === undefined) continue;
    call.replaceWithText(`${operation === undefined ? 'useFont' : `useFont.${operation}`}(${request.join(', ')})`);
  }
}

function isFontLibraryExpression(expression, tsMorph) {
  if (expression === undefined) return false;
  if (tsMorph.Node.isIdentifier(expression) && /library$/i.test(expression.getText())) return true;
  const type = expression.getType().getText();
  return /(?:^|\.)FontLibrary(?:<.*>)?$/.test(type);
}

function requestArguments(expression, tsMorph) {
  const object = resolveObjectLiteral(expression, tsMorph);
  if (object === undefined || object.getProperty('rasters') !== undefined) return undefined;
  const input = propertyInitializer(object, 'input', tsMorph);
  const raster = resolveObjectLiteral(propertyInitializerNode(object, 'raster', tsMorph), tsMorph);
  if (input === undefined || raster === undefined) return undefined;
  const technique = propertyInitializer(raster, 'technique', tsMorph);
  const options = propertyInitializer(raster, 'options', tsMorph);
  if (technique === undefined) return undefined;
  return options === undefined ? [input, technique] : [input, technique, options];
}

function resolveObjectLiteral(expression, tsMorph) {
  if (expression === undefined) return undefined;
  if (
    tsMorph.Node.isAsExpression(expression) ||
    tsMorph.Node.isSatisfiesExpression(expression) ||
    tsMorph.Node.isParenthesizedExpression(expression)
  )
    return resolveObjectLiteral(expression.getExpression(), tsMorph);
  if (tsMorph.Node.isObjectLiteralExpression(expression)) return expression;
  if (!tsMorph.Node.isIdentifier(expression)) return undefined;
  const declaration =
    expression.getSymbol()?.getValueDeclaration() ?? expression.getDefinitions()[0]?.getDeclarationNode();
  const initializer = tsMorph.Node.isVariableDeclaration(declaration) ? declaration.getInitializer() : undefined;
  if (
    tsMorph.Node.isAsExpression(initializer) ||
    tsMorph.Node.isSatisfiesExpression(initializer) ||
    tsMorph.Node.isParenthesizedExpression(initializer)
  )
    return resolveObjectLiteral(initializer.getExpression(), tsMorph);
  return tsMorph.Node.isVariableDeclaration(declaration)
    ? declaration.getInitializerIfKind(tsMorph.SyntaxKind.ObjectLiteralExpression)
    : undefined;
}

function propertyInitializer(object, name, tsMorph) {
  return propertyInitializerNode(object, name, tsMorph)?.getText();
}

function propertyInitializerNode(object, name, tsMorph) {
  const property = object.getProperty(name);
  if (tsMorph.Node.isPropertyAssignment(property)) return property.getInitializer();
  if (tsMorph.Node.isShorthandPropertyAssignment(property)) return property.getNameNode();
  return undefined;
}

function removeUnusedImports(sourceFile, imports, names, tsMorph) {
  for (const declaration of imports) {
    for (const name of names) {
      const imported = declaration.getNamedImports().find((entry) => entry.getName() === name);
      if (imported === undefined) continue;
      const local = imported.getAliasNode()?.getText() ?? imported.getName();
      const used = sourceFile
        .getDescendantsOfKind(tsMorph.SyntaxKind.Identifier)
        .some(
          (identifier) =>
            identifier.getText() === local &&
            identifier.getFirstAncestorByKind(tsMorph.SyntaxKind.ImportSpecifier) === undefined,
        );
      if (!used) imported.remove();
    }
  }
}

function ensureUseFontImport(imports, sourceFile, needed) {
  if (!needed) return;
  const existing = imports.flatMap((entry) => entry.getNamedImports()).some((entry) => entry.getName() === 'useFont');
  if (!existing)
    (imports[0] ?? sourceFile.addImportDeclaration({ moduleSpecifier: '@pmndrs/glyph/react' })).addNamedImport(
      'useFont',
    );
}
