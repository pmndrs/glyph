const GLB_MAGIC = 0x4654_6c67;
const JSON_CHUNK = 0x4e4f_534a;
const BIN_CHUNK = 0x004e_4942;
const textDecoder = new TextDecoder('utf-8', { fatal: true });

export interface GlbReadIssue {
  readonly code: string;
  readonly message: string;
  readonly path?: string;
}

export class GlbReadError extends Error {
  readonly issues: readonly GlbReadIssue[];

  constructor(issue: GlbReadIssue) {
    super(`${issue.code}${issue.path === undefined ? '' : ` ${issue.path}`}: ${issue.message}`);
    this.name = 'GlbReadError';
    this.issues = [issue];
  }
}

export interface ParsedGlb {
  readonly document: Record<string, unknown>;
  readonly bin: Uint8Array;
  readonly declaredBinLength: number;
}

/** Read the GLB envelope needed to locate package-owned extension payloads. */
export function readGlb(bytes: Uint8Array): ParsedGlb {
  if (bytes.byteLength < 28) fail('GLB_TOO_SHORT', 'GLB must contain a header plus JSON and BIN chunks');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC) fail('GLB_MAGIC', 'invalid GLB magic', '/header/magic');
  if (view.getUint32(4, true) !== 2) fail('GLB_VERSION', 'only GLB version 2 is supported', '/header/version');
  if (view.getUint32(8, true) !== bytes.byteLength) {
    fail('GLB_LENGTH', 'declared GLB length must consume the complete input', '/header/length');
  }

  const chunks: { readonly type: number; readonly start: number; readonly end: number }[] = [];
  let cursor = 12;
  while (cursor < bytes.byteLength) {
    if (cursor > bytes.byteLength - 8) {
      fail('GLB_CHUNK_HEADER', 'truncated GLB chunk header', `/chunks/${chunks.length}`);
    }
    const byteLength = view.getUint32(cursor, true);
    const type = view.getUint32(cursor + 4, true);
    if ((byteLength & 3) !== 0) {
      fail('GLB_CHUNK_ALIGNMENT', 'chunk byte length must be four-byte aligned', `/chunks/${chunks.length}`);
    }
    const start = cursor + 8;
    const end = start + byteLength;
    if (!Number.isSafeInteger(end) || end < start || end > bytes.byteLength) {
      fail('GLB_CHUNK_RANGE', 'chunk payload exceeds the declared GLB length', `/chunks/${chunks.length}`);
    }
    chunks.push({ type, start, end });
    cursor = end;
  }
  if (cursor !== bytes.byteLength) fail('GLB_TRAILING_BYTES', 'chunks must consume the complete GLB');
  if (chunks.length !== 2 || chunks[0]?.type !== JSON_CHUNK || chunks[1]?.type !== BIN_CHUNK) {
    fail('GLB_CHUNK_ORDER', 'GLB must contain exactly one JSON chunk followed by one BIN chunk');
  }

  const jsonChunk = bytes.subarray(chunks[0]!.start, chunks[0]!.end);
  let jsonEnd = jsonChunk.byteLength;
  while (jsonEnd > 0 && jsonChunk[jsonEnd - 1] === 0x20) jsonEnd -= 1;
  if (jsonEnd === 0) fail('GLB_JSON_EMPTY', 'JSON chunk is empty', '/json');
  for (let index = jsonEnd; index < jsonChunk.byteLength; index += 1) {
    if (jsonChunk[index] !== 0x20) fail('GLB_JSON_PADDING', 'JSON chunk padding must use spaces', '/json');
  }
  let document: unknown;
  try {
    document = JSON.parse(textDecoder.decode(jsonChunk.subarray(0, jsonEnd)));
  } catch (error) {
    fail('GLB_JSON', error instanceof Error ? error.message : String(error), '/json');
  }
  if (!isRecord(document)) fail('GLB_JSON_ROOT', 'GLB JSON root must be an object', '/json');
  const buffers = document.buffers;
  if (!Array.isArray(buffers) || buffers.length !== 1 || !isRecord(buffers[0])) {
    fail('BUFFER_COUNT', 'GLB must contain exactly one embedded buffer', '/buffers');
  }
  if (buffers[0].uri !== undefined) fail('BUFFER_URI', 'GLB buffer must be embedded', '/buffers/0/uri');
  const declaredBinLength = safeInteger(buffers[0].byteLength, 'BUFFER_LENGTH', '/buffers/0/byteLength');
  const binChunk = chunks[1]!;
  const bin = bytes.subarray(binChunk.start, binChunk.end);
  if (declaredBinLength < 0 || declaredBinLength > bin.byteLength || bin.byteLength - declaredBinLength > 3) {
    fail('BIN_LENGTH', 'BIN chunk must equal its declared buffer length plus at most three padding bytes');
  }
  if (bin.subarray(declaredBinLength).some((value) => value !== 0)) {
    fail('BIN_PADDING', 'BIN chunk padding must be zero', '/bin');
  }
  return { document, bin, declaredBinLength };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeInteger(value: unknown, code: string, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) fail(code, 'value must be a safe integer', path);
  return value;
}

function fail(code: string, message: string, path?: string): never {
  throw new GlbReadError({ code, message, ...(path === undefined ? {} : { path }) });
}
