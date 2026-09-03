import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The built site over HTTP, for a script that needs a browser to open it.
 *
 * `vite preview` would serve one app; this serves `dist` as it is deployed, so `/examples/` and
 * `/docs/` resolve against each other the way they will in production. It prints its origin on
 * stdout once it is listening, which is how the caller knows to start.
 */
const DIST = resolve(fileURLToPath(new URL('../dist', import.meta.url)));
const TYPES: Record<string, string> = {
  '.css': 'text/css',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

const port = Number(process.argv[2] ?? 5399);
const server = createServer((request, response) => {
  const path = new URL(request.url ?? '/', 'http://localhost').pathname;
  // `normalize` collapses any `..` before the join, so a request cannot climb out of dist.
  const asked = join(DIST, normalize(path));
  const candidates = asked.endsWith('/') ? [join(asked, 'index.html')] : [asked, join(asked, 'index.html')];
  void (async () => {
    for (const file of candidates) {
      if (!file.startsWith(DIST)) break;
      try {
        const found = await stat(file);
        if (!found.isFile()) continue;
        response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
        createReadStream(file).pipe(response);
        return;
      } catch {
        continue;
      }
    }
    response.writeHead(404).end('not found');
  })();
});
server.listen(port, '127.0.0.1', () => console.log(`http://127.0.0.1:${port}`));
