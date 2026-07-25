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
import { validateFontArtifact } from "../../dist/validator.js";

const fixtureDirectory = new URL(
  "../../../../apps/benchmarks/fixtures/fonts/inter-v4.1/",
  import.meta.url,
);
const shapingDirectory = new URL(
  "../../../../apps/benchmarks/fixtures/shaping/inter-regular/",
  import.meta.url,
);
const executeFile = promisify(execFile);

async function shapeReducedFont(t, shapingSfnt, fontFile, shapingDirectory) {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "pmndrs-text-reduced-sfnt-"));
  t.after(() => rm(temporaryDirectory, { recursive: true, force: true }));
  const reducedFont = join(temporaryDirectory, fontFile);
  const reducedOracle = join(temporaryDirectory, "harfrust.json");
  await writeFile(reducedFont, shapingSfnt);
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
    reducedOracle,
  ]);
  return JSON.parse(await readFile(reducedOracle, "utf8"));
}

test("the canonical Inter fixture bakes deterministically and retains HarfRust shaping", async (t) => {
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

  const inspected = await validateFontArtifact(artifact.bytes);
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
  assert.equal(inspected.khronos.validatorVersion, manifest.versions.gltfValidator);

  assert.deepEqual(
    await shapeReducedFont(t, inspected.shapingSfnt, "Inter-Regular.shaping.ttf", shapingDirectory),
    JSON.parse(expectedOracleSource),
  );
});

test("the canonical Amiri fixture preserves exact complex shaping through the GLB", async (t) => {
  const directory = new URL(
    "../../../../apps/benchmarks/fixtures/fonts/amiri-1.002/",
    import.meta.url,
  );
  const casesDirectory = new URL(
    "../../../../apps/benchmarks/fixtures/shaping/amiri-regular/",
    import.meta.url,
  );
  const [wasm, source, manifestSource, expectedOracleSource] = await Promise.all([
    readFile(new URL("../../dist/font_baker.wasm", import.meta.url)),
    readFile(new URL("Amiri-Regular.ttf", directory)),
    readFile(new URL("manifest.json", directory), "utf8"),
    readFile(new URL("harfrust.json", casesDirectory), "utf8"),
  ]);
  const manifest = JSON.parse(manifestSource);
  assert.equal(source.byteLength, manifest.source.fontBytes);
  assert.equal(createHash("sha256").update(source).digest("hex"), manifest.source.fontSha256);

  const baker = await createFontBaker(wasm);
  const first = baker.bake({
    source,
    descriptor: { formatVersion: 0, fontFaceIndex: 0 },
  });
  const second = baker.bake({
    source,
    descriptor: { formatVersion: 0, fontFaceIndex: 0 },
  });
  const artifact = first.artifacts[0];
  const expected = manifest.bake.expectedCore;
  assert.equal(artifact.bytes.byteLength, expected.artifactBytes);
  assert.equal(artifact.sha256, expected.artifactSha256);
  assert.deepEqual(artifact.bytes, second.artifacts[0].bytes);
  assert.deepEqual(first.report.shared.shaping.tables, expected.tables);

  const inspected = await validateFontArtifact(artifact.bytes);
  const extension = inspected.document.extensions.PMNDRS_font;
  assert.equal(inspected.shapingSfnt.byteLength, expected.shapingSfntBytes);
  assert.equal(extension.shaping.hash, expected.shapingHash);
  assert.deepEqual(extension.metrics, {
    ascender: expected.ascender,
    descender: expected.descender,
    glyphCount: expected.glyphCount,
    glyphIdWidth: 16,
    lineGap: expected.lineGap,
    unitsPerEm: expected.unitsPerEm,
  });
  assert.equal(extension.provenance.sourceHash, manifest.source.fontSha256);

  assert.deepEqual(
    await shapeReducedFont(t, inspected.shapingSfnt, "Amiri-Regular.shaping.ttf", casesDirectory),
    JSON.parse(expectedOracleSource),
    "the reduced SFNT extracted from the validated GLB must shape exactly like the source font",
  );
});

