#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export function diagnosticRustcArguments(arguments_) {
  const crate = arguments_.indexOf('--crate-name');
  // Preserve Cargo's release profile and crate metadata. Only retain names in the final shaper link.
  return crate >= 0 && arguments_[crate + 1] === 'pmndrs_glyph_shaper'
    ? [...arguments_, '-C', 'strip=none']
    : arguments_;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [rustc, ...arguments_] = process.argv.slice(2);
  const result = spawnSync(rustc, diagnosticRustcArguments(arguments_), { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.signal) process.kill(process.pid, result.signal);
  else process.exitCode = result.status ?? 1;
}
