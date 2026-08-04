import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { ADVANCED_SHAPING_CASES } from '../src/workloads/advanced-shaping/scene.ts';

const harfBuzzVersion = '13.0.0';
const sourceDirectory = resolve('fixtures/fonts/noto-sans-cjk-2.004');
const sourceFont = resolve(sourceDirectory, 'NotoSansCJKjp-Regular.otf');
const sourceLicense = resolve(sourceDirectory, 'LICENSE.txt');
const outputDirectory = resolve('fixtures/fonts/noto-sans-cjk-showcase-v0');
const outputFontName = 'NotoSansCJKjp-Showcase.otf';
const outputFont = resolve(outputDirectory, outputFontName);
const outputLicense = resolve(outputDirectory, 'LICENSE.txt');
const outputManifest = resolve(outputDirectory, 'manifest.json');
const subsetExecutable = resolve('.cache/harfbuzz', harfBuzzVersion, 'build/util/hb-subset');
const check = process.argv.includes('--check');

const caseDefinition = ADVANCED_SHAPING_CASES.find(({ id }) => id === 'cjk-line-breaks');
if (caseDefinition === undefined) throw new Error('CJK advanced-shaping case is missing');

const corpus = [...caseDefinition.revealUnits, ...caseDefinition.showcaseRevealUnits].join('');
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'pmndrs-text-cjk-showcase-'));
const generatedFont = resolve(temporaryDirectory, outputFontName);

try {
  await run(subsetExecutable, [
    sourceFont,
    `--text=${corpus}`,
    '--layout-features=*',
    '--name-IDs=*',
    `--output-file=${generatedFont}`,
  ]);

  const [sourceBytes, licenseBytes, generatedBytes] = await Promise.all([
    readFile(sourceFont),
    readFile(sourceLicense),
    readFile(generatedFont),
  ]);
  const manifest = {
    schemaVersion: 0,
    id: 'noto-sans-cjk-jp-showcase-v0',
    purpose: 'Authored Japanese shaping showcase; not a complete CJK distribution font',
    source: {
      family: 'Noto Sans CJK JP',
      style: 'Regular',
      version: '2.004',
      fontFile: outputFontName,
      fontBytes: generatedBytes.byteLength,
      fontSha256: sha256(generatedBytes),
      license: 'OFL-1.1',
      licenseFile: 'LICENSE.txt',
      licenseSha256: sha256(licenseBytes),
      derivedFrom: {
        fontFile: '../noto-sans-cjk-2.004/NotoSansCJKjp-Regular.otf',
        fontBytes: sourceBytes.byteLength,
        fontSha256: sha256(sourceBytes),
      },
    },
    subset: {
      tool: 'hb-subset',
      toolVersion: harfBuzzVersion,
      corpusSha256: sha256(Buffer.from(corpus)),
      fontFile: outputFontName,
      fontBytes: generatedBytes.byteLength,
      fontSha256: sha256(generatedBytes),
    },
    face: { fontIndex: 0, variations: {} },
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, undefined, 2)}\n`);

  if (check) {
    const [checkedFont, checkedLicense, checkedManifest] = await Promise.all([
      readFile(outputFont),
      readFile(outputLicense),
      readFile(outputManifest),
    ]);
    if (!generatedBytes.equals(checkedFont)) throw new Error(`${outputFontName} is stale`);
    if (!licenseBytes.equals(checkedLicense)) throw new Error('showcase subset license is stale');
    if (!manifestBytes.equals(checkedManifest)) throw new Error('showcase subset manifest is stale');
  } else {
    await mkdir(outputDirectory, { recursive: true });
    await Promise.all([
      writeFile(outputFont, generatedBytes),
      copyFile(sourceLicense, outputLicense),
      writeFile(outputManifest, manifestBytes),
    ]);
  }
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function run(command: string, arguments_: readonly string[]): Promise<void> {
  await new Promise<void>((resolveRun, reject) => {
    const child = spawn(command, arguments_, { stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolveRun();
      else reject(new Error(`${command} exited with ${String(code)}`));
    });
  });
}
/* @workflow
{
  "name": "fixture:japanese-showcase:generate",
  "summary": "Regenerate the authenticated Japanese showcase subset.",
  "requirements": "Provisioned HarfBuzz tools and the source CJK font.",
  "writes": "Checked-in Japanese showcase fixture."
}
*/
/* @workflow
{
  "name": "fixture:japanese-showcase:check",
  "summary": "Verify the authenticated Japanese showcase subset.",
  "requirements": "Provisioned HarfBuzz tools and the source CJK font.",
  "writes": "Nothing.",
  "args": ["--check"]
}
*/
