import {
  createRuntimeWorld,
  defaultRuntimeFontSizeForWorkload,
  defaultRuntimeLayoutWidthPercentForWorkload,
  defaultRuntimeWorkloadAmountForWorkload,
} from './runtime-world';

const locationParameters =
  typeof globalThis.location === 'undefined' ? undefined : new URLSearchParams(globalThis.location.search);
const workload = locationParameters?.get('workload') ?? 'benchmark-ipsum';
const layout = globalThis.location?.pathname === '/presentation' ? 'presentation' : 'main';

export const runtimeWorld = createRuntimeWorld({
  initialFontSize: defaultRuntimeFontSizeForWorkload(workload, layout),
  initialLayoutWidthPercent: defaultRuntimeLayoutWidthPercentForWorkload(workload),
  initialWorkloadAmount: defaultRuntimeWorkloadAmountForWorkload(workload),
});
