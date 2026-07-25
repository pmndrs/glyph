import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";
import draft04Schema from "ajv/lib/refs/json-schema-draft-04.json" with { type: "json" };
import { validateBytes } from "gltf-validator";

import extensionSchema from "./schemas/gltf-2.0/extension.schema.json" with { type: "json" };
import extrasSchema from "./schemas/gltf-2.0/extras.schema.json" with { type: "json" };
import gltfPropertySchema from "./schemas/gltf-2.0/glTFProperty.schema.json" with { type: "json" };
import fontExtensionSchema from "./schemas/extensions/glTF.PMNDRS_font.schema.json" with { type: "json" };

const GLB_MAGIC = 0x4654_6c67;
const JSON_CHUNK = 0x4e4f_534a;
const BIN_CHUNK = 0x004e_4942;
const GLTF_VALIDATOR_VERSION = "2.0.0-dev.3.10";
const textDecoder = new TextDecoder("utf-8", { fatal: true });
const textEncoder = new TextEncoder();

export interface FontArtifactValidationIssue {
  readonly code: string;
  readonly message: string;
  readonly path?: string;
}

export interface KhronosValidationMessage {
  readonly code: string;
  readonly message: string;
  readonly severity: number;
  readonly pointer: string;
}

export interface KhronosValidationReport {
  readonly mimeType: string;
  readonly validatorVersion: string;
  readonly issues: {
    readonly numErrors: number;
    readonly numWarnings: number;
    readonly numInfos: number;
    readonly numHints: number;
    readonly messages: readonly KhronosValidationMessage[];
    readonly truncated: boolean;
  };
  readonly info: Readonly<Record<string, unknown>>;
}

export interface ValidatedFontArtifactV0 {
  readonly document: Readonly<Record<string, unknown>>;
  readonly shapingSfnt: Uint8Array;
  readonly glyphExtents: Uint8Array;
  readonly glyphExtentsAvailability: Uint8Array;
  readonly shapingHash: string;
  readonly glyphCount: number;
  readonly khronos: KhronosValidationReport;
}

export class FontArtifactValidationError extends Error {
  readonly issues: readonly FontArtifactValidationIssue[];

  constructor(issues: readonly FontArtifactValidationIssue[]) {
    super(
      issues
        .map(
          (issue) =>
            `${issue.code}${issue.path === undefined ? "" : ` ${issue.path}`}: ${issue.message}`,
        )
        .join("\n"),
    );
    this.name = "FontArtifactValidationError";
    this.issues = issues;
  }
}

export async function validateFontArtifact(bytes: Uint8Array): Promise<ValidatedFontArtifactV0> {
  const parsed = parseGlb(bytes);
  const khronos = await validateWithKhronos(bytes, parsed.document);
  validateFontExtensionSchema(parsed.document);
  return validateFontSemantics(parsed, khronos);
}

export interface ParsedGlb {
  readonly document: Record<string, unknown>;
  readonly bin: Uint8Array;
  readonly declaredBinLength: number;
}

