import { sizeLimitRows } from './package-size-summary.ts';

let input = '';
for await (const chunk of process.stdin) input += String(chunk);
process.stdout.write(JSON.stringify(sizeLimitRows(JSON.parse(input) as unknown)));
