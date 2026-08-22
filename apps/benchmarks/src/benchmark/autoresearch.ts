export interface AutoresearchEvidence {
  readonly id: string;
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
}

export type AutoresearchCampaign =
  | { readonly state: 'disabled'; readonly reason: string }
  | {
      readonly state: 'enabled';
      readonly approvedBy: string;
      readonly approvedAt: string;
      readonly manifest: string;
    };

export interface AutoresearchBaseline {
  readonly schemaVersion: 0;
  readonly baseCommit: string;
  readonly campaign: AutoresearchCampaign;
  readonly environment: {
    readonly node: string;
    readonly pnpm: string;
    readonly rust: string;
  };
  readonly evidence: readonly AutoresearchEvidence[];
}

export function assertAutoresearchBaseline(value: unknown): asserts value is AutoresearchBaseline {
  assertPlainObject(value, 'baseline');
  if (value.schemaVersion !== 0) invalid('schemaVersion must be 0');
  if (!isHexDigest(value.baseCommit, 40)) invalid('baseCommit must be a full Git SHA-1');
  assertCampaign(value.campaign);
  assertPlainObject(value.environment, 'environment');
  for (const key of ['node', 'pnpm', 'rust'] as const) {
    if (!isNonEmptyString(value.environment[key])) invalid(`environment.${key} is required`);
  }
  if (!Array.isArray(value.evidence) || value.evidence.length === 0) invalid('evidence must be non-empty');
  const ids = new Set<string>();
  for (const entry of value.evidence) {
    assertPlainObject(entry, 'evidence entry');
    if (!isNonEmptyString(entry.id) || ids.has(entry.id)) invalid('evidence ids must be unique');
    ids.add(entry.id);
    if (!isNonEmptyString(entry.path) || entry.path.startsWith('/') || entry.path.includes('..'))
      invalid('evidence paths must be repository-relative');
    if (!isHexDigest(entry.sha256, 64)) invalid('evidence sha256 must contain 64 lowercase hex bytes');
    if (typeof entry.bytes !== 'number' || !Number.isSafeInteger(entry.bytes) || entry.bytes <= 0)
      invalid('evidence bytes must be a positive safe integer');
  }
}

export function assertAutoresearchDisabled(
  baseline: AutoresearchBaseline,
): asserts baseline is AutoresearchBaseline & {
  readonly campaign: Extract<AutoresearchCampaign, { readonly state: 'disabled' }>;
} {
  if (baseline.campaign.state !== 'disabled') {
    throw new Error('autoresearch campaigns require explicit maintainer approval');
  }
}

function assertCampaign(value: unknown): asserts value is AutoresearchCampaign {
  assertPlainObject(value, 'campaign');
  if (value.state === 'disabled') {
    if (!isNonEmptyString(value.reason)) invalid('disabled campaign reason is required');
    return;
  }
  if (value.state === 'enabled') {
    for (const key of ['approvedBy', 'approvedAt', 'manifest'] as const) {
      if (!isNonEmptyString(value[key])) invalid(`enabled campaign ${key} is required`);
    }
    return;
  }
  invalid('campaign state must be disabled or enabled');
}

function assertPlainObject(value: unknown, label: string): asserts value is Record<PropertyKey, unknown> {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  ) {
    invalid(`${label} must be a plain object`);
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isHexDigest(value: unknown, length: 40 | 64): value is string {
  return typeof value === 'string' && value.length === length && /^[0-9a-f]+$/.test(value);
}

function invalid(message: string): never {
  throw new TypeError(`invalid autoresearch baseline: ${message}`);
}
