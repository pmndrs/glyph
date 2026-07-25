import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { FontLoader, FontRegistry } from "@pmndrs/text";

const manifestUrl = new URL("../../package.json", import.meta.url);

test("the published contract is ESM-only", async () => {
  const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));

  assert.equal(manifest.type, "module");
  assert.equal(manifest.main, undefined);
  assert.equal(manifest.module, undefined);
  assert.deepEqual(manifest.bin, { "pmndrs-text-bake": "./dist/node/cli.js" });
  assert.deepEqual(manifest.pmndrs, { text: { bitmap: "./bakers/bitmap" } });

  for (const [subpath, target] of Object.entries(manifest.exports)) {
    if (typeof target === "string") {
      assert.ok(
        [
          "./package.json",
          "./bitmap-baker.wasm",
          "./bitmap-abi.json",
          "./text-shaper.wasm",
          "./shaper-abi.json",
        ].includes(subpath),
        `unexpected non-JavaScript resource export ${subpath}`,
      );
      assert.match(target, /^\.\/dist\/.*\.(?:json|wasm)$|^\.\/package\.json$/);
      continue;
    }

    assert.deepEqual(Object.keys(target).sort(), ["import", "types"]);
    assert.match(target.import, /^\.\/dist\/.*\.js$/);
    assert.match(target.types, /^\.\/dist\/.*\.d\.ts$/);
    assert.equal("require" in target, false);
  }
});

test("the public loader graph exposes registration without eager baker or Node host edges", async () => {
  assert.equal(typeof FontLoader, "function");
  assert.equal(typeof FontRegistry, "function");
  const [entry, loader, runtimeHost, runtimeWorker] = await Promise.all([
    readFile(new URL("../../dist/index.js", import.meta.url), "utf8"),
    readFile(new URL("../../dist/loader.js", import.meta.url), "utf8"),
    readFile(new URL("../../dist/runtime-bake.js", import.meta.url), "utf8"),
    readFile(new URL("../../dist/runtime-bake-worker.js", import.meta.url), "utf8"),
  ]);
  const initialGraph = `${entry}\n${loader}`;
  assert.match(loader, /import\("\.\/runtime-bake\.js"\)/);
  assert.doesNotMatch(
    initialGraph,
    /(?:from\s+["']\.\/runtime-bake|new Worker|font_baker\.wasm|node:)/,
  );
  assert.doesNotMatch(initialGraph, /(?:\.\/node\/|\.\/bakers\/)/);
  assert.match(runtimeHost, /new Worker\(new URL\("\.\/runtime-bake-worker\.js"/);
  assert.match(runtimeWorker, /new URL\("\.\/font_baker\.wasm"/);
});