export function parseGlb(bytes: Uint8Array): ParsedGlb {
  if (bytes.byteLength < 28)
    fail("GLB_TOO_SHORT", "GLB must contain a header plus JSON and BIN chunks");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC)
    fail("GLB_MAGIC", "invalid GLB magic", "/header/magic");
  if (view.getUint32(4, true) !== 2)
    fail("GLB_VERSION", "only GLB version 2 is supported", "/header/version");
  if (view.getUint32(8, true) !== bytes.byteLength) {
    fail("GLB_LENGTH", "declared GLB length must consume the complete input", "/header/length");
  }

  const chunks: { readonly type: number; readonly start: number; readonly end: number }[] = [];
  let cursor = 12;
  while (cursor < bytes.byteLength) {
    if (cursor > bytes.byteLength - 8)
      fail("GLB_CHUNK_HEADER", "truncated GLB chunk header", `/chunks/${chunks.length}`);
    const byteLength = view.getUint32(cursor, true);
    const type = view.getUint32(cursor + 4, true);
    if ((byteLength & 3) !== 0)
      fail(
        "GLB_CHUNK_ALIGNMENT",
        "chunk byte length must be four-byte aligned",
        `/chunks/${chunks.length}`,
      );
    const start = cursor + 8;
    const end = start + byteLength;
    if (!Number.isSafeInteger(end) || end < start || end > bytes.byteLength) {
      fail(
        "GLB_CHUNK_RANGE",
        "chunk payload exceeds the declared GLB length",
        `/chunks/${chunks.length}`,
      );
    }
    chunks.push({ type, start, end });
    cursor = end;
  }
  if (cursor !== bytes.byteLength)
    fail("GLB_TRAILING_BYTES", "chunks must consume the complete GLB");
  if (chunks.length !== 2 || chunks[0]?.type !== JSON_CHUNK || chunks[1]?.type !== BIN_CHUNK) {
    fail(
      "GLB_CHUNK_ORDER",
      "GLB must contain exactly one JSON chunk followed by one BIN chunk",
    );
  }

  const jsonChunk = bytes.subarray(chunks[0].start, chunks[0].end);
  let jsonEnd = jsonChunk.byteLength;
  while (jsonEnd > 0 && jsonChunk[jsonEnd - 1] === 0x20) jsonEnd -= 1;
  if (jsonEnd === 0) fail("GLB_JSON_EMPTY", "JSON chunk is empty", "/json");
  for (let index = jsonEnd; index < jsonChunk.byteLength; index += 1) {
    if (jsonChunk[index] !== 0x20)
      fail("GLB_JSON_PADDING", "JSON chunk padding must use spaces", "/json");
  }
  let document: unknown;
  try {
    document = JSON.parse(textDecoder.decode(jsonChunk.subarray(0, jsonEnd)));
  } catch (error) {
    fail("GLB_JSON", error instanceof Error ? error.message : String(error), "/json");
  }
  const root = asRecord(document, "GLB JSON root", "/json");
  const buffers = asArray(root.buffers, "buffers", "/buffers");
  if (buffers.length !== 1)
    fail("BUFFER_COUNT", "GLB must contain exactly one buffer", "/buffers");
  const buffer = asRecord(buffers[0], "buffer", "/buffers/0");
  if (buffer.uri !== undefined) fail("BUFFER_URI", "GLB buffer must be embedded", "/buffers/0/uri");
  const declaredBinLength = asInteger(
    buffer.byteLength,
    "buffer byteLength",
    "/buffers/0/byteLength",
    0,
  );
  const binChunk = chunks[1];
  const bin = bytes.subarray(binChunk.start, binChunk.end);
  if (declaredBinLength > bin.byteLength || bin.byteLength - declaredBinLength > 3) {
    fail(
      "BIN_LENGTH",
      "BIN chunk must equal its declared buffer length plus at most three padding bytes",
      "/buffers/0/byteLength",
    );
  }
  if (!allZero(bin.subarray(declaredBinLength)))
    fail("BIN_PADDING", "BIN chunk padding must be zero", "/bin");
  return { document: root, bin, declaredBinLength };
}

export async function validateWithKhronos(
  bytes: Uint8Array,
  document: Readonly<Record<string, unknown>>,
): Promise<KhronosValidationReport> {
  let report: KhronosValidationReport;
  try {
    report = await validateBytes(bytes, { maxIssues: 1_000 });
  } catch (error) {
    fail("KHRONOS_VALIDATOR_FAILED", error instanceof Error ? error.message : String(error));
  }
  if (report.validatorVersion !== GLTF_VALIDATOR_VERSION) {
    fail(
      "KHRONOS_VALIDATOR_VERSION",
      `expected ${GLTF_VALIDATOR_VERSION}, received ${report.validatorVersion}`,
    );
  }
  if (report.issues.truncated)
    fail("KHRONOS_ISSUES_TRUNCATED", "validator report must not be truncated");
  if (report.issues.numErrors !== 0 || report.issues.numWarnings !== 0) {
    fail("KHRONOS_CORE_INVALID", "Khronos validator reported a core glTF error or warning");
  }
  const allowed = khronosAllowlist(document);
  const unexpected = report.issues.messages.filter(
    (message) => !allowed.has(messageIdentity(message)),
  );
  if (unexpected.length !== 0) {
    throw new FontArtifactValidationError(
      unexpected.map((message) => ({
        code: `KHRONOS_${message.code}`,
        message: message.message,
        path: message.pointer,
      })),
    );
  }
  return report;
}

