export const metadata = Object.freeze({
  id: '2026-08-28-paragraph-contract',
  additionalGlobs: ['scripts/**/*.mts'],
});

const RENAMES = [
  ['/packages/glyph/src/text-properties.ts', 'interface', 'ParagraphStyle', 'TextStyle'],
  ['/packages/glyph/src/text-properties.ts', 'type', 'ParagraphLayoutPolicy', 'ParagraphLayout'],
  ['/packages/glyph/src/text-properties.ts', 'interface', 'ParagraphConstraints', 'Constraints'],
  ['/packages/glyph/src/layout.ts', 'interface', 'ParagraphLayout', 'GlyphLayout'],
  ['/packages/glyph/src/layout.ts', 'interface', 'ParagraphLayoutInspection', 'GlyphLayoutInspection'],
  ['/packages/glyph/src/layout.ts', 'function', 'copyParagraphLayoutInspection', 'copyGlyphLayoutInspection'],
];

export function transform({ project, renameSymbol, targetRoot, tsMorph }) {
  const protectedSources = new Map();
  for (const source of project.getSourceFiles()) {
    const path = normalized(source.getFilePath());
    if (path.includes('/dist/') || path.includes('/node_modules/') || path.includes('/generated/')) {
      protectedSources.set(source, source.getFullText());
    }
  }
  for (const [suffix, kind, before, after] of RENAMES) {
    const source = project.getSourceFile((value) => normalized(value.getFilePath()).endsWith(suffix));
    const declaration = namedDeclaration(source, kind, before);
    if (declaration !== undefined) renameSymbol(declaration, after);
  }
  renameMethod(project, renameSymbol, '/packages/glyph/src/paragraph.ts', 'Paragraph', 'layout', 'measure');
  renameInterfaceMethod(
    project,
    renameSymbol,
    '/packages/glyph/src/core/render-planner.ts',
    'RetainedText',
    'layout',
    'measure',
  );
  renameMethod(
    project,
    renameSymbol,
    '/packages/glyph/src/core/render-planner.ts',
    'RetainedTextImpl',
    'layout',
    'measure',
  );
  renameMethod(project, renameSymbol, '/packages/glyph/src/three/text.ts', 'Text', 'layout', 'measure');
  renameConsumerImports(project, targetRoot);
  renameConsumerMeasureCalls(project, targetRoot, tsMorph);
  for (const [source, text] of protectedSources) {
    if (source.getFullText() !== text) source.replaceWithText(text);
  }
}

function renameConsumerImports(project, targetRoot) {
  const names = [
    ['ParagraphLayoutInspection', 'GlyphLayoutInspection'],
    ['copyParagraphLayoutInspection', 'copyGlyphLayoutInspection'],
    ['ParagraphStyle', 'TextStyle'],
    ['ParagraphConstraints', 'Constraints'],
    ['ParagraphAxisConstraint', 'AxisConstraint'],
    ['ParagraphLayoutPolicy', 'ParagraphLayout'],
  ];
  for (const source of project.getSourceFiles()) {
    if (!insideTarget(source.getFilePath(), targetRoot)) continue;
    renamePairedParagraphLayoutImports(source, targetRoot);
    for (const declaration of source.getImportDeclarations()) {
      if (!declaration.getModuleSpecifierValue().startsWith('@pmndrs/glyph')) continue;
      for (const [before, after] of names) {
        const specifier = declaration.getNamedImports().find((value) => value.getName() === before);
        if (specifier !== undefined) renameImportSpecifier(specifier, after, targetRoot);
      }
    }
  }
}

function renamePairedParagraphLayoutImports(source, targetRoot) {
  const glyphImports = source
    .getImportDeclarations()
    .filter((declaration) => declaration.getModuleSpecifierValue().startsWith('@pmndrs/glyph'));
  const hasLegacyPolicy = glyphImports.some((declaration) =>
    declaration.getNamedImports().some((specifier) => specifier.getName() === 'ParagraphLayoutPolicy'),
  );
  if (!hasLegacyPolicy) return;
  for (const declaration of glyphImports) {
    const specifier = declaration.getNamedImports().find((value) => value.getName() === 'ParagraphLayout');
    if (specifier !== undefined) renameImportSpecifier(specifier, 'GlyphLayout', targetRoot);
  }
}

function renameImportSpecifier(specifier, after, targetRoot) {
  if (specifier.getAliasNode() === undefined) {
    for (const reference of specifier.getNameNode().findReferencesAsNodes()) {
      if (insideTarget(reference.getSourceFile().getFilePath(), targetRoot)) reference.replaceWithText(after);
    }
  }
  specifier.setName(after);
}

function renameConsumerMeasureCalls(project, targetRoot, tsMorph) {
  for (const source of project.getSourceFiles()) {
    const path = normalized(source.getFilePath());
    if (!insideTarget(path, targetRoot) || path.includes('/dist/') || path.includes('/node_modules/')) continue;
    for (const call of source.getDescendantsOfKind(tsMorph.SyntaxKind.CallExpression)) {
      const access = call.getExpression();
      if (!tsMorph.Node.isPropertyAccessExpression(access) || access.getName() !== 'layout') continue;
      const ownerType = access.getExpression().getType();
      const owner = ownerType.getText(access.getExpression());
      const retainedTextShape =
        ownerType.getProperty('measure') !== undefined && ownerType.getProperty('layout') !== undefined;
      if (!retainedTextShape && !/(?:^|[.<])(?:Paragraph|RetainedText|Text)(?:<|$|\b)/u.test(owner)) continue;
      access.getNameNode().replaceWithText('measure');
    }
  }
}

function insideTarget(filePath, targetRoot) {
  const path = normalized(filePath);
  const root = normalized(targetRoot).replace(/\/$/u, '');
  return path === root || path.startsWith(`${root}/`);
}

function renameMethod(project, renameSymbol, suffix, owner, before, after) {
  const source = project.getSourceFile((value) => normalized(value.getFilePath()).endsWith(suffix));
  const method = source?.getClass(owner)?.getMethod(before);
  if (method !== undefined) renameSymbol(method, after);
}

function renameInterfaceMethod(project, renameSymbol, suffix, owner, before, after) {
  const source = project.getSourceFile((value) => normalized(value.getFilePath()).endsWith(suffix));
  const method = source?.getInterface(owner)?.getMethod(before);
  if (method !== undefined) renameSymbol(method, after);
}

function namedDeclaration(source, kind, name) {
  if (kind === 'interface') return source?.getInterface(name);
  if (kind === 'type') return source?.getTypeAlias(name);
  if (kind === 'function') return source?.getFunction(name);
  throw new TypeError(`unsupported declaration kind ${kind}`);
}

function normalized(value) {
  return value.replaceAll('\\', '/');
}
