import path from 'node:path';
export const metadata = Object.freeze({
  id: '2026-10-09-browser-module-filenames',
  additionalGlobs: ['tests/**/*.mjs'],
});
export function transform({ project, targetRoot }) {
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
  }
}