function khronosAllowlist(document: Readonly<Record<string, unknown>>): ReadonlySet<string> {
  const allowed = new Set<string>();
  const extensionsUsed = asArray(document.extensionsUsed, "extensionsUsed", "/extensionsUsed");
  for (let index = 0; index < extensionsUsed.length; index += 1) {
    const extension = extensionsUsed[index];
    if (typeof extension !== "string") continue;
    allowed.add(
      messageIdentity({
        code: "UNSUPPORTED_EXTENSION",
        message: `Cannot validate an extension as it is not supported by the validator: '${extension}'.`,
        severity: 2,
        pointer: `/extensionsUsed/${index}`,
      }),
    );
  }
  const bufferViews = asArray(document.bufferViews, "bufferViews", "/bufferViews");
  for (let index = 0; index < bufferViews.length; index += 1) {
    allowed.add(
      messageIdentity({
        code: "UNUSED_OBJECT",
        message: "This object may be unused.",
        severity: 2,
        pointer: `/bufferViews/${index}`,
      }),
    );
  }
  return allowed;
}

function messageIdentity(message: KhronosValidationMessage): string {
  return `${message.code}\0${message.severity}\0${message.pointer}\0${message.message}`;
}

let fontSchemaValidator: ValidateFunction | undefined;

function validateFontExtensionSchema(document: Readonly<Record<string, unknown>>): void {
  const extension = asRecord(
    asRecord(document.extensions, "extensions", "/extensions").PMNDRS_font,
    "PMNDRS_font",
    "/extensions/PMNDRS_font",
  );
  const validate = (fontSchemaValidator ??= createFontSchemaValidator());
  if (validate(extension)) return;
  throw new FontArtifactValidationError((validate.errors ?? []).map(schemaIssue));
}

function createFontSchemaValidator(): ValidateFunction {
  const ajv = new Ajv({ allErrors: true, jsonPointers: true, schemaId: "auto" });
  ajv.addMetaSchema(draft04Schema);
  ajv.addSchema(withoutMetaSchema(extensionSchema), "extension.schema.json");
  ajv.addSchema(withoutMetaSchema(extrasSchema), "extras.schema.json");
  ajv.addSchema(withoutMetaSchema(gltfPropertySchema), "glTFProperty.schema.json");
  return ajv.compile(fontExtensionSchema);
}

function withSchemaId(
  schema: Readonly<Record<string, unknown>>,
  id: string,
): Record<string, unknown> {
  const result = withoutMetaSchema(schema);
  result.$id = id;
  return result;
}

export interface ExtensionSchemaDependency {
  readonly id: string;
  readonly schema: Readonly<Record<string, unknown>>;
}

