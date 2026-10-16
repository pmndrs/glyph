/* @workflow {
  "name": "glyph:shaper-size-accounting",
  "summary": "Account for frozen text-shaper Wasm size, optionally with authenticated named function bodies.",
  "requirements": "--artifact <release.tgz>; optional --named <authenticated.wasm>, --baseline <main.tgz>, and --output <ignored-directory>. Without --named, reports whole-file, section, and function-count measurements only. Uses Node and tar; does not build Wasm.",
  "writes": "Ignored packages/glyph/.cache/shaper-size-accounting (or --output): report.json and report.md. Never writes dist."
} */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { captureCommand } from './support/capture-command.mjs';
import { assertDiagnosticOutputOutsideDist } from './support/shaper-build.mjs';
import { accountShaper, baselineShaper, byteIdentity } from './support/shaper-size-accounting.mjs';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const options = new Map();
const arguments_ = process.argv.slice(2);
for (let index = 0; index < arguments_.length; index += 2) {
  const key = arguments_[index];
  const value = arguments_[index + 1];
  if (!['--artifact', '--named', '--baseline', '--output'].includes(key) || value === undefined || options.has(key)) {
    throw new Error('Expected --artifact <tgz> [--named <wasm>] [--baseline <tgz>] [--output <directory>]');
  }
  options.set(key, value);
}
if (!options.has('--artifact')) throw new Error('--artifact is required');
const output = resolve(options.get('--output') ?? resolve(packageRoot, '.cache/shaper-size-accounting'));
assertDiagnosticOutputOutsideDist(resolve(packageRoot, 'dist'), output);
const archive = await readFile(resolve(options.get('--artifact')));
const release = await extractShaper(archive);
const named = options.has('--named') ? await readFile(resolve(options.get('--named'))) : null;
const analysis = named === null ? baselineShaper(release) : accountShaper(release, named);
const releaseIdentity =
  named === null
    ? { sha256: analysis.sha256, rawBytes: analysis.rawBytes, gzipBytes: analysis.gzipBytes }
    : analysis.release;
