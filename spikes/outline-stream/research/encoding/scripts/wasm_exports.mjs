import { readFileSync } from 'node:fs';
const m = new WebAssembly.Module(readFileSync(process.argv[2]));
console.log(
  WebAssembly.Module.exports(m)
    .map((e) => e.name + ':' + e.kind)
    .join('\n'),
);
console.log('IMPORTS', JSON.stringify(WebAssembly.Module.imports(m)));
