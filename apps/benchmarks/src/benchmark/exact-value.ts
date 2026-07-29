export function exactValue(actual: unknown, expected: unknown): boolean {
  if (typeof actual === 'number' || typeof expected === 'number') {
    return (
      typeof actual === 'number' &&
      typeof expected === 'number' &&
      Number.isFinite(actual) &&
      Number.isFinite(expected) &&
      Object.is(actual, expected)
    );
  }
  if (Object.is(actual, expected)) return true;
  if (Array.isArray(actual) || Array.isArray(expected)) {
    return (
      Array.isArray(actual) &&
      Array.isArray(expected) &&
      actual.length === expected.length &&
      actual.every((value, index) => exactValue(value, expected[index]))
    );
  }
  if (!isPlainRecord(actual) || !isPlainRecord(expected)) return false;
  const actualKeys = Object.keys(actual);
  const expectedKeys = Object.keys(expected);
  return (
    actualKeys.length === expectedKeys.length &&
    actualKeys.every((key, index) => key === expectedKeys[index] && exactValue(actual[key], expected[key]))
  );
}

function isPlainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
