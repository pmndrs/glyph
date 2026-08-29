import type { RasterKey } from '../identity.js';
import type { JsonValue } from '../raster.js';
import { fingerprint128, fingerprintDomain } from './fingerprint.js';

const textEncoder = new TextEncoder();
const MAX_JSON_DEPTH = 256;

function assertUnicodeScalarString(value: string, path: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (index + 1 >= value.length || next < 0xdc00 || next > 0xdfff) {
        throw new TypeError(`${path} contains an unpaired high surrogate`);
      }
      index += 1;
      continue;
    }
    if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new TypeError(`${path} contains an unpaired low surrogate`);
    }
  }
}

function canonicalize(value: unknown, path: string, ancestors: Set<object>, depth: number): string {
  if (depth > MAX_JSON_DEPTH) {
    throw new TypeError(`${path} exceeds the maximum JSON nesting depth`);
  }
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${path} must contain only finite numbers`);
    return JSON.stringify(value);
  }

  if (typeof value === 'string') {
    assertUnicodeScalarString(value, path);
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return withAncestor(
      value,
      path,
      ancestors,
      () => `[${value.map((entry, index) => canonicalize(entry, `${path}/${index}`, ancestors, depth + 1)).join(',')}]`,
    );
  }

  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`${path} must contain only plain JSON objects`);
    }
    const object = value as Record<string, unknown>;
    return withAncestor(value, path, ancestors, () => {
      const members: string[] = [];
      for (const key of Object.keys(object).sort()) {
        assertUnicodeScalarString(key, `${path}/<key>`);
        members.push(`${JSON.stringify(key)}:${canonicalize(object[key], `${path}/${key}`, ancestors, depth + 1)}`);
      }
      return `{${members.join(',')}}`;
    });
  }

  throw new TypeError(`${path} is not a JSON value`);
}

/** RFC 8785 JSON Canonicalization Scheme serialization. */
export function canonicalJson(value: JsonValue): string {
  return canonicalize(value, '$', new Set(), 0);
}

function withAncestor<Result>(value: object, path: string, ancestors: Set<object>, operation: () => Result): Result {
  if (ancestors.has(value)) throw new TypeError(`${path} must not contain a cycle`);
  ancestors.add(value);
  try {
    return operation();
  } finally {
    ancestors.delete(value);
  }
}

/** Derive a caller-independent raster key from a module-owned descriptor. */
export function deriveRasterKey(input: {
  readonly descriptor: JsonValue;
  readonly extension: string;
  readonly kind: string;
  readonly version: number;
}): RasterKey {
  const canonical = canonicalJson({
    descriptor: input.descriptor,
    extension: input.extension,
    kind: input.kind,
    version: input.version,
  });
  return fingerprint128(textEncoder.encode(canonical), fingerprintDomain.descriptor) as string as RasterKey;
}
