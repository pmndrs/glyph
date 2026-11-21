// Edit and width-change medians: node scripts/edits.mjs lib[,lib] [query]
import { launch, open, startServer, summarize } from './lib.mjs';
const [libs = 'render', query = ''] = process.argv.slice(2);
const extra = Object.fromEntries(new URLSearchParams(query));
const server = await startServer();
const browser = await launch();
try {
  const sessions = [];
  for (const lib of libs.split(',')) sessions.push({ lib, ...(await open(browser, lib, 'para', extra)) });
  for (const [name, call] of [
    ['editKnown', 'editKnown'],
    ['editNew', 'editNew'],
    ['width', 'width'],
  ]) {
    const values = Object.fromEntries(sessions.map((s) => [s.lib, []]));
    for (const s of sessions)
      for (const i of [100, 101])
        await s.page.evaluate(([c, n]) => window.bench[c](n, 'set'), [call === 'editNew' ? 'editKnown' : call, i]);
    for (let index = 0; index < 30; index += 1) {
      for (const s of sessions) {
        await s.page.bringToFront();
        values[s.lib].push(await s.page.evaluate(([c, n]) => window.bench[c](n, 'set'), [call, index]));
      }
    }
    console.log(
      `${name}: ${sessions
        .map((s) => {
          const all = summarize(values[s.lib].map((v) => v.ms));
          const cpu = summarize(values[s.lib].map((v) => v.mutateMs + v.renderCpuMs));
          return `${s.lib} ${all.median.toFixed(2)} [max ${all.max.toFixed(2)}] cpu ${cpu.median.toFixed(2)}`;
        })
        .join(' | ')}`,
    );
  }
  await Promise.all(sessions.map((s) => s.close()));
} finally {
  await browser.close();
  server.stop();
}
