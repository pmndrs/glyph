interface SummaryDefinition {
  readonly id: string;
  readonly label: string;
}

export interface PackageSizeSummaryEntry {
  readonly id: string;
  readonly label: string;
  readonly gzipBytes: number;
}

const summaryDefinitions = [
  { id: 'browser-core', label: 'Core JS' },
  { id: 'text-shaper-wasm', label: 'Shaper Wasm' },
  { id: 'three-runtime-js', label: 'Three.js adapter JS' },
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

export function summarizePackageSizes(report: unknown): readonly PackageSizeSummaryEntry[] {
  if (!isNonArrayObject(report) || !Array.isArray(report.entries)) {
    throw new Error('package-size summary requires a report with entries');
  }
  const entries = new Map<string, { readonly status: unknown; readonly gzipBytes: unknown }>();
  for (const entry of report.entries) {
    if (!isNonArrayObject(entry) || typeof entry.id !== 'string') continue;
    entries.set(entry.id, { status: entry.status, gzipBytes: entry.gzipBytes });
  }
  return summaryDefinitions.map(({ id, label }) => {
    const entry = entries.get(id);
    if (
      entry?.status !== 'measured' ||
      typeof entry.gzipBytes !== 'number' ||
      !Number.isSafeInteger(entry.gzipBytes) ||
      entry.gzipBytes <= 0
    ) {
      throw new Error(`package-size summary requires a positive measured gzip size for ${id}`);
    }
    return { id, label, gzipBytes: entry.gzipBytes };
  });
}

export function sizeLimitRows(report: unknown): readonly { readonly name: string; readonly size: number }[] {
  return summarizePackageSizes(report).map(({ label, gzipBytes }) => ({
    name: `${label} (gzip)`,
    size: gzipBytes,
  }));
}

function isNonArrayObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
