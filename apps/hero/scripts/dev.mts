/* @workflow {
  "name": "hero:dev",
  "summary": "Open the Glyph Hero showcase development server.",
  "requirements": "Workspace dependencies, built Glyph Wasm artifacts, and baked hero font assets.",
  "writes": "Vite cache"
} */
import { createServer } from 'vite';

const server = await createServer({ root: new URL('..', import.meta.url).pathname });
await server.listen();
server.printUrls();
