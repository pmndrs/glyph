import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "vite";

interface MeasuredEntry {
  readonly id: string;
  readonly label: string;
  readonly status: "measured";
  readonly format: "javascript" | "wasm";
  readonly rawBytes: number;
  readonly minifiedBytes: number;
  readonly gzipBytes: number;
  readonly brotliBytes: number;
}

interface UnavailableEntry {
  readonly id: string;
  readonly label: string;
  readonly status: "unavailable";
  readonly reason: string;
}

type SizeEntry = MeasuredEntry | UnavailableEntry;

const root = fileURLToPath(new URL("..", import.meta.url));

async function bundle(
  entry: string,
  minify: false | "oxc",
  includeDynamic: boolean,
  externalizeWasmAsset: boolean,
): Promise<Uint8Array> {
  const result = await build({
    configFile: false,
    logLevel: "silent",
    plugins: externalizeWasmAsset
      ? [
          {
            name: "externalize-package-wasm-for-size-measurement",
            transform(code, id) {
              if (!id.endsWith("/runtime-bake-worker.js")) return;
              const expression = 'new URL("./font_baker.wasm", import.meta.url)';
              if (!code.includes(expression)) {
                throw new Error("Runtime Worker no longer contains the measured Wasm URL boundary");
              }
              return code.replace(
                expression,
                'new URL("font_baker.wasm", "https://size.invalid/")',
              );
            },
          },
        ]
      : [],
    root,
    build: {
      lib: {
        entry,
        formats: ["es"],
        fileName: "entry",
      },
      minify,
      target: "es2022",
      write: false,
      rollupOptions: { preserveEntrySignatures: "strict" },
    },
  });
  const builds = Array.isArray(result) ? result : [result];
  const chunks = builds.flatMap((output) => {
    if (!("output" in output))
      throw new Error("Package-size build unexpectedly entered watch mode");
    return output.output.filter((artifact) => artifact.type === "chunk");
  });
  const included = new Set<string>();
  const byFileName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
  const visit = (fileName: string): void => {
    if (included.has(fileName)) return;
    const chunk = byFileName.get(fileName);
    if (chunk === undefined) throw new Error(`Package-size build omitted static chunk ${fileName}`);
    included.add(fileName);
    for (const imported of chunk.imports) visit(imported);
  };
  if (includeDynamic) {
    for (const chunk of chunks) included.add(chunk.fileName);
  } else {
    for (const chunk of chunks) if (chunk.isEntry) visit(chunk.fileName);
  }
  const code = chunks.filter(({ fileName }) => included.has(fileName)).map(({ code }) => code);
  if (code.length === 0) throw new Error(`Package-size entry emitted no JavaScript: ${entry}`);
  return new TextEncoder().encode(code.join("\n"));
}

function compression(bytes: Uint8Array): Pick<MeasuredEntry, "gzipBytes" | "brotliBytes"> {
  return {
    gzipBytes: gzipSync(bytes, { level: 9 }).byteLength,
    brotliBytes: brotliCompressSync(bytes, {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: 11,
      },
    }).byteLength,
  };
}

async function measureJavaScript(
  id: string,
  label: string,
  entry: URL,
  includeDynamic = true,
  externalizeWasmAsset = false,
): Promise<MeasuredEntry> {
  const [raw, minified] = await Promise.all([
    bundle(fileURLToPath(entry), false, includeDynamic, externalizeWasmAsset),
    bundle(fileURLToPath(entry), "oxc", includeDynamic, externalizeWasmAsset),
  ]);
  return {
    id,
    label,
    status: "measured",
    format: "javascript",
    rawBytes: raw.byteLength,
    minifiedBytes: minified.byteLength,
    ...compression(minified),
  };
}

async function measureWasm(): Promise<MeasuredEntry> {
  const bytes = await readFile(
    new URL("../../../packages/font-baker/dist/font_baker.wasm", import.meta.url),
  );
  return {
    id: "portable-baker-wasm",
    label: "Portable baker Wasm",
    status: "measured",
    format: "wasm",
    rawBytes: bytes.byteLength,
    minifiedBytes: bytes.byteLength,
    ...compression(bytes),
  };
}

const entries: SizeEntry[] = [
  await measureJavaScript(
    "browser-core",
    "Browser core",
    new URL("../size-entries/text-core.ts", import.meta.url),
    false,
  ),
  await measureJavaScript(
    "font-validator-js",
    "Lazy font validator JS",
    new URL("../size-entries/font-validator.ts", import.meta.url),
  ),
  await measureJavaScript(
    "runtime-baker-host-js",
    "Runtime baker host JS",
    new URL("../size-entries/runtime-bake.ts", import.meta.url),
  ),
  await measureJavaScript(
    "runtime-baker-worker-js",
    "Runtime baker Worker JS",
    new URL("../../../packages/text/dist/runtime-bake-worker.js", import.meta.url),
    true,
    true,
  ),
  await measureJavaScript(
    "portable-baker-js",
    "Portable baker JS",
    new URL("../size-entries/font-baker.ts", import.meta.url),
  ),
  await measureWasm(),
  {
    id: "unicode-properties",
    label: "Unicode property tables",
    status: "unavailable",
    reason: "Version-pinned JavaScript tables land with the paragraph engine in milestone 5.",
  },
];

const report = {
  schemaVersion: 0,
  entries,
};
const output = new URL("../src/generated/package-sizes.json", import.meta.url);
await mkdir(new URL("../src/generated/", import.meta.url), { recursive: true });
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
