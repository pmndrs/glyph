import type { BakeProgress, BakeProgressPhase } from '../bake.js';

const PHASES = new Set<BakeProgressPhase>([
  'queued',
  'loading',
  'baking',
  'rasterizing',
  'packaging',
  'transferring',
  'complete',
]);

export interface BakeProgressMessage extends BakeProgress {
  readonly type: 'bake-progress-v0';
  readonly id: number;
}

export function bakeProgressMessage(
  id: number,
  stage: BakeProgress['stage'],
  phase: BakeProgressPhase,
  completed: number,
  total: number,
): BakeProgressMessage {
  return { type: 'bake-progress-v0', id, stage, phase, completed, total };
}

export function isBakeProgressMessage(value: unknown): value is BakeProgressMessage {
  if (!isObject(value)) return false;
  return (
    value.type === 'bake-progress-v0' &&
    isPositiveSafeInteger(value.id) &&
    (value.stage === 'font' || value.stage === 'raster') &&
    typeof value.phase === 'string' &&
    PHASES.has(value.phase as BakeProgressPhase) &&
    isPositiveSafeInteger(value.total) &&
    isNonnegativeSafeInteger(value.completed) &&
    value.completed <= value.total
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isNonnegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
