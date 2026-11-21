// Dumps the WGSL of every shader module a contender creates: node scripts/wgsl.mjs <lib> <scene> <outdir>
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { launch, startServer, url } from './lib.mjs';
const [lib = 'render', scene = 'para', out = 'results/wgsl'] = process.argv.slice(2);
const server = await startServer();
const browser = await launch();
try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 600 } });
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.wgslModules = [];
    const original = GPUDevice.prototype.createShaderModule;
    GPUDevice.prototype.createShaderModule = function (descriptor) {
      window.wgslModules.push({ label: descriptor.label ?? '', code: descriptor.code });
      return original.call(this, descriptor);
    };
  });
  await page.goto(url(lib, scene, Object.fromEntries(new URLSearchParams(process.env.EXTRA ?? ''))));
  const first = await page.evaluate(() => window.benchReady);
  if (first.error) throw new Error(first.error);
  const modules = await page.evaluate(() => window.wgslModules);
  mkdirSync(resolve(out), { recursive: true });
  modules.forEach((module, index) => writeFileSync(resolve(out, `${lib}-${scene}-${index}.wgsl`), module.code));
  console.log(modules.map((m, i) => `${i}: ${m.label} ${m.code.length}`).join('\n'));
} finally {
  await browser.close();
  server.stop();
}
