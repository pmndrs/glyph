// GPU memory and draw count: node scripts/mem.mjs lib[,lib] scene [query]   e.g. mem.mjs branch,render para tech=slug
import { launch, open, startServer } from './lib.mjs';
const [libs = 'render', scene = 'para', query = ''] = process.argv.slice(2);
const server = await startServer();
const browser = await launch();
try {
  for (const lib of libs.split(',')) {
    const session = await open(browser, lib, scene, { instr: '1', ...Object.fromEntries(new URLSearchParams(query)) });
    await session.page.evaluate(() => window.bench.settle());
    const draws = await session.page.evaluate(() => window.bench.draws());
    const memory = await session.page.evaluate(() => window.bench.memory());
    const log = await session.page.evaluate(() => window.bench.memoryLog());
    const textures = log
      .filter((entry) => entry.kind === 'textures')
      .map((entry) => `${entry.detail.trim()}=${entry.bytes}`);
    console.log(
      `${lib} ${scene} ${query}: draws ${draws.apiDraws} resident ${memory.residentMiB.toFixed(3)} MiB peak ${memory.peakMiB.toFixed(3)} | ${textures.join(' ; ')}`,
    );
    await session.close();
  }
} finally {
  await browser.close();
  server.stop();
}
