/* @workflow {
  "name": "cameo:dev",
  "summary": "Open the Glyph Cameo development server.",
  "requirements": "Workspace dependencies, built Glyph Wasm artifacts, and baked cameo font assets.",
  "writes": "Vite cache"
} */
import { createServer } from 'vite';

const server = await createServer({ root: new URL('..', import.meta.url).pathname });
await server.listen();
server.printUrls();
