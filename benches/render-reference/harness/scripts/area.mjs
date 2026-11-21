// Counts non-background pixels of one contender's scene: node scripts/area.mjs lib scene scale
import { launch, open, startServer } from './lib.mjs';
const [lib, scene, scale] = process.argv.slice(2);
const server = await startServer();
const browser = await launch();
try {
  const session = await open(browser, lib, scene, { shot: '1', scale });
  await session.page.evaluate(() => window.bench.settle());
  const png = await session.page.screenshot({ clip: { x: 800, y: 0, width: 800, height: 600 } });
  const lit = await session.page.evaluate(
    async (source) => {
      const image = new Image();
      image.src = source;
      await image.decode();
      const canvas = new OffscreenCanvas(image.width, image.height);
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      const data = context.getImageData(0, 0, image.width, image.height).data;
      let count = 0;
      for (let i = 0; i < data.length; i += 4)
        if (data[i] !== 16 || data[i + 1] !== 20 || data[i + 2] !== 24) count += 1;
      return count;
    },
    `data:image/png;base64,${png.toString('base64')}`,
  );
  console.log(`${lib} ${scene} x${scale}: ${lit}`);
} finally {
  await browser.close();
  server.stop();
}
