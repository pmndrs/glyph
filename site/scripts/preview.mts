import { createReadStream, promises as fs } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The whole built site: the landing page at `/`, the docs at `/docs/`, the examples app at `/examples/`.
const root = resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const port = Number(process.env.PORT ?? 4173);
const types: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

const server = createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
  const relative = normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, '');
  const requested = join(root, relative);
  const candidates = [requested, join(requested, 'index.html'), requested + '.html'];

  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate);
      if (!stat.isFile()) continue;
      response.statusCode = 200;
      response.setHeader('content-type', types[extname(candidate)] ?? 'application/octet-stream');
      createReadStream(candidate).pipe(response);
      return;
    } catch {
      // Try the next static-export candidate.
    }
  }

  response.statusCode = 404;
  response.end('Not found');
});

server.listen(port, '127.0.0.1', () => {
  console.log('Preview: http://127.0.0.1:' + port);
});
