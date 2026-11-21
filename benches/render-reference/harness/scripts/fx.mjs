// Effect-scene screenshots for two contenders plus a pixel diff: node scripts/fx.mjs <before> <after> [tag]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { launch, open, startServer } from './lib.mjs';
const [before = 'branch', after = 'render', tag = 'fx'] = process.argv.slice(2);
const server = await startServer();
const browser = await launch();
mkdirSync('screenshots/fx', { recursive: true });
const variants = [
  { name: 'x4', extra: { scale: '4' } },
  { name: 'x1', extra: { scale: '1' } },
  { name: 'x16', extra: { scale: '16' } },
  { name: 'persp-x4', extra: { scale: '4', persp: '1' } },
  { name: 'persp-x2', extra: { scale: '2', persp: '1' } },
  ...['plain', 'outline', 'shadow'].flatMap((only) => [
    { name: `${only}-x4`, extra: { scale: '4', only } },
    { name: `${only}-x1`, extra: { scale: '1', only } },
    { name: `${only}-persp-x4`, extra: { scale: '4', persp: '1', only } },
  ]),
];
const scenes = (process.env.SCENES ?? 'fx,para,labels,kern,arabic').split(',');
try {
  const page = await (await browser.newContext()).newPage();
  for (const scene of scenes) {
    for (const variant of process.env.CUSTOM
      ? [variants[0], variants[2]]
      : scene === 'fx'
        ? variants.filter((v) => process.env.VARIANTS === undefined || process.env.VARIANTS.split(',').includes(v.name))
        : [variants[0]]) {
      const files = [];
      for (const lib of [before, after]) {
        const file = `screenshots/fx/${tag}-${scene}-${variant.name}-${lib}.png`;
        const session = await open(browser, lib, scene, {
          shot: '1',
          ...variant.extra,
          ...(process.env.WEBGL ? { webgl: '1' } : {}),
          ...(process.env.TECH ? { tech: process.env.TECH } : {}),
          ...(process.env.CUSTOM ? { custom: '1' } : {}),
        });
        await session.page.evaluate(() => window.bench.settle());
        await session.page.screenshot({ path: file, clip: { x: 800, y: 0, width: 800, height: 600 } });
        const errors = session.errors.filter((e) => !e.includes('404'));
        if (errors.length > 0) console.log(file, errors.slice(0, 3));
        await session.close();
        files.push(file);
      }
      const [a, b] = files.map((file) => `data:image/png;base64,${readFileSync(file).toString('base64')}`);
      const result = await page.evaluate(
        async ([left, right]) => {
          const pixels = async (source) => {
            const image = new Image();
            image.src = source;
            await image.decode();
            const canvas = new OffscreenCanvas(image.width, image.height);
            const context = canvas.getContext('2d');
            context.drawImage(image, 0, 0);
            return context.getImageData(0, 0, image.width, image.height);
          };
          const [x, y] = [await pixels(left), await pixels(right)];
          let differing = 0,
            over8 = 0,
            maximum = 0,
            lit = 0;
          const samples = [];
          let clipped = 0;
          const out = new ImageData(x.width, x.height);
          for (let i = 0; i < x.data.length; i += 4) {
            const d = Math.max(
              Math.abs(x.data[i] - y.data[i]),
              Math.abs(x.data[i + 1] - y.data[i + 1]),
              Math.abs(x.data[i + 2] - y.data[i + 2]),
            );
            if (x.data[i] !== 16 || x.data[i + 1] !== 20 || x.data[i + 2] !== 24) lit += 1;
            if (d > 0) differing += 1;
            if (d > 8) over8 += 1;
            if (d >= 2 && y.data[i] === 16 && y.data[i + 1] === 20 && y.data[i + 2] === 24) clipped += 1;
            if (d >= 3 && samples.length < 14)
              samples.push([(i / 4) % x.width, Math.floor(i / 4 / x.width), x.data[i], y.data[i]]);
            maximum = Math.max(maximum, d);
            out.data[i] = out.data[i + 1] = out.data[i + 2] = Math.min(255, d * 16);
            out.data[i + 3] = 255;
          }
          const canvas = new OffscreenCanvas(x.width, x.height);
          canvas.getContext('2d').putImageData(out, 0, 0);
          const blob = await canvas.convertToBlob({ type: 'image/png' });
          const bytes = new Uint8Array(await blob.arrayBuffer());
          let binary = '';
          for (const byte of bytes) binary += String.fromCharCode(byte);
          return { samples, clipped, differing, over8, maximum, lit, total: x.width * x.height, diff: btoa(binary) };
        },
        [a, b],
      );
      writeFileSync(`screenshots/fx/${tag}-${scene}-${variant.name}-diff.png`, Buffer.from(result.diff, 'base64'));
      console.log(
        `${scene} ${variant.name}: lit ${result.lit} differing ${result.differing} over8 ${result.over8} clipped ${result.clipped} max ${result.maximum}${process.env.SAMPLES ? ' ' + JSON.stringify(result.samples) : ''}`,
      );
    }
  }
} finally {
  await browser.close();
  server.stop();
}
