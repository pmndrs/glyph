import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const staticImportPattern = /\b(?:import|export)(?!\s*\()\s*(?:[^'"`]*?\bfrom\s*)?(["'])([^"']+)\1/g;
const dynamicImportPattern = /\bimport\(\s*(["'`])([^"'`]+)\1\s*\)/g;

export async function readJavaScriptModuleClosure(entries) {
  const pending = [...entries];
  const modules = new Map();
  const staticImports = new Set();
  const dynamicImports = new Set();

  while (pending.length > 0) {
    const entry = pending.pop();
    const path = resolve(entry instanceof URL ? fileURLToPath(entry) : entry);
    if (modules.has(path)) continue;

    const source = await readFile(path, 'utf8');
    modules.set(path, source);

    for (const match of source.matchAll(dynamicImportPattern)) {
      dynamicImports.add(match[2]);
    }
    for (const match of source.matchAll(staticImportPattern)) {
      const specifier = match[2];
      staticImports.add(specifier);
      if (specifier.startsWith('.') && specifier.endsWith('.js')) {
        pending.push(resolve(dirname(path), specifier));
      }
    }
  }

  return {
    source: [...modules.values()].join('\n'),
    paths: [...modules.keys()],
    staticImports,
    dynamicImports,
  };
}
