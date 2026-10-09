import path from 'node:path';
export const metadata = Object.freeze({
  id: '2026-10-09-browser-module-filenames',
  additionalGlobs: ['tests/**/*.mjs', 'scripts/**/*.mjs'],
});
export function transform({ project, targetRoot, tsMorph }) {
  const source = project.getSourceFile(path.join(targetRoot, 'src/internal/fingerprint.ts'));
  if (source !== undefined) source.move(path.join(targetRoot, 'src/internal/content-digest.ts'));
  for (const file of project.getSourceFiles()) {
    for (const declaration of file.getImportDeclarations()) {
      const specifier = declaration.getModuleSpecifierValue();
      if (specifier.endsWith('/content-digest')) declaration.setModuleSpecifier(`${specifier}.js`);
      if (specifier.endsWith('/dist/internal/fingerprint.js')) {
        declaration.setModuleSpecifier(specifier.slice(0, -'fingerprint.js'.length) + 'content-digest.js');
      }
    }
    for (const call of file.getDescendantsOfKind(tsMorph.SyntaxKind.CallExpression)) {
      if (call.getExpression().getKind() !== tsMorph.SyntaxKind.ImportKeyword) continue;
      const argument = call.getArguments()[0];
      if (!tsMorph.Node.isStringLiteral(argument)) continue;
      const specifier = argument.getLiteralText();
      if (specifier.endsWith('/dist/internal/fingerprint.js')) {
        argument.setLiteralValue(specifier.slice(0, -'fingerprint.js'.length) + 'content-digest.js');
      }
    }
  }
}
