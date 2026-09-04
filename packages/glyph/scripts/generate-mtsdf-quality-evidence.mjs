/* @workflow { "name": "glyph:mtsdf-quality:generate", "summary": "Regenerate reconstructed-coverage quality evidence for the production MTSDF kernel.", "requirements": "Stable Rust and the authenticated font fixtures.", "writes": "Checked-in MTSDF reconstruction quality evidence.", "args": [] } */
/* @workflow { "name": "glyph:mtsdf-quality:check", "summary": "Verify reconstructed MTSDF coverage against checked-in ground-truth quality evidence.", "requirements": "Stable Rust and the authenticated font fixtures.", "writes": "Nothing.", "args": ["--check"] } */

// The native msdfgen oracle answers "does the kernel agree with msdfgen". It cannot answer "is the
// glyph the shader reconstructs actually the glyph": a faithfully reproduced artifact is still an
// artifact, and the oracle corpus is framed with a distance range five times wider relative to its
// texels than production, so error correction barely engages there. This workflow closes that gap
// by reconstructing coverage exactly as `tsl/msdf-shader.ts` does and comparing it against an
// independent scanline rasterization of the same outline.

import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDirectory = fileURLToPath(new URL('..', import.meta.url));
const workspaceDirectory = resolve(packageDirectory, '../..');
const manifestPath = resolve(packageDirectory, 'rust/mtsdf-admission/evidence/reconstruction-quality-v0.json');
const cargoManifest = resolve(packageDirectory, 'rust/mtsdf-admission/Cargo.toml');
const checkOnly = process.argv.includes('--check');

const EM_SIZE = 64;
const PIXEL_RANGE = 8;
const ZOOM = 8;

/** Covers right-angle, diagonal, and pinch-point failure modes; `o` is the no-correction control. */
const CORPUS = [
  { font: 'inter-v4.1/Inter-Regular.ttf', characters: 'IHnoMA48&' },
  { font: 'source-serif-4.005/SourceSerif4-Regular.ttf', characters: 'AMweg8' },
  { font: 'dancing-script-3.000/DancingScript-Regular.otf', characters: 'AMweg8' },
  {
    font: 'font-awesome-free-6.7.2/fa-solid-900.ttf',
    // Private Use Area icons: home, user, star, bolt, book.
    characters: [0xf015, 0xf007, 0xf005, 0xf0e7, 0xf02d].map((point) => String.fromCodePoint(point)).join(''),
  },
];

/** Per-glyph ceiling on samples whose reconstructed coverage misses the reference by over a quarter. */
const SAMPLES_OVER_QUARTER_TOLERANCE = 1.35;

const measured = measureCorpus();
const evidence = {
  schemaVersion: 0,
  kind: 'mtsdf-reconstruction-quality',
  reference: {
    method: 'independent scanline rasterization of the same outline',
    exactInX: true,
    subsamplesPerRow: 16,
    chordsPerCurve: 64,
  },
  framing: { emSize: EM_SIZE, pixelRange: PIXEL_RANGE, zoom: ZOOM },
  tolerance: { samplesOverQuarterRatio: SAMPLES_OVER_QUARTER_TOLERANCE },
  cases: measured,
};
const serialized = `${JSON.stringify(evidence, null, 2)}\n`;

if (checkOnly) {
  const expected = JSON.parse(await readFile(manifestPath, 'utf8'));
  const baseline = new Map(expected.cases.map((entry) => [`${entry.font}:${entry.character}`, entry]));
  const regressions = [];
  for (const entry of measured) {
    const previous = baseline.get(`${entry.font}:${entry.character}`);
    if (!previous) {
      regressions.push(`${entry.font} ${entry.character} is not in the checked-in evidence`);
      continue;
    }
    // An absolute floor keeps a glyph that is already near zero from failing on a single sample.
    const ceiling = Math.max(4, Math.ceil(previous.samplesOverQuarter * SAMPLES_OVER_QUARTER_TOLERANCE));
    if (entry.samplesOverQuarter > ceiling) {
      regressions.push(
        `${entry.font} ${entry.character}: ${entry.samplesOverQuarter} samples over a quarter, ceiling ${ceiling}`,
      );
    }
  }
  if (regressions.length > 0) {
    throw new Error(`MTSDF reconstruction quality regressed:\n  ${regressions.join('\n  ')}`);
  }
} else {
  await writeFile(manifestPath, serialized);
}

process.stdout.write(
  `${measured
    .map(
      (entry) =>
        `${entry.font} ${entry.character}: mean ${entry.meanAbsoluteError.toFixed(5)}, max ${entry.maximumAbsoluteError.toFixed(3)}, over-quarter ${entry.samplesOverQuarter}`,
    )
    .join('\n')}\n`,
);

function measureCorpus() {
  const cases = [];
  for (const { font, characters } of CORPUS) {
    const output = execFileSync(
      'cargo',
      [
        'run',
        '--release',
        '--manifest-path',
        cargoManifest,
        '--bin',
        'measure-mtsdf-quality',
        '--features',
        'full-font-evidence',
        '--locked',
        '--quiet',
        '--',
        resolve(workspaceDirectory, 'apps/benchmarks/fixtures/fonts', font),
        '--em-size',
        String(EM_SIZE),
        '--pixel-range',
        String(PIXEL_RANGE),
        '--zoom',
        String(ZOOM),
        '--chars',
        characters,
      ],
      { cwd: workspaceDirectory, encoding: 'utf8', maxBuffer: 8_000_000 },
    );
    const [, ...rows] = output.trim().split('\n');
    for (const row of rows) {
      const [character, glyph, width, height, mean, maximum, worstX, worstY, overQuarter, overHalf] = row.split('\t');
      cases.push({
        font,
        character,
        glyph: Number(glyph),
        width: Number(width),
        height: Number(height),
        meanAbsoluteError: Number(mean),
        maximumAbsoluteError: Number(maximum),
        worstX: Number(worstX),
        worstY: Number(worstY),
        samplesOverQuarter: Number(overQuarter),
        samplesOverHalf: Number(overHalf),
      });
    }
  }
  return cases;
}
