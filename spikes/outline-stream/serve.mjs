#!/usr/bin/env node
// Static server for the outline-stream GPU spike. Serves spikes/outline-stream/ only; no dependencies.
// Usage: node spikes/outline-stream/serve.mjs   (PORT=5178 by default)
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)));
const port = Number(process.env.PORT ?? 5178);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.wgsl': 'text/plain; charset=utf-8',
  '.hlsl': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.bin': 'application/octet-stream',
  '.glb': 'model/gltf-binary',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff2': 'font/woff2',
};

const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    let file = normalize(join(root, pathname));
    if (file !== root && !file.startsWith(root + sep)) {
      response.writeHead(403).end('forbidden');
      return;
    }
    let info = await stat(file).catch(() => null);
    if (info?.isDirectory()) {
      if (!pathname.endsWith('/')) {
        response.writeHead(301, { location: `${pathname}/` }).end();
        return;
      }
      file = join(file, 'index.html');
      info = await stat(file).catch(() => null);
    }
    if (!info?.isFile()) {
      response.writeHead(404, { 'content-type': 'text/plain' }).end(`not found: ${pathname}`);
      return;
    }
    response.writeHead(200, {
      'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'content-length': info.size,
      'cache-control': 'no-store',
    });
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    createReadStream(file).pipe(response);
  } catch (error) {
    response.writeHead(500, { 'content-type': 'text/plain' }).end(String(error));
  }
});

server.listen(port, () => {
  console.log(`outline-stream spike: http://localhost:${port}/gpu/`);
  console.log(`serving ${root}`);
});