const baselineArchive = options.has('--baseline') ? await readFile(resolve(options.get('--baseline'))) : null;
const baseline = baselineArchive === null ? null : baselineShaper(await extractShaper(baselineArchive));
const report = {
  format: 'glyph-shaper-size-accounting-v1',
  mode: named === null ? 'summary' : 'named',
  inputs: {
    archive: { path: resolve(options.get('--artifact')), ...byteIdentity(archive) },
    named: named === null ? null : { path: resolve(options.get('--named')), ...analysis.named },
    baselineArchive:
      baselineArchive === null ? null : { path: resolve(options.get('--baseline')), ...byteIdentity(baselineArchive) },
  },
  release: releaseIdentity,
  executableSha256: named === null ? null : analysis.executableSha256,
  importedFunctionCount: analysis.importedFunctionCount,
  definedFunctionCount: analysis.definedFunctionCount,
  sectionHeaderBytes: named === null ? 8 : analysis.sectionHeaderBytes,
  sections: analysis.sections,
  codeSection: named === null ? null : analysis.codeSection,
  symbolClasses: named === null ? null : analysis.symbolClasses,
  nonexclusiveOwnerHints: named === null ? null : analysis.nonexclusiveOwnerHints,
  genericNameHints: named === null ? null : analysis.genericNameHints,
  functions: named === null ? null : analysis.functions,
  exactDuplicateCandidates: named === null ? null : analysis.exactDuplicateCandidates,
  baseline,
  baselineDelta:
    baseline === null
      ? null
      : {
          rawBytes: releaseIdentity.rawBytes - baseline.rawBytes,
          gzipBytes: releaseIdentity.gzipBytes - baseline.gzipBytes,
          importedFunctionCount: analysis.importedFunctionCount - baseline.importedFunctionCount,
          definedFunctionCount: analysis.definedFunctionCount - baseline.definedFunctionCount,
          sections: analysis.sections.map((section) => ({
            ordinal: section.ordinal,
            id: section.id,
            name: section.name,
            rawBytes: section.rawBytes,
            baselineSameOrdinalBytes: baseline.sections[section.ordinal]?.rawBytes ?? null,
            sameOrdinalDeltaBytes:
              baseline.sections[section.ordinal]?.id === section.id &&
              baseline.sections[section.ordinal]?.name === section.name
                ? section.rawBytes - baseline.sections[section.ordinal].rawBytes
                : null,
          })),
        },
  limits:
    named === null
      ? [
          'Raw section bytes and whole-file gzip are measured; gzip applies only to whole files.',
          'Body, owner, duplicate, and generic-name attribution is unavailable without an authenticated named artifact; null does not mean zero.',
          'Section deltas compare the same ordinal only when section ID and name match.',
        ]
      : [
          'Function bodies and section bytes are exact raw-byte accounting; gzip applies only to whole files.',
          'Names provide nonexclusive source hints, not exact ownership or dependency causality after inlining and linker merging.',
          'Owner-hint body-byte totals overlap when one mangled name contains multiple crate markers; they are not a partition.',
          'Rust generic-name patterns hint at instantiation; they do not prove generic expansion overhead.',
          'Exact duplicate candidates have equal declared type indexes and identical encoded bodies; deletion safety is unproven.',
          'An unnamed baseline supports whole-file and function-count deltas only, not owner/category deltas.',
        ],
};
await mkdir(output, { recursive: true });
await writeFile(resolve(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
await writeFile(resolve(output, 'report.md'), markdown(report));
process.stdout.write(`Shaper size accounting: ${output}\n`);

async function extractShaper(bytes) {
  return captureCommand('tar', ['-xOf', '-', 'package/dist/text-shaper.wasm'], { input: bytes });
}

function markdown(accounting) {
  if (accounting.mode === 'summary') {
    return [
      '# Text shaper Wasm size accounting',
      '',
      'Mode: summary (unnamed release artifact).',
      `Release: ${accounting.release.rawBytes} raw bytes, ${accounting.release.gzipBytes} gzip bytes, SHA-256 \`${accounting.release.sha256}\`.`,
      `Defined functions: ${accounting.definedFunctionCount}; imported functions: ${accounting.importedFunctionCount}.`,
      ...(accounting.baselineDelta === null
        ? []
        : [
            `Baseline delta: ${signed(accounting.baselineDelta.rawBytes)} raw bytes; ${signed(accounting.baselineDelta.gzipBytes)} whole-file gzip bytes; ${signed(accounting.baselineDelta.definedFunctionCount)} defined functions; ${signed(accounting.baselineDelta.importedFunctionCount)} imported functions.`,
          ]),
      '',
      '## Raw sections',
      '',
      '| Ordinal | ID | Name | Raw bytes | Baseline bytes | Same-ordinal delta |',
      '| ---: | ---: | --- | ---: | ---: | ---: |',
      ...accounting.sections.map((section) => {
        const delta = accounting.baselineDelta?.sections[section.ordinal];
        return `| ${section.ordinal} | ${section.id} | ${section.name ?? ''} | ${section.rawBytes} | ${delta?.baselineSameOrdinalBytes ?? '—'} | ${delta?.sameOrdinalDeltaBytes === null || delta === undefined ? '—' : signed(delta.sameOrdinalDeltaBytes)} |`;
      }),
      '',
      `Eight-byte header plus sections: ${accounting.sectionHeaderBytes + accounting.sections.reduce((sum, section) => sum + section.rawBytes, 0)} bytes.`,
      '',
      'Named function bodies, owner hints, generic-name hints, and duplicate candidates: unavailable without an authenticated named artifact.',
      '',
      '## Interpretation limits',
      '',
      ...accounting.limits.map((limit) => `- ${limit}`),
      '',
    ].join('\n');
  }
  const ranked = [...accounting.functions].sort((left, right) => right.rawBodyBytes - left.rawBodyBytes).slice(0, 20);
  const candidate = [...accounting.functions]
    .filter((fn) => fn.ownerHints.includes('pmndrs_glyph_shaper'))
    .sort((left, right) => right.rawBodyBytes - left.rawBodyBytes)
    .slice(0, 10);
  const row = (fn) =>
    `| ${fn.functionIndex} | ${fn.rawBodyBytes} | ${fn.declaredTypeIndex} | ${fn.ownerHints.join(', ') || 'unknown'} | \`${(fn.name ?? 'unnamed').slice(0, 100)}\` |`;
  return [
    '# Text shaper Wasm size accounting',
    '',
    'Mode: named (authenticated executable match).',
    `Release: ${accounting.release.rawBytes} raw bytes, ${accounting.release.gzipBytes} gzip bytes, SHA-256 \`${accounting.release.sha256}\`.`,
    `Defined functions: ${accounting.definedFunctionCount}; imported functions: ${accounting.importedFunctionCount}.`,
    `Named bodies: ${accounting.symbolClasses.named.rawBodyBytes} bytes; Binaryen generated/shared bodies: ${accounting.symbolClasses['binaryen-generated-or-shared'].rawBodyBytes} bytes; unnamed bodies: ${accounting.symbolClasses.unnamed.rawBodyBytes} bytes.`,
    `Generic-name hints: ${accounting.genericNameHints.functionCount} functions, ${accounting.genericNameHints.rawBodyBytes} raw body bytes.`,
    ...(accounting.baselineDelta === null
      ? []
      : [
          `Baseline delta: ${accounting.baselineDelta.rawBytes >= 0 ? '+' : ''}${accounting.baselineDelta.rawBytes} raw bytes; ${accounting.baselineDelta.gzipBytes >= 0 ? '+' : ''}${accounting.baselineDelta.gzipBytes} whole-file gzip bytes; ${accounting.baselineDelta.definedFunctionCount >= 0 ? '+' : ''}${accounting.baselineDelta.definedFunctionCount} defined functions.`,
        ]),
    '',
    '## Raw sections',
    '',
    '| Ordinal | ID | Name | Raw bytes |',
    '| ---: | ---: | --- | ---: |',
    ...accounting.sections.map(
      (section) => `| ${section.ordinal} | ${section.id} | ${section.name ?? ''} | ${section.rawBytes} |`,
    ),
    '',
    `Eight-byte header plus sections: ${accounting.sectionHeaderBytes + accounting.sections.reduce((sum, section) => sum + section.rawBytes, 0)} bytes.`,
    ...(accounting.codeSection === null
      ? []
      : [
          `Code section: ${accounting.codeSection.bodyBytes} body bytes + ${accounting.codeSection.bodyLengthPrefixBytes} body-length prefix bytes + ${accounting.codeSection.countPrefixBytes} count-prefix bytes + ${accounting.codeSection.sectionFramingBytes} section-framing bytes = ${accounting.codeSection.rawBytes} bytes.`,
        ]),
    '',
    '## Largest defined bodies',
    '',
    '| Index | Body bytes | Type index | Symbol hints | Raw name |',
    '| ---: | ---: | ---: | --- | --- |',
    ...ranked.map(row),
    '',
    '## Nonexclusive crate markers in raw names',
    '',
    '| Marker | Functions | Raw body bytes |',
    '| --- | ---: | ---: |',
    ...Object.entries(accounting.nonexclusiveOwnerHints).map(
      ([hint, value]) => `| ${hint} | ${value.functionCount} | ${value.rawBodyBytes} |`,
    ),
    '',
    '## Largest bodies with own-crate symbol hints',
    '',
    '| Index | Body bytes | Type index | Symbol hints | Raw name |',
    '| ---: | ---: | ---: | --- | --- |',
    ...candidate.map(row),
    '',
    `Exact duplicate candidate groups: ${accounting.exactDuplicateCandidates.length}. Full function rows and groups are in report.json.`,
    '',
    '## Interpretation limits',
    '',
    ...accounting.limits.map((limit) => `- ${limit}`),
    '',
  ].join('\n');
}

function signed(value) {
  return `${value >= 0 ? '+' : ''}${value}`;
}