export function evaluateExtensionSchema(
  value: unknown,
  schema: Readonly<Record<string, unknown>>,
  path: string,
  dependencies: readonly ExtensionSchemaDependency[] = [],
): readonly FontArtifactValidationIssue[] {
  const ajv = new Ajv({ allErrors: true, jsonPointers: true, schemaId: "auto" });
  ajv.addMetaSchema(draft04Schema);
  ajv.addSchema(withoutMetaSchema(extensionSchema), "extension.schema.json");
  ajv.addSchema(withoutMetaSchema(extrasSchema), "extras.schema.json");
  ajv.addSchema(withoutMetaSchema(gltfPropertySchema), "glTFProperty.schema.json");
  const schemaId = schema.$id;
  if (typeof schemaId === "string" && schemaId.includes("/")) {
    const base = schemaId.slice(0, schemaId.lastIndexOf("/") + 1);
    ajv.addSchema(withSchemaId(extensionSchema, `${base}extension.schema.json`));
    ajv.addSchema(withSchemaId(extrasSchema, `${base}extras.schema.json`));
    ajv.addSchema(withSchemaId(gltfPropertySchema, `${base}glTFProperty.schema.json`));
  }
  for (const dependency of dependencies) {
    ajv.addSchema({ ...withoutMetaSchema(dependency.schema), $id: dependency.id }, dependency.id);
  }
  const validate = ajv.compile(schema);
  if (validate(value)) return [];
  return (validate.errors ?? []).map((error) => ({
    code: `SCHEMA_${error.keyword.toUpperCase()}`,
    message: error.message ?? "extension schema validation failed",
    path: error.dataPath === "" ? path : `${path}${error.dataPath}`,
  }));
}

function withoutMetaSchema(schema: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const result = { ...schema };
  delete result.$schema;
  return result;
}

function schemaIssue(error: ErrorObject): FontArtifactValidationIssue {
  return {
    code: `SCHEMA_${error.keyword.toUpperCase()}`,
    message: error.message ?? "extension schema validation failed",
    path:
      error.dataPath === ""
        ? "/extensions/PMNDRS_font"
        : `/extensions/PMNDRS_font${error.dataPath}`,
  };
}

