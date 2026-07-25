import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createFontBaker } from "../../dist/index.js";
import { inspectFontGlb } from "../support/font-glb.mjs";

const fixtureDirectory = new URL(
  "../../../../apps/benchmarks/fixtures/fonts/inter-v4.1/",
  import.meta.url,
);
const shapingDirectory = new URL(
  "../../../../apps/benchmarks/fixtures/shaping/inter-regular/",
  import.meta.url,
);
const executeFile = promisify(execFile);

test("the canonical Inter fixture bakes deterministically and retains HarfRust shaping", async (t) => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "pmndrs-text-reduced-sfnt-"));
  t.after(() => rm(temporaryDirectory, { recursive: true, force: true }));
  const [wasm, source, manifestSource, expectedOracleSource] = await Promise.all([
    readFile(new URL("../../dist/font_baker.wasm", import.meta.url)),
    readFile(new URL("Inter-Regular.ttf", fixtureDirectory)),
    readFile(new URL("manifest.json", fixtureDirectory), "utf8"),
    readFile(new URL("harfrust.json", shapingDirectory), "utf8"),
  ]);
  const manifest = JSON.parse(manifestSource);
  const sourceHash = createHash("sha256").update(source).digest("hex");

  assert.equal(source.byteLength, manifest.source.fontBytes);
  assert.equal(sourceHash, manifest.source.fontSha256);

  const baker = await createFontBaker(wasm);
  const request = {
    source,
    descriptor: { formatVersion: 0, fontFaceIndex: 0 },
  };
  const first = baker.bake(request);
  const second = baker.bake(request);
  const artifact = first.artifacts[0];
  const expected = manifest.bake.expectedCore;

  assert.equal(first.artifacts.length, 1);
  assert.equal(artifact.role, "font");
  assert.equal(artifact.id, `font-${expected.shapingHash}`);
  assert.equal(artifact.bytes.byteLength, expected.artifactBytes);
  assert.equal(artifact.sha256, expected.artifactSha256);
  assert.equal(artifact.sha256, second.artifacts[0].sha256);
  assert.deepEqual(artifact.bytes, second.artifacts[0].bytes);
  assert.deepEqual(first.report, second.report);
  assert.deepEqual(first.warnings, []);
  assert.equal(first.report.source.bytes, source.byteLength);
  assert.deepEqual(first.report.rasters, []);
  assert.deepEqual(first.report.shared.shaping.tables, expected.tables);
  assert.equal(first.report.shared.shaping.extentsBytes, expected.extentsBytes);
  assert.equal(
    first.report.shared.shaping.extentsAvailabilityBytes,
    expected.extentsAvailabilityBytes,
  );
  assert.equal(
    first.report.shared.shaping.totalRawBytes,
    expected.shapingSfntBytes + expected.extentsBytes + expected.extentsAvailabilityBytes,
  );
  assert.deepEqual(first.report.transport, [
    { artifactId: artifact.id, format: "raw", bytes: artifact.bytes.byteLength },
  ]);

  const inspected = inspectFontGlb(artifact.bytes);
  const extension = inspected.document.extensions.PMNDRS_font;
  assert.equal(inspected.shapingSfnt.byteLength, expected.shapingSfntBytes);
  assert.equal(extension.shaping.hash, expected.shapingHash);
  assert.equal(extension.metrics.glyphCount, expected.glyphCount);
  assert.equal(extension.metrics.unitsPerEm, expected.unitsPerEm);
  assert.equal(extension.metrics.ascender, expected.ascender);
  assert.equal(extension.metrics.descender, expected.descender);
  assert.equal(extension.metrics.lineGap, expected.lineGap);
  assert.equal(extension.provenance.sourceHash, manifest.source.fontSha256);
  assert.equal(extension.provenance.descriptorHash, manifest.bake.descriptorHash);

  const reducedFont = join(temporaryDirectory, "Inter-Regular.shaping.ttf");
  const actualOracle = join(temporaryDirectory, "harfrust.json");
  await writeFile(reducedFont, inspected.shapingSfnt);
  await executeFile("cargo", [
    "run",
    "--manifest-path",
    fileURLToPath(new URL("../../rust/Cargo.toml", import.meta.url)),
    "--bin",
    "generate-shaping-oracle",
    "--features",
    "oracle",
    "--locked",
    "--quiet",
    "--",
    reducedFont,
    fileURLToPath(new URL("cases.json", shapingDirectory)),
    "--output",
    actualOracle,
  ]);
  assert.deepEqual(
    JSON.parse(await readFile(actualOracle, "utf8")),
    JSON.parse(expectedOracleSource),
  );
});
