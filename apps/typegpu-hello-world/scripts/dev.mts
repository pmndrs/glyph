/* @workflow {
  "name": "typegpu:dev",
  "summary": "Open the TypeGPU hello-world development server.",
  "requirements": "Workspace dependencies and built Glyph Wasm artifacts.",
  "writes": "Vite cache"
} */
import { createServer } from 'vite';
const server = await createServer();
await server.listen();
server.printUrls();