async function validateFontSemantics(
  parsed: ParsedGlb,
  khronos: KhronosValidationReport,
): Promise<ValidatedFontArtifactV0> {
  const { document, bin, declaredBinLength } = parsed;
  const extensionsUsed = stringArray(document.extensionsUsed, "extensionsUsed", "/extensionsUsed");
  const extensionsRequired = stringArray(
    document.extensionsRequired,
    "extensionsRequired",
    "/extensionsRequired",
  );
  if (!extensionsUsed.includes("PMNDRS_font") || !extensionsRequired.includes("PMNDRS_font")) {
    fail("FONT_EXTENSION_REQUIRED", "PMNDRS_font must be used and required");
  }
  const extensions = asRecord(document.extensions, "extensions", "/extensions");
  const font = asRecord(extensions.PMNDRS_font, "PMNDRS_font", "/extensions/PMNDRS_font");
  const shaping = asRecord(font.shaping, "shaping", "/extensions/PMNDRS_font/shaping");
  const functions = asRecord(
    shaping.fontFunctions,
    "fontFunctions",
    "/extensions/PMNDRS_font/shaping/fontFunctions",
  );
  const metrics = asRecord(font.metrics, "metrics", "/extensions/PMNDRS_font/metrics");
  const provenance = asRecord(font.provenance, "provenance", "/extensions/PMNDRS_font/provenance");
  const glyphCount = asInteger(
    metrics.glyphCount,
    "glyphCount",
    "/extensions/PMNDRS_font/metrics/glyphCount",
    1,
    65_535,
  );
  if (
    provenance.bakerVersion !== "0.0.0" ||
    provenance.harfrustVersion !== "0.12.0" ||
    provenance.harfbuzzReferenceVersion !== "13.0.0" ||
    provenance.unicodeVersion !== "17.0.0"
  ) {
    fail(
      "FONT_VERSION_INCOMPATIBLE",
      "font provenance does not match the V0 version contract",
      "/extensions/PMNDRS_font/provenance",
    );
  }

  const bufferViews = asArray(document.bufferViews, "bufferViews", "/bufferViews").map(
    (value, index) => {
      const view = asRecord(value, "bufferView", `/bufferViews/${index}`);
      if (view.buffer !== 0)
        fail(
          "BUFFER_VIEW_BUFFER",
          "buffer view must reference buffer 0",
          `/bufferViews/${index}/buffer`,
        );
      const byteOffset =
        view.byteOffset === undefined
          ? 0
          : asInteger(view.byteOffset, "byteOffset", `/bufferViews/${index}/byteOffset`, 0);
      const byteLength = asInteger(
        view.byteLength,
        "byteLength",
        `/bufferViews/${index}/byteLength`,
        0,
      );
      if ((byteOffset & 3) !== 0)
        fail(
          "BUFFER_VIEW_ALIGNMENT",
          "buffer view must be four-byte aligned",
          `/bufferViews/${index}/byteOffset`,
        );
      if (byteOffset > declaredBinLength - byteLength)
        fail(
          "BUFFER_VIEW_RANGE",
          "buffer view exceeds the declared BIN range",
          `/bufferViews/${index}`,
        );
      return { source: view, byteOffset, byteLength };
    },
  );
  const shapingIndex = asInteger(
    shaping.bufferView,
    "shaping bufferView",
    "/extensions/PMNDRS_font/shaping/bufferView",
    0,
    bufferViews.length - 1,
  );
  const extentsIndex = asInteger(
    functions.glyphExtentsBufferView,
    "glyph extents bufferView",
    "/extensions/PMNDRS_font/shaping/fontFunctions/glyphExtentsBufferView",
    0,
    bufferViews.length - 1,
  );
  const availabilityIndex = asInteger(
    functions.glyphExtentsAvailabilityBufferView,
    "glyph extents availability bufferView",
    "/extensions/PMNDRS_font/shaping/fontFunctions/glyphExtentsAvailabilityBufferView",
    0,
    bufferViews.length - 1,
  );
  if (new Set([shapingIndex, extentsIndex, availabilityIndex]).size !== 3) {
    fail(
      "FONT_BUFFER_VIEW_ALIAS",
      "shaping, extents, and availability must use distinct buffer views",
    );
  }
  const rasters = asArray(font.rasters, "rasters", "/extensions/PMNDRS_font/rasters");
  const hasEmbeddedRaster = rasters.some((value, index) => {
    const path = `/extensions/PMNDRS_font/rasters/${index}`;
    const raster = asRecord(value, "raster", path);
    return asRecord(raster.source, "source", `${path}/source`).type === "embedded";
  });
  if (!hasEmbeddedRaster && bufferViews.length !== 3) {
    fail(
      "BUFFER_VIEW_UNCLAIMED",
      "a core-only font artifact must contain exactly its three shaping buffer views",
      "/bufferViews",
    );
  }
  const shapingView = bufferViews[shapingIndex]!;
  const extentsView = bufferViews[extentsIndex]!;
  const availabilityView = bufferViews[availabilityIndex]!;
  if (extentsView.source.byteStride !== 8 || extentsView.byteLength !== glyphCount * 8) {
    fail(
      "GLYPH_EXTENTS_LAYOUT",
      "glyph extents must have stride 8 and one dense record per glyph",
      `/bufferViews/${extentsIndex}`,
    );
  }
  if (availabilityView.byteLength !== Math.ceil(glyphCount / 8)) {
    fail(
      "GLYPH_EXTENTS_AVAILABILITY_LAYOUT",
      "availability must contain exactly one bit per glyph",
      `/bufferViews/${availabilityIndex}`,
    );
  }
  assertNonOverlappingZeroFilledViews(bufferViews, bin, declaredBinLength);

  const shapingSfnt = sliceView(bin, shapingView);
  const glyphExtents = sliceView(bin, extentsView);
  const glyphExtentsAvailability = sliceView(bin, availabilityView);
  validateShapingSfnt(shapingSfnt, metrics);
  validateExtents(glyphExtents, glyphExtentsAvailability, glyphCount);
  const actualHash = await computeShapingHash(shapingSfnt, glyphExtents, glyphExtentsAvailability);
  if (actualHash !== shaping.hash) {
    fail(
      "SHAPING_HASH",
      "shaping hash does not match the three canonical payload views",
      "/extensions/PMNDRS_font/shaping/hash",
    );
  }
  validateRasterDirectory(font, extensions, extensionsUsed);
  return {
    document,
    shapingSfnt,
    glyphExtents,
    glyphExtentsAvailability,
    shapingHash: actualHash,
    glyphCount,
    khronos,
  };
}

