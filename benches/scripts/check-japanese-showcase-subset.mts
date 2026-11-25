import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { fingerprint } from '@pmndrs/glyph';

import { ADVANCED_SHAPING_CASES } from '../src/workloads/advanced-shaping/scene.ts';

// The showcase subset is frozen: HarfBuzz 13.0.0 `hb-subset` produced it, and the repository no longer carries a
// subsetter that can reproduce it (skera has no CFF subsetter, so the baker carries a CFF face's whole outline table).
// This check authenticates the committed bytes against their manifest, their source font and the corpus they were cut
// for.
const frozenTool = { tool: 'hb-subset', toolVersion: '13.0.0' } as const;
const sourceDirectory = resolve('fixtures/fonts/noto-sans-cjk-2.004');
const outputDirectory = resolve('fixtures/fonts/noto-sans-cjk-showcase-v0');

const caseDefinition = ADVANCED_SHAPING_CASES.find(({ id }) => id === 'cjk-line-breaks');
if (caseDefinition === undefined) throw new Error('CJK advanced-shaping case is missing');
const corpus = [...caseDefinition.revealUnits, ...caseDefinition.showcaseRevealUnits].join('');

const [manifestText, sourceBytes, sourceLicense] = await Promise.all([
  readFile(resolve(outputDirectory, 'manifest.json'), 'utf8'),
  readFile(resolve(sourceDirectory, 'NotoSansCJKjp-Regular.otf')),
  readFile(resolve(sourceDirectory, 'LICENSE.txt')),
]);
const { source, subset } = JSON.parse(manifestText) as ShowcaseManifest;
const [fontBytes, licenseBytes] = await Promise.all([
  readFile(resolve(outputDirectory, source.fontFile)),
  readFile(resolve(outputDirectory, source.licenseFile)),
]);

expect(subset.tool, frozenTool.tool, 'subset tool');
expect(subset.toolVersion, frozenTool.toolVersion, 'subset tool version');
expect(subset.fontFile, source.fontFile, 'subset font file');
expect(
  sha256(Buffer.from(corpus)),
  subset.corpusSha256,
  'showcase corpus SHA-256',
  'the subset is frozen and cannot be regenerated in-repo, so a corpus change needs a new subset',
);
for (const [label, record] of [
  ['source', source],
  ['subset', subset],
] as const) {
  expect(fontBytes.byteLength, record.fontBytes, `${label} font bytes`);
  expect(sha256(fontBytes), record.fontSha256, `${label} font SHA-256`);
}
expect(fingerprint.source(fontBytes), source.fontFingerprint, 'subset font fingerprint');
expect(sha256(licenseBytes), source.licenseSha256, 'subset license SHA-256');
if (!licenseBytes.equals(sourceLicense)) throw new Error('showcase subset license differs from its source license');
expect(sourceBytes.byteLength, source.derivedFrom.fontBytes, 'source font bytes');
expect(sha256(sourceBytes), source.derivedFrom.fontSha256, 'source font SHA-256');

interface FontRecord {
  readonly fontFile: string;
  readonly fontBytes: number;
  readonly fontSha256: string;
}

interface ShowcaseManifest {
  readonly source: FontRecord & {
    readonly fontFingerprint: string;
    readonly licenseFile: string;
    readonly licenseSha256: string;
    readonly derivedFrom: FontRecord;
  };
  readonly subset: FontRecord & { readonly tool: string; readonly toolVersion: string; readonly corpusSha256: string };
}

function expect(actual: unknown, expected: unknown, label: string, hint?: string): void {
  if (actual === expected) return;
  const suffix = hint === undefined ? '' : `; ${hint}`;
  throw new Error(`${label}: expected ${String(expected)}, received ${String(actual)}${suffix}`);
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
/* @workflow { "name": "fixture:japanese-showcase:check", "summary": "Authenticate the frozen Japanese showcase subset against its manifest, source font, and corpus.", "requirements": "Built @pmndrs/glyph and the authenticated source CJK font.", "writes": "Nothing." } */
