import { createRuntimeWorld, defaultRuntimeFontSizeForWorkload } from './runtime-world';

const workload =
  typeof globalThis.location === 'undefined'
    ? 'benchmark-ipsum'
    : (new URLSearchParams(globalThis.location.search).get('workload') ?? 'benchmark-ipsum');

export const runtimeWorld = createRuntimeWorld({ initialFontSize: defaultRuntimeFontSizeForWorkload(workload) });
