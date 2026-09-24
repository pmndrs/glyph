export const metadata = Object.freeze({ id: '2026-09-24-text-split' });

function isGlyphSource(source) {
  return /\/(?:packages\/glyph|node_modules\/@pmndrs\/glyph)\/(?:src|dist)\//.test(source.getFilePath());
}

export function transform({ project, renameSymbol, tsMorph }) {
  const protectedSources = new Map(
    project
      .getSourceFiles()
      .filter((source) => /\/(?:dist|node_modules|generated)\//.test(source.getFilePath()))
      .map((source) => [source, source.getFullText()]),
  );
  for (const source of project
    .getSourceFiles()
    .filter((source) => isGlyphSource(source) && !protectedSources.has(source))) {
    // Re-query after each language-service rename: related declarations may already have changed.
    for (;;) {
      const declaration = source
        .getDescendants()
        .find(
          (node) =>
            (tsMorph.Node.isMethodDeclaration(node) || tsMorph.Node.isMethodSignature(node)) &&
            node.getName() === 'breakApart',
        );
      if (declaration === undefined) break;
      renameSymbol(declaration, 'split');
    }
  }
  // Installed declarations stay untouched, whether they expose the old or the new name.
  for (const source of project.getSourceFiles()) {
    if (protectedSources.has(source)) continue;
    for (const access of source.getDescendantsOfKind(tsMorph.SyntaxKind.PropertyAccessExpression)) {
      if (access.getName() !== 'breakApart') continue;
      const type = access.getExpression().getType().getNonNullableType();
      const method = type.getProperty('breakApart') ?? type.getProperty('split');
      if (method?.getDeclarations().some((declaration) => isGlyphSource(declaration.getSourceFile()))) {
        access.getNameNode().replaceWithText('split');
      }
    }
  }
  for (const [source, original] of protectedSources) source.replaceWithText(original);
}
