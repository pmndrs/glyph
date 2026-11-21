// Prints console warnings and errors for one page: node scripts/errs.mjs lib scene query
import { launch, open, startServer } from './lib.mjs';
const [lib, scene, query = ''] = process.argv.slice(2);
const server = await startServer();
const browser = await launch();
try {
  const session = await open(browser, lib, scene, { shot: '1', ...Object.fromEntries(new URLSearchParams(query)) });
  await session.page.evaluate(() => window.bench.settle());
  console.log(session.errors.map((e) => e.slice(0, 1500)).join('\n---\n') || 'no errors');
  await session.close();
} finally {
  await browser.close();
  server.stop();
}
