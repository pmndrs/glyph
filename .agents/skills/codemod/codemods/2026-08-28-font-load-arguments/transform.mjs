export const metadata = Object.freeze({ id: '2026-08-28-font-load-arguments' });

export function transform({ project, renameSymbol, tsMorph }) {
  const threeLoader = project.getSourceFile((source) =>
    source.getFilePath().replaceAll('\\', '/').endsWith('/packages/glyph/src/three/font-loader.ts'),
  );
  const legacyThreeRequest = threeLoader?.getTypeAlias('ThreeLoadedFontRequest');
  if (legacyThreeRequest !== undefined) renameSymbol(legacyThreeRequest, 'ThreeFontLoadRequest');
  for (const sourceFile of project.getSourceFiles()) {
    if (sourceFile.isDeclarationFile()) continue;
    replaceLegacyRasterTypes(sourceFile, tsMorph);
    for (const call of sourceFile.getDescendantsOfKind(tsMorph.SyntaxKind.CallExpression).reverse()) {
      if (!isPortableLoadCall(call, tsMorph) && !isPortableClearCall(call, tsMorph)) continue;
      const [request, ...rest] = call.getArguments();
      const fields = requestFields(request, tsMorph);
      if (fields === undefined) continue;
      call.replaceWithText(
        `${call.getExpression().getText()}(${[fields.input, fields.rasters, ...rest.map((argument) => argument.getText())].join(', ')})`,
      );
    }
  }
}

function replaceLegacyRasterTypes(sourceFile, tsMorph) {
  for (const declaration of sourceFile.getImportDeclarations()) {
    const legacy = declaration.getNamedImports().find((specifier) => specifier.getName() === 'FontRequest');
    if (legacy === undefined) continue;
    const local = legacy.getAliasNode()?.getText() ?? legacy.getName();
    let replacements = 0;
    for (const indexed of sourceFile.getDescendantsOfKind(tsMorph.SyntaxKind.IndexedAccessType).reverse()) {
      const object = indexed.getObjectTypeNode();
      const index = indexed.getIndexTypeNode();
      if (!tsMorph.Node.isTypeReference(object) || object.getTypeName().getText() !== local) continue;
      if (index.getKind() !== tsMorph.SyntaxKind.LiteralType || index.getText() !== "'raster'") continue;
      const technique = object.getTypeArguments()[0];
      if (technique === undefined) continue;
      indexed.replaceWithText(`RasterTechniqueInput<${technique.getText()}>`);
      replacements += 1;
    }
    if (replacements === 0) continue;
    legacy.remove();
    if (!declaration.getNamedImports().some((specifier) => specifier.getName() === 'RasterTechniqueInput')) {
      declaration.addNamedImport(
        declaration.isTypeOnly() ? 'RasterTechniqueInput' : { name: 'RasterTechniqueInput', isTypeOnly: true },
      );
    }
  }
}

function isPortableLoadCall(call, tsMorph) {
  const expression = call.getExpression();
  if (tsMorph.Node.isIdentifier(expression)) {
    return expression.getText() === 'loadFont' && isGlyphSymbol(expression, tsMorph);
  }
  return (
    tsMorph.Node.isPropertyAccessExpression(expression) &&
    expression.getName() === 'loadFont' &&
    isGlyphLibraryMember(expression, tsMorph)
  );
}

function isPortableClearCall(call, tsMorph) {
  const expression = call.getExpression();
  return (
    tsMorph.Node.isPropertyAccessExpression(expression) &&
    expression.getName() === 'clear' &&
    isGlyphLibraryMember(expression, tsMorph)
  );
}

