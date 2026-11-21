// Capacity growth probe: grows the paragraph in steps and reports, per step, the time and the WebGPU objects created.
// node scripts/capacity.mjs lib[,lib]
import { launch, open, startServer } from './lib.mjs';
const libs = (process.argv[2] ?? 'render').split(',');
const server = await startServer();
const browser = await launch();
const count = (api, name) => api[name]?.calls ?? 0;
try {
  for (const lib of libs) {
    const session = await open(browser, lib, 'para', { instr: '1' });
    for (const warm of [0, 4, 0, 4]) await session.page.evaluate((n) => window.bench.grow(n), warm);
    const rows = [];
    let previous = await session.page.evaluate(() => window.bench.api());
    for (let extra = 8; extra <= 3400; extra += 106) {
      const sample = await session.page.evaluate((n) => window.bench.grow(n), extra);
      const api = await session.page.evaluate(() => window.bench.api());
      rows.push({
        extra,
        ms: sample.ms,
        cpu: sample.mutateMs + sample.renderCpuMs,
        modules: count(api, 'createShaderModule') - count(previous, 'createShaderModule'),
        pipelines:
          count(api, 'createRenderPipeline') +
          count(api, 'createRenderPipelineAsync') -
          count(previous, 'createRenderPipeline') -
          count(previous, 'createRenderPipelineAsync'),
        buffers: count(api, 'createBuffer') - count(previous, 'createBuffer'),
      });
      previous = api;
    }
    const growth = rows.filter((row) => row.buffers > 0);
    const steady = rows.filter((row) => row.buffers === 0);
    const median = (values) => [...values].sort((a, b) => a - b)[values.length >> 1] ?? NaN;
    console.log(`${lib}: ${rows.length} edits, ${growth.length} with new buffers`);
    console.log(
      `  growth edits: cpu ${growth.map((r) => r.cpu.toFixed(2)).join(' ')} ms | modules ${growth.map((r) => r.modules).join(' ')} | pipelines ${growth.map((r) => r.pipelines).join(' ')} | buffers ${growth.map((r) => r.buffers).join(' ')}`,
    );
    console.log(
      `  same-capacity edits: cpu median ${median(steady.map((r) => r.cpu)).toFixed(2)} ms, modules ${steady.reduce((s, r) => s + r.modules, 0)}, pipelines ${steady.reduce((s, r) => s + r.pipelines, 0)}`,
    );
    const errors = session.errors.filter((e) => !e.includes('404'));
    if (errors.length > 0)
      console.log(
        '  errors',
        errors.slice(0, 2).map((e) => e.slice(0, 300)),
      );
    await session.close();
  }
} finally {
  await browser.close();
  server.stop();
}
