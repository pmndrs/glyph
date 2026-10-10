/* @workflow { "name": "benchmark:dev-built", "summary": "Serve the benchmark app using already-built runtime artifacts without rebuilding them.", "requirements": "Built Glyph distribution and authenticated benchmark fixtures. Optional PORT/HOST/PORTLESS_URL selects the local server origin.", "writes": "Vite development cache and a listening development server." } */
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const origin = process.env.PORTLESS_URL;
const port = process.env.PORT;
const server = await createServer({
  root: fileURLToPath(new URL('..', import.meta.url)),
  server: {
    host: process.env.HOST ?? '127.0.0.1',
    ...(port === undefined ? {} : { port: Number(port), strictPort: true }),
    ...(origin === undefined ? {} : { allowedHosts: [new URL(origin).hostname] }),
  },
});
await server.listen();
server.printUrls();
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => void server.close().finally(() => process.exit()));
}
