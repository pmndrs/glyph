interface SummaryDefinition {
  readonly id: string;
  readonly label: string;
}

export interface PackageSizeSummaryEntry {
  readonly id: string;
  readonly label: string;
  readonly gzipBytes: number;
}

export interface SizeLimitRow {
  readonly name: string;
  readonly size: number;
}

const summaryDefinitions = [
  { id: 'browser-core', label: 'Core JS' },
  { id: 'text-shaper-wasm', label: 'Shaper Wasm' },
  { id: 'three-runtime-js', label: 'Three.js adapter JS' },
  { id: 'react-runtime-js', label: 'React adapter JS' },
  { id: 'vue-runtime-js', label: 'Vue adapter JS' },
  { id: 'r3f-hello-world-production-js', label: 'R3F hello-world app JS' },
  { id: 'tres-playground-production-js', label: 'Tres playground app JS' },
  { id: 'font-inter-bitmap-16-32', label: 'Inter font · Bitmap' },
  { id: 'font-inter-mtsdf', label: 'Inter font · MTSDF' },
  { id: 'font-inter-slug', label: 'Inter font · Slug' },
  { id: 'font-icons-bitmap-16-32', label: 'Font Awesome icons · Bitmap' },
  { id: 'font-icons-mtsdf', label: 'Font Awesome icons · MTSDF' },
  { id: 'font-icons-slug', label: 'Font Awesome icons · Slug' },
  { id: 'font-validator-js', label: 'Font validator JS' },
  { id: 'runtime-baker-host-js', label: 'Runtime bake host JS' },
  { id: 'runtime-baker-worker-js', label: 'Runtime bake Worker JS' },
  { id: 'portable-baker-js', label: 'Font baker JS' },
  { id: 'portable-baker-wasm', label: 'Font baker Wasm' },
  { id: 'bitmap-baker-js', label: 'Bitmap baker JS' },
  { id: 'bitmap-baker-wasm', label: 'Bitmap baker Wasm' },
  { id: 'mtsdf-baker-js', label: 'MTSDF baker JS' },
  { id: 'mtsdf-baker-wasm', label: 'MTSDF baker Wasm' },
  { id: 'slug-baker-js', label: 'Slug baker JS' },
  { id: 'slug-baker-wasm', label: 'Slug baker Wasm' },
] as const satisfies readonly SummaryDefinition[];

const compactColumns = {
  left: [
    'browser-core',
    'text-shaper-wasm',
    'three-runtime-js',
    'react-runtime-js',
    'vue-runtime-js',
    'r3f-hello-world-production-js',
    'tres-playground-production-js',
    'font-validator-js',
    'runtime-baker-host-js',
    'runtime-baker-worker-js',
    'portable-baker-js',
    'portable-baker-wasm',
  ],
  right: [
    'font-inter-bitmap-16-32',
    'font-inter-mtsdf',
    'font-inter-slug',
    'font-icons-bitmap-16-32',
    'font-icons-mtsdf',
    'font-icons-slug',
    'bitmap-baker-js',
    'bitmap-baker-wasm',
    'mtsdf-baker-js',
    'mtsdf-baker-wasm',
    'slug-baker-js',
    'slug-baker-wasm',
  ],
} as const satisfies Record<'left' | 'right', readonly (typeof summaryDefinitions)[number]['id'][]>;

export function summarizePackageSizes(
  report: unknown,
  options: { readonly allowMissing?: boolean } = {},
): readonly PackageSizeSummaryEntry[] {
  if (!isNonArrayObject(report) || !Array.isArray(report.entries)) {
    throw new Error('package-size summary requires a report with entries');
  }
  const entries = new Map<string, { readonly status: unknown; readonly gzipBytes: unknown }>();
  for (const entry of report.entries) {
    if (!isNonArrayObject(entry) || typeof entry.id !== 'string') continue;
    entries.set(entry.id, { status: entry.status, gzipBytes: entry.gzipBytes });
  }
  return summaryDefinitions.flatMap(({ id, label }) => {
    const entry = entries.get(id);
    if (
      entry?.status !== 'measured' ||
      typeof entry.gzipBytes !== 'number' ||
      !Number.isSafeInteger(entry.gzipBytes) ||
      entry.gzipBytes <= 0
    ) {
      if (options.allowMissing === true && entry === undefined) return [];
      throw new Error(`package-size summary requires a positive measured gzip size for ${id}`);
    }
    return [{ id, label, gzipBytes: entry.gzipBytes }];
  });
}

export function sizeLimitRows(
  report: unknown,
  options: { readonly allowMissing?: boolean } = {},
): readonly SizeLimitRow[] {
  return summarizePackageSizes(report, options).map(({ label, gzipBytes }) => ({
    name: `${label} (gzip)`,
    size: gzipBytes,
  }));
}

export function formatCompactSizeLimitMarkdown(
  baseRows: readonly SizeLimitRow[],
  currentRows: readonly SizeLimitRow[],
  iconBaseUrl = 'https://media.githubusercontent.com/media/pmndrs/glyph/main/.github/assets/package-size',
): string {
  const definitions = new Map(summaryDefinitions.map((definition) => [definition.id, definition]));
  const base = new Map(baseRows.map((row) => [row.name, row.size]));
  const current = new Map(currentRows.map((row) => [row.name, row.size]));
  const lines = ['| Surface | gzip | Surface | gzip |', '| --- | ---: | --- | ---: |'];
  for (let index = 0; index < Math.max(compactColumns.left.length, compactColumns.right.length); index += 1) {
    lines.push(
      `| ${formatSurface(compactColumns.left[index], definitions, base, current, iconBaseUrl)} | ${formatSurface(compactColumns.right[index], definitions, base, current, iconBaseUrl)} |`,
    );
  }
  return lines.join('\n');
}

function formatSurface(
  id: (typeof summaryDefinitions)[number]['id'] | undefined,
  definitions: ReadonlyMap<string, SummaryDefinition>,
  base: ReadonlyMap<string, number>,
  current: ReadonlyMap<string, number>,
  iconBaseUrl: string,
): string {
  if (id === undefined) return ' | ';
  const definition = definitions.get(id);
  if (definition === undefined) throw new Error(`Unknown compact package-size surface ${id}`);
  const name = `${definition.label} (gzip)`;
  const currentBytes = current.get(name);
  if (currentBytes === undefined) throw new Error(`Compact package-size report requires ${name}`);
  return `${definition.label} | ${formatBytes(currentBytes)} (${formatChange(base.get(name), currentBytes, iconBaseUrl)})`;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(2)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} kB`;
  return `${bytes} B`;
}

function formatChange(base: number | undefined, current: number, iconBaseUrl: string): string {
  if (base === undefined || base === 0) return 'new';
  if (current === base) return '0%';
  const percent = ((current - base) / base) * 100;
  const rounded = Math.round(percent * 100) / 100;
  const direction = current > base ? 'increase' : 'decrease';
  const change = rounded === 0 ? '<0.01%' : `${rounded > 0 ? '+' : ''}${rounded}%`;
  return `${change} <img src="${iconBaseUrl}/${direction}.svg" width="12" height="12" alt="Size ${direction}" />`;
}

function isNonArrayObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
