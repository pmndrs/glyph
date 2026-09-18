/* @workflow {
  "name": "hero:star-font",
  "summary": "Vendor the pinned OFL Noto Sans Symbols 2 source used by the finale's Unicode stars; --check verifies it.",
  "requirements": "Network access to the pinned Google Fonts repository revision.",
  "writes": "apps/hero/fonts/star-symbols/{NotoSansSymbols2-Regular.ttf,OFL.txt} unless --check"
} */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const REVISION = '8b0a1d0f5983c89bc2b93f1b5fb55f9e252744b5';
const base = `https://raw.githubusercontent.com/google/fonts/${REVISION}/ofl/notosanssymbols2/`;
const destination = new URL('../fonts/star-symbols/', import.meta.url);
const check = process.argv.includes('--check');

if (!check) await mkdir(destination, { recursive: true });

for (const name of ['NotoSansSymbols2-Regular.ttf', 'OFL.txt']) {
  const response = await fetch(new URL(name, base));

  if (!response.ok) throw new Error(`Unable to fetch ${name}: ${response.status}`);

  const bytes = Buffer.from(await response.arrayBuffer());
  const file = new URL(name, destination);

  if (check) {
    if (!bytes.equals(await readFile(file))) throw new Error(`${name} differs from pinned upstream`);
  } else await writeFile(file, bytes);

  console.log(`${name}: sha256:${createHash('sha256').update(bytes).digest('hex')}`);
}