function validateRasterDirectory(
  font: Readonly<Record<string, unknown>>,
  rootExtensions: Readonly<Record<string, unknown>>,
  extensionsUsed: readonly string[],
): void {
  const rasters = asArray(font.rasters, "rasters", "/extensions/PMNDRS_font/rasters");
  const keys = new Set<string>();
  const embeddedExtensions = new Set<string>();
  for (let index = 0; index < rasters.length; index += 1) {
    const path = `/extensions/PMNDRS_font/rasters/${index}`;
    const raster = asRecord(rasters[index], "raster", path);
    const key = asString(raster.rasterKey, "rasterKey", `${path}/rasterKey`);
    const extensionName = asString(raster.extension, "extension", `${path}/extension`);
    if (keys.has(key))
      fail("RASTER_KEY_DUPLICATE", "raster keys must be unique", `${path}/rasterKey`);
    keys.add(key);
    const source = asRecord(raster.source, "source", `${path}/source`);
    if (source.type !== "embedded") continue;
    if (embeddedExtensions.has(extensionName))
      fail(
        "RASTER_EMBEDDED_DUPLICATE",
        "only one raster may be embedded for each companion extension",
        path,
      );
    embeddedExtensions.add(extensionName);
    if (!extensionsUsed.includes(extensionName))
      fail(
        "RASTER_EXTENSION_UNUSED",
        "embedded companion must appear in extensionsUsed",
        `${path}/extension`,
      );
    const companion = asRecord(
      rootExtensions[extensionName],
      extensionName,
      `/extensions/${extensionName}`,
    );
    if (companion.rasterKey !== key)
      fail(
        "RASTER_RECIPROCAL_KEY",
        "embedded companion rasterKey does not match the directory",
        `/extensions/${extensionName}/rasterKey`,
      );
  }
}

interface ResolvedBufferView {
  readonly source: Readonly<Record<string, unknown>>;
  readonly byteOffset: number;
  readonly byteLength: number;
}

function assertNonOverlappingZeroFilledViews(
  views: readonly ResolvedBufferView[],
  bin: Uint8Array,
  declaredBinLength: number,
): void {
  const sorted = [...views].sort((left, right) => left.byteOffset - right.byteOffset);
  let end = 0;
  for (const view of sorted) {
    if (view.byteOffset < end) fail("BUFFER_VIEW_OVERLAP", "font buffer views must not overlap");
    if (!allZero(bin.subarray(end, view.byteOffset)))
      fail("BUFFER_VIEW_GAP", "buffer-view alignment gaps must be zero");
    end = view.byteOffset + view.byteLength;
  }
  if (!allZero(bin.subarray(end, declaredBinLength)))
    fail("BUFFER_TRAILING_DATA", "unreferenced declared BIN bytes must be zero");
}

function sliceView(bin: Uint8Array, view: ResolvedBufferView): Uint8Array {
  return bin.subarray(view.byteOffset, view.byteOffset + view.byteLength);
}

