// Atlas growth proof: 30 never-drawn-letter edits, then compare final frames of two contenders.
import { readFileSync } from 'node:fs';
import { launch, open, startServer } from './lib.mjs';
const [before = 'branch', after = 'render'] = process.argv.slice(2);
const server = await startServer();
const browser = await launch();
try {
  const shots = [];
  let memory;
  for (const lib of [before, after]) {
    const session = await open(browser, lib, 'para', {
      shot: '1',
      instr: '1',
      ...(process.env.WEBGL ? { webgl: '1' } : {}),
    });
    for (let index = 0; index < 30; index += 1) await session.page.evaluate((i) => window.bench.editNew(i), index);
    // Capacity growth: lengthen the paragraph across several buffer reallocations, then shrink it again.
    for (const extra of process.env.CAPACITY ? [200, 900, 1700, 2600, 3300, 40] : [])
      await session.page.evaluate((n) => window.bench.grow(n), extra);
    await session.page.evaluate(() => window.bench.settle());
    const file = `screenshots/fx/grow-${lib}.png`;
    await session.page.screenshot({ path: file, clip: { x: 800, y: 0, width: 800, height: 600 } });
    if (lib === after) memory = await session.page.evaluate(() => window.bench.memory());
    const errors = session.errors.filter((e) => !e.includes('404'));
    if (errors.length > 0) console.log(lib, errors.slice(0, 2));
    await session.close();
    shots.push(readFileSync(file));
  }
  const page = await (await browser.newContext()).newPage();
  const result = await page.evaluate(
    async (sources) => {
      const load = async (source) => {
        const image = new Image();
        image.src = source;
        await image.decode();
        const canvas = new OffscreenCanvas(image.width, image.height);
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, image.width, image.height).data;
      };
      const [x, y] = [await load(sources[0]), await load(sources[1])];
      let differing = 0,
        maximum = 0;
      for (let i = 0; i < x.length; i += 4) {
        const d = Math.max(Math.abs(x[i] - y[i]), Math.abs(x[i + 1] - y[i + 1]), Math.abs(x[i + 2] - y[i + 2]));
        if (d > 0) differing += 1;
        maximum = Math.max(maximum, d);
      }
      return { differing, maximum };
    },
    shots.map((png) => `data:image/png;base64,${png.toString('base64')}`),
  );
  console.log(
    `after 30 new-letter edits: differing ${result.differing} max ${result.maximum}; resident ${memory.residentMiB.toFixed(3)} MiB peak ${memory.peakMiB.toFixed(3)} MiB`,
  );
} finally {
  await browser.close();
  server.stop();
}