function isGlyphLibraryMember(expression, tsMorph) {
  if (isGlyphDefinition(expression.getNameNode(), tsMorph)) return true;
  const receiver = expression.getExpression();
  if (!tsMorph.Node.isIdentifier(receiver)) return false;
  const declaration = receiver.getDefinitions()[0]?.getDeclarationNode();
  if (!tsMorph.Node.isVariableDeclaration(declaration)) return false;
  const initializer = unwrap(declaration.getInitializer(), tsMorph);
  if (!tsMorph.Node.isCallExpression(initializer)) return false;
  const factory = initializer.getExpression();
  return (
    tsMorph.Node.isIdentifier(factory) && factory.getText() === 'createFontLibrary' && isGlyphSymbol(factory, tsMorph)
  );
}

function isGlyphSymbol(identifier, tsMorph) {
  for (const declaration of identifier.getSourceFile().getImportDeclarations()) {
    if (!isGlyphModule(declaration.getModuleSpecifierValue())) continue;
    for (const specifier of declaration.getNamedImports()) {
      const local = specifier.getAliasNode()?.getText() ?? specifier.getName();
      if (local === identifier.getText()) return true;
    }
  }
  return isGlyphDefinition(identifier, tsMorph);
}

function isGlyphDefinition(node, tsMorph) {
  return node.getDefinitions().some((definition) => {
    const declaration = definition.getDeclarationNode();
    if (declaration === undefined) return false;
    const module = declaration.getFirstAncestorByKind(tsMorph.SyntaxKind.ModuleDeclaration);
    if (module !== undefined && isGlyphModule(module.getName().replace(/^['"]|['"]$/g, ''))) return true;
    const path = declaration.getSourceFile().getFilePath().replaceAll('\\', '/');
    return (
      path.endsWith('/packages/glyph/src/loader.ts') ||
      /\/node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?@pmndrs\/glyph\//.test(path)
    );
  });
}

function isGlyphModule(specifier) {
  return specifier === '@pmndrs/glyph';
}

function requestFields(expression, tsMorph) {
  const value = unwrap(expression, tsMorph);
  if (tsMorph.Node.isObjectLiteralExpression(value)) {
    const input = propertyArgumentText(value, 'input', tsMorph);
    const rasters = propertyArgumentText(value, 'raster', tsMorph) ?? propertyArgumentText(value, 'rasters', tsMorph);
    return input === undefined || rasters === undefined ? undefined : { input, rasters };
  }
  if (!tsMorph.Node.isIdentifier(value)) return undefined;
  const declaration = value.getDefinitions()[0]?.getDeclarationNode();
  if (!tsMorph.Node.isVariableDeclaration(declaration)) return undefined;
  const initializer = unwrap(declaration.getInitializer(), tsMorph);
  if (!tsMorph.Node.isObjectLiteralExpression(initializer)) return undefined;
  const hasInput = propertyText(initializer, 'input', tsMorph) !== undefined;
  const rasterName = propertyText(initializer, 'raster', tsMorph) !== undefined ? 'raster' : 'rasters';
  if (!hasInput || propertyText(initializer, rasterName, tsMorph) === undefined) return undefined;
  return { input: `${value.getText()}.input`, rasters: `${value.getText()}.${rasterName}` };
}

function propertyArgumentText(object, name, tsMorph) {
  const property = object.getProperty(name);
  const value = propertyText(object, name, tsMorph);
  if (property === undefined || value === undefined) return undefined;
  const comments = property.getLeadingCommentRanges().map((range) => range.getText());
  return comments.length === 0 ? value : `${comments.join('\n')}\n${value}`;
}

function propertyText(object, name, tsMorph) {
  const property = object.getProperty(name);
  if (tsMorph.Node.isPropertyAssignment(property)) return property.getInitializer()?.getText();
  if (tsMorph.Node.isShorthandPropertyAssignment(property)) return property.getName();
  return undefined;
}

function unwrap(expression, tsMorph) {
  let value = expression;
  while (
    tsMorph.Node.isAsExpression(value) ||
    tsMorph.Node.isSatisfiesExpression(value) ||
    tsMorph.Node.isParenthesizedExpression(value)
  ) {
    value = value.getExpression();
  }
  return value;
}
