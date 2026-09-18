/* @workflow {
  "name": "benchmark:labs-internal",
  "summary": "Run fresh-process Labs comparisons for workspace-only engine and kernel internals.",
  "requirements": "Built @pmndrs/glyph. Kernel cases additionally require glyph:kernel-lab-build artifacts. Accepts --suite, --blocks, --name, --technique, --corpus, --glyphs, and --wasm.",
  "writes": "Ignored Labs records under benches/.cache/labs-internal."
} */
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const benchesRoot = fileURLToPath(new URL('..', import.meta.url));
const labsRoot = resolve(benchesRoot, 'labs-internal');
const labsExecutable = resolve(benchesRoot, 'node_modules/.bin/labs');
const options = parseArguments(process.argv.slice(2));
const commandArguments = [`@${options.suite}`, '--name', options.name, '--force', '--blocks', String(options.blocks)];

await new Promise<void>((resolveRun, reject) => {
  const child = spawn(labsExecutable, commandArguments, {
    cwd: labsRoot,
    env: {
      ...process.env,
      GLYPH_LABS_CORPUS: options.corpus,
      GLYPH_LABS_GLYPHS: String(options.glyphs),
      GLYPH_LABS_TECHNIQUE: options.technique,
      ...(options.wasm === undefined ? {} : { GLYPH_LABS_WASM: options.wasm }),
    },
    stdio: 'inherit',
  });
  child.once('error', reject);
  child.once('close', (code) => {
    if (code === 0) resolveRun();
    else reject(new Error(`labs exited with ${String(code)}`));
  });
});

function parseArguments(argv: readonly string[]) {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (name === undefined || !name.startsWith('--') || value === undefined) {
      throw new Error('Arguments must be supplied as --name value pairs');
    }
    values.set(name.slice(2), value);
  }
  const suite = values.get('suite') ?? 'kernel';
  const blocks = Number(values.get('blocks') ?? '8');
  if (!/^[a-z][a-z0-9-]*$/u.test(suite)) throw new RangeError('--suite must be a tag name');
  if (!Number.isSafeInteger(blocks) || blocks < 2) throw new RangeError('--blocks must be an integer of at least 2');
  const technique = values.get('technique') ?? 'bitmap';
  const corpus = values.get('corpus') ?? 'latin';
  const glyphs = Number(values.get('glyphs') ?? '22000');
  if (!['bitmap', 'mtsdf', 'slug'].includes(technique)) {
    throw new RangeError('--technique must be bitmap, mtsdf, or slug');
  }
  if (!['latin', 'bidi', 'cjk'].includes(corpus)) throw new RangeError('--corpus must be latin, bidi, or cjk');
  if (!Number.isSafeInteger(glyphs) || glyphs <= 0) throw new RangeError('--glyphs must be a positive integer');
  return {
    blocks,
    corpus,
    glyphs,
    name: values.get('name') ?? `internal-${suite}-${technique}-${corpus}`,
    suite,
    technique,
    wasm: values.get('wasm'),
  };
}
