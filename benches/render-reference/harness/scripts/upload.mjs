// Upload bytes and calls per known-letter edit: node scripts/upload.mjs lib[,lib]
import { launch, open, startServer } from './lib.mjs';
const libs = (process.argv[2] ?? 'render').split(',');
const server = await startServer();
const browser = await launch();
try {
  for (const lib of libs) {
    const session = await open(browser, lib, 'para', { instr: '1' });
    for (const i of [100, 101]) await session.page.evaluate((n) => window.bench.editKnown(n), i);
    const before = await session.page.evaluate(() => window.bench.api());
    const edits = 30;
    for (let i = 0; i < edits; i += 1) await session.page.evaluate((n) => window.bench.editKnown(n), i);
    const after = await session.page.evaluate(() => window.bench.api());
    const delta = (name, key) => ((after[name]?.[key] ?? 0) - (before[name]?.[key] ?? 0)) / edits;
    console.log(
      `${lib}: writeBuffer ${delta('writeBuffer', 'bytes').toFixed(0)} bytes in ${delta('writeBuffer', 'calls').toFixed(1)} calls per edit; writeTexture ${delta('writeTexture', 'bytes').toFixed(0)} bytes`,
    );
    await session.close();
  }
} finally {
  await browser.close();
  server.stop();
}
