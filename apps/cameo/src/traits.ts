import { Frame, Lens } from './cameo/traits';
import { Shocks } from './icon-field/traits';
import { Timeline } from './sequence/traits';
import { Time } from './time/traits';

/**
 * Every world-level trait the application registers. The world and its tests build from this one list, so a domain
 * that gains a world-level trait cannot leave the headless world missing it.
 */
export const WORLD_TRAITS = [Time, Frame, Lens, Timeline, Shocks] as const;