function validateShapingSfnt(bytes: Uint8Array, metrics: Readonly<Record<string, unknown>>): void {
  if (bytes.byteLength < 12) fail("SFNT_HEADER", "shaping SFNT is shorter than its offset table");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const scalerType = view.getUint32(0, false);
  if (scalerType !== 0x0001_0000 && scalerType !== 0x4f54_544f)
    fail("SFNT_FLAVOR", "unsupported shaping SFNT flavor");
  const count = view.getUint16(4, false);
  const directoryBytes = 12 + count * 16;
  if (directoryBytes > bytes.byteLength)
    fail("SFNT_DIRECTORY", "SFNT directory exceeds the shaping view");
  const entrySelector = count === 0 ? 0 : Math.floor(Math.log2(count));
  const searchRange = count === 0 ? 0 : 16 * 2 ** entrySelector;
  if (
    view.getUint16(6, false) !== searchRange ||
    view.getUint16(8, false) !== entrySelector ||
    view.getUint16(10, false) !== count * 16 - searchRange
  ) {
    fail("SFNT_SEARCH_FIELDS", "SFNT search fields are inconsistent");
  }
  const allowed = new Set([
    "GDEF",
    "GPOS",
    "GSUB",
    "OS/2",
    "cmap",
    "head",
    "hhea",
    "hmtx",
    "kern",
    "maxp",
  ]);
  const tables = new Map<string, Uint8Array>();
  const ranges: [number, number][] = [];
  let previousTag = "";
  for (let index = 0; index < count; index += 1) {
    const record = 12 + index * 16;
    const tag = textDecoder.decode(bytes.subarray(record, record + 4));
    const expectedChecksum = view.getUint32(record + 4, false);
    const offset = view.getUint32(record + 8, false);
    const byteLength = view.getUint32(record + 12, false);
    if (!allowed.has(tag))
      fail("SFNT_TABLE_PROFILE", `table ${tag} is outside the closed shaping profile`);
    if (previousTag >= tag) fail("SFNT_TABLE_ORDER", "SFNT table tags must be unique and sorted");
    if ((offset & 3) !== 0 || offset < directoryBytes || offset > bytes.byteLength - byteLength)
      fail("SFNT_TABLE_RANGE", `table ${tag} has an invalid range`);
    const table = bytes.subarray(offset, offset + byteLength);
    const checksumInput = tag === "head" ? table.slice() : table;
    if (tag === "head") {
      if (checksumInput.byteLength < 12) fail("SFNT_HEAD_LENGTH", "head table is too short");
      checksumInput.fill(0, 8, 12);
    }
    if (checksum(checksumInput) !== expectedChecksum)
      fail("SFNT_TABLE_CHECKSUM", `table ${tag} checksum mismatch`);
    const paddedEnd = align4(offset + byteLength);
    if (paddedEnd > bytes.byteLength || !allZero(bytes.subarray(offset + byteLength, paddedEnd)))
      fail("SFNT_TABLE_PADDING", `table ${tag} padding is invalid`);
    tables.set(tag, table);
    ranges.push([offset, paddedEnd]);
    previousTag = tag;
  }
  for (const tag of ["OS/2", "cmap", "head", "hhea", "hmtx", "maxp"]) {
    if (!tables.has(tag)) fail("SFNT_REQUIRED_TABLE", `shaping SFNT is missing ${tag}`);
  }
  ranges.sort((left, right) => left[0] - right[0]);
  let end = directoryBytes;
  for (const range of ranges) {
    if (range[0] < end) fail("SFNT_TABLE_OVERLAP", "SFNT tables overlap");
    end = range[1];
  }
  if (end !== bytes.byteLength) fail("SFNT_TRAILING_DATA", "SFNT has unaccounted trailing bytes");
  if (checksum(bytes) !== 0xb1b0_afba)
    fail("SFNT_CHECKSUM_ADJUSTMENT", "SFNT whole-font checksum is invalid");

  const head = tableDataView(tables, "head", 20);
  const maxp = tableDataView(tables, "maxp", 6);
  const hhea = tableDataView(tables, "hhea", 10);
  const os2 = tableDataView(tables, "OS/2", 74);
  if (
    head.getUint16(18, false) !== metrics.unitsPerEm ||
    maxp.getUint16(4, false) !== metrics.glyphCount ||
    metrics.glyphIdWidth !== 16
  ) {
    fail("SFNT_METRICS_IDENTITY", "serialized font identity does not match the shaping SFNT");
  }
  const useTypoMetrics = (os2.getUint16(62, false) & 0x80) !== 0;
  const ascender = useTypoMetrics ? os2.getInt16(68, false) : hhea.getInt16(4, false);
  const descender = useTypoMetrics ? os2.getInt16(70, false) : hhea.getInt16(6, false);
  const lineGap = useTypoMetrics ? os2.getInt16(72, false) : hhea.getInt16(8, false);
  if (
    metrics.ascender !== ascender ||
    metrics.descender !== descender ||
    metrics.lineGap !== lineGap
  ) {
    fail("SFNT_LINE_METRICS", "serialized line metrics do not match the V0 selection policy");
  }
}