test("the authenticated Noto CJK fixture retains the closed shaping profile at the u16 limit", async (t) => {
  const directory = new URL(
    "../../../../apps/benchmarks/fixtures/fonts/noto-sans-cjk-2.004/",
    import.meta.url,
  );
  const casesDirectory = new URL(
    "../../../../apps/benchmarks/fixtures/shaping/noto-sans-cjk/",
    import.meta.url,
  );
  const [wasm, source, manifestSource, expectedOracleSource] = await Promise.all([
    readFile(new URL("../../dist/font_baker.wasm", import.meta.url)),
    readFile(new URL("NotoSansCJKjp-Regular.otf", directory)),
    readFile(new URL("manifest.json", directory), "utf8"),
    readFile(new URL("harfrust.json", casesDirectory), "utf8"),
  ]);
  const manifest = JSON.parse(manifestSource);
  const expected = manifest.bake.expectedCore;
  assert.equal(source.byteLength, manifest.source.fontBytes);
  assert.equal(createHash("sha256").update(source).digest("hex"), manifest.source.fontSha256);
  assert.equal(manifest.face.glyphCount, 0xffff);
  assert.equal(manifest.face.glyphIdWidth, 16);

  const baker = await createFontBaker(wasm);
  const request = {
    source,
    descriptor: { formatVersion: manifest.bake.formatVersion, fontFaceIndex: 0 },
  };
  const first = baker.bake(request);
  const second = baker.bake(request);
  assert.equal(first.artifacts.length, 1);
  assert.deepEqual(first, second, "identical authenticated input must produce an identical bake");
  assert.deepEqual(first.warnings, []);
  const artifact = first.artifacts[0];
  assert.equal(artifact.role, "font");
  assert.equal(artifact.id, `font-${expected.shapingHash}`);
  assert.equal(artifact.bytes.byteLength, expected.artifactBytes);
  assert.equal(artifact.sha256, expected.artifactSha256);
  assert.equal(createHash("sha256").update(artifact.bytes).digest("hex"), expected.artifactSha256);

  assert.equal(first.report.source.bytes, manifest.source.fontBytes);
  assert.deepEqual(first.report.rasters, []);
  assert.deepEqual(first.report.shared.shaping.tables, expected.tables);
  assert.deepEqual(
    first.report.shared.shaping.tables.map(({ tag }) => tag),
    [
      "BASE",
      "GDEF",
      "GPOS",
      "GSUB",
      "OS/2",
      "VORG",
      "cmap",
      "head",
      "hhea",
      "hmtx",
      "maxp",
      "vhea",
      "vmtx",
    ],
    "the reduced SFNT table allowlist must remain closed",
  );
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
    { artifactId: artifact.id, format: "raw", bytes: expected.artifactBytes },
  ]);

  const inspected = await validateFontArtifact(artifact.bytes);
  const extension = inspected.document.extensions.PMNDRS_font;
  assert.equal(inspected.shapingSfnt.byteLength, expected.shapingSfntBytes);
  assert.equal(
    createHash("sha256").update(inspected.shapingSfnt).digest("hex"),
    expected.shapingSfntSha256,
  );
  assert.equal(inspected.glyphExtents.byteLength, expected.extentsBytes);
  assert.equal(inspected.glyphExtentsAvailability.byteLength, expected.extentsAvailabilityBytes);
  assert.equal(extension.shaping.hash, expected.shapingHash);
  assert.deepEqual(extension.metrics, {
    ascender: expected.ascender,
    descender: expected.descender,
    glyphCount: 0xffff,
    glyphIdWidth: 16,
    lineGap: expected.lineGap,
    unitsPerEm: expected.unitsPerEm,
  });
  assert.equal(extension.provenance.sourceHash, manifest.source.fontSha256);
  assert.equal(extension.provenance.descriptorHash, manifest.bake.descriptorHash);
  assert.equal(inspected.khronos.validatorVersion, manifest.versions.gltfValidator);

  assert.deepEqual(
    await shapeReducedFont(
      t,
      inspected.shapingSfnt,
      "NotoSansCJKjp-Regular.shaping.otf",
      casesDirectory,
    ),
    JSON.parse(expectedOracleSource),
    "the validated GLB's reduced SFNT must preserve every pinned HarfRust CJK glyph field",
  );
});
