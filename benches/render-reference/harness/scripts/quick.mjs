// Fast steady-frame probe: node scripts/quick.mjs lib[,lib...]  -> e1 medians for para x4, labels x4, para x1, labels x1
import { launch, open, startServer, summarize } from './lib.mjs';
const libs = (process.argv[2] ?? 'render').split(',');
const cases = (process.env.CASES ?? 'para:4,labels:4,para:1,labels:1').split(',').map((c) => c.split(':'));
const server = await startServer();
const browser = await launch();
try {
  for (const [scene, scale] of cases) {
    const sessions = [];
    for (const lib of libs)
      sessions.push({
        lib,
        ...(await open(browser, lib, scene, {
          scale,
          ...(process.env.EXTRA ? Object.fromEntries(new URLSearchParams(process.env.EXTRA)) : {}),
        })),
      });
    const values = Object.fromEntries(libs.map((lib) => [lib, []]));
    for (const s of sessions) await s.page.evaluate(() => window.bench.steady(300));
    for (let round = 0; round < 6; round += 1) {
      for (const s of sessions) {
        await s.page.bringToFront();
        values[s.lib].push((await s.page.evaluate(() => window.bench.steady(300))).e1Ms);
      }
    }
    console.log(
      `${scene} x${scale}: ${libs.map((lib) => `${lib} ${summarize(values[lib]).median.toFixed(4)}`).join(' | ')}`,
    );
    await Promise.all(sessions.map((s) => s.close()));
  }
} finally {
  await browser.close();
  server.stop();
}