function tableDataView(
  tables: ReadonlyMap<string, Uint8Array>,
  tag: string,
  minimumLength: number,
): DataView {
  const table = tables.get(tag);
  if (table === undefined || table.byteLength < minimumLength)
    fail("SFNT_TABLE_LENGTH", `table ${tag} is too short`);
  return new DataView(table.buffer, table.byteOffset, table.byteLength);
}

function validateExtents(extents: Uint8Array, availability: Uint8Array, glyphCount: number): void {
  const usedBits = glyphCount & 7;
  if (usedBits !== 0 && ((availability.at(-1) ?? 0) & (0xff << usedBits)) !== 0) {
    fail("GLYPH_EXTENTS_UNUSED_BITS", "unused availability bits must be zero");
  }
  for (let glyphId = 0; glyphId < glyphCount; glyphId += 1) {
    const present = ((availability[glyphId >> 3] ?? 0) & (1 << (glyphId & 7))) !== 0;
    if (!present && !allZero(extents.subarray(glyphId * 8, glyphId * 8 + 8))) {
      fail("GLYPH_EXTENTS_ABSENT_DATA", `absent glyph ${glyphId} must have a zero extents record`);
    }
  }
}

async function computeShapingHash(
  sfnt: Uint8Array,
  extents: Uint8Array,
  availability: Uint8Array,
): Promise<string> {
  const parts: Uint8Array<ArrayBufferLike>[] = [textEncoder.encode("PMNDRS_font\0v0\0")];
  for (const value of [sfnt, extents, availability]) {
    const length = new Uint8Array(4);
    new DataView(length.buffer).setUint32(0, value.byteLength, true);
    parts.push(length, value);
  }
  const totalLength = parts.reduce((sum, value) => sum + value.byteLength, 0);
  const input = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    input.set(part, offset);
    offset += part.byteLength;
  }
  const digest = await crypto.subtle.digest("SHA-256", input.buffer);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function checksum(bytes: Uint8Array): number {
  let sum = 0;
  for (let offset = 0; offset < bytes.byteLength; offset += 4) {
    const word =
      ((bytes[offset] ?? 0) << 24) |
      ((bytes[offset + 1] ?? 0) << 16) |
      ((bytes[offset + 2] ?? 0) << 8) |
      (bytes[offset + 3] ?? 0);
    sum = (sum + (word >>> 0)) >>> 0;
  }
  return sum;
}

function align4(value: number): number {
  return (value + 3) & ~3;
}

function allZero(bytes: Uint8Array): boolean {
  return bytes.every((value) => value === 0);
}

function stringArray(value: unknown, name: string, path: string): string[] {
  return asArray(value, name, path).map((item, index) => asString(item, name, `${path}/${index}`));
}

function asRecord(value: unknown, name: string, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    fail("TYPE_OBJECT", `${name} must be an object`, path);
  return value as Record<string, unknown>;
}

function asArray(value: unknown, name: string, path: string): unknown[] {
  if (!Array.isArray(value)) fail("TYPE_ARRAY", `${name} must be an array`, path);
  return value;
}

function asString(value: unknown, name: string, path: string): string {
  if (typeof value !== "string") fail("TYPE_STRING", `${name} must be a string`, path);
  return value;
}

function asInteger(
  value: unknown,
  name: string,
  path: string,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    fail("TYPE_INTEGER", `${name} must be an integer in ${minimum}..=${maximum}`, path);
  }
  return value as number;
}

function fail(code: string, message: string, path?: string): never {
  throw new FontArtifactValidationError([
    { code, message, ...(path === undefined ? {} : { path }) },
  ]);
}
