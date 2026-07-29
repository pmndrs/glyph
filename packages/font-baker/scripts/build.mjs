import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { captureCommand } from "./capture-command.mjs";
import { reproducibleRustEnvironment } from "./reproducible-rust-env.mjs";
import { writeGeneratedTypescriptAbi } from "./generated-typescript-abi.mjs";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
const tsc = fileURLToPath(
  new URL(
    process.platform === "win32" ? "../node_modules/.bin/tsc.CMD" : "../node_modules/.bin/tsc",
    import.meta.url,
  ),
);
const rustEnvironment = reproducibleRustEnvironment(workspaceRoot);
const wasmOpt = fileURLToPath(
  new URL(
    process.platform === "win32"
      ? "../node_modules/.bin/wasm-opt.CMD"
      : "../node_modules/.bin/wasm-opt",
    import.meta.url,
  ),
);
const rustWasm = fileURLToPath(
  new URL(
    "../rust/target/wasm32-unknown-unknown/release/pmndrs_text_font_baker.wasm",
    import.meta.url,
  ),
);
const distributedWasm = fileURLToPath(new URL("../dist/font_baker.wasm", import.meta.url));

const abiJson = await runCapture("cargo", [
  "run",
  "--manifest-path",
  "rust/Cargo.toml",
  "--bin",
  "generate-abi",
  "--locked",
  "--quiet",
]);
await writeGeneratedTypescriptAbi(
  new URL("../src/generated/font-baker-abi.ts", import.meta.url),
  "fontBakerAbi",
  abiJson,
  { check: process.env.CI === "true" },
);
await run(
  "cargo",
  [
    "build",
    "--manifest-path",
    "rust/Cargo.toml",
    "--target",
    "wasm32-unknown-unknown",
    "--release",
    "--locked",
    "--no-default-features",
  ],
  rustEnvironment,
);
await run(tsc, ["-p", "tsconfig.build.json"]);
await mkdir(new URL("../dist/", import.meta.url), { recursive: true });
await copyFile(
  new URL("../src/schemas/KHRONOS-SPEC-LICENSE.txt", import.meta.url),
  new URL("../dist/schemas/KHRONOS-SPEC-LICENSE.txt", import.meta.url),
);
await copyFile(
  new URL("../src/schemas/README.md", import.meta.url),
  new URL("../dist/schemas/README.md", import.meta.url),
);
await run(wasmOpt, [
  "--enable-bulk-memory",
  "--enable-nontrapping-float-to-int",
  "-Oz",
  rustWasm,
  "-o",
  distributedWasm,
]);
await writeFile(
  new URL("../dist/font-baker-abi-v0.json", import.meta.url),
  abiJson,
);

function run(command, args, environment = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: packageRoot, env: environment, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code ?? signal}`));
    });
  });
}

function runCapture(command, args) {
  return captureCommand(command, args, { cwd: packageRoot });
}
