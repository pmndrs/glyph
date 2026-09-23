export const PACKAGE_LABS_SUITES = [
  'smoke',
  'layout',
  'measure',
  'glyphs',
  'publication',
  'batch',
  'style',
  'reflow',
  'stress',
  'full',
] as const;

export type PackageLabsSuite = (typeof PACKAGE_LABS_SUITES)[number];

interface PackageLabsEvent {
  readonly eventName: string;
  readonly labels?: readonly string[];
  readonly ref?: string;
  readonly requestedSuite?: string;
}

const packageLabsSuiteSet = new Set<string>(PACKAGE_LABS_SUITES);

export function selectPackageLabsSuite(event: PackageLabsEvent): PackageLabsSuite {
  if (event.eventName === 'workflow_dispatch') return requirePackageLabsSuite(event.requestedSuite);
  if (event.eventName === 'push') {
    if (event.ref !== 'refs/heads/main') throw new Error(`Package Labs does not run for push ref ${String(event.ref)}`);
    return 'full';
  }
  if (event.eventName !== 'pull_request') throw new Error(`Unsupported Package Labs event: ${event.eventName}`);

  const selected = (event.labels ?? [])
    .filter((label) => label.startsWith('benchmark:'))
    .map((label) => requirePackageLabsSuite(label.slice('benchmark:'.length)));
  const unique = [...new Set(selected)];
  if (unique.length === 0) return 'smoke';
  if (unique.includes('full')) return 'full';
  if (unique.length > 1) {
    throw new Error(
      `Select one focused benchmark label, not ${unique.map((suite) => `benchmark:${suite}`).join(', ')}`,
    );
  }
  return unique[0]!;
}

export function requirePackageLabsSuite(value: string | undefined): PackageLabsSuite {
  if (value !== undefined && isPackageLabsSuite(value)) return value;
  throw new Error(`Unknown Package Labs suite: ${String(value)}`);
}

export function isPackageLabsSuite(value: string): value is PackageLabsSuite {
  return packageLabsSuiteSet.has(value);
}
