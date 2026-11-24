import type { World } from 'koota';
import { editorActions } from '../editor/actions';
import { sequenceActions } from '../sequence/actions';
import { Time } from '../time/traits';
import { jitter } from '../utils';
import { Headline, HeadlineView } from './traits';

/**
 * Type the headline at a human cadence: a character lands, the caret steps past it, and the next follows after a
 * pause that is longer across a space. The last one tells the sequence the line is set.
 */
export function typeHeadline(world: World): void {
  const headline = world.get(Headline)!;
  const { elapsed } = world.get(Time)!;

  if (!headline.typing || !headline.measured || elapsed < headline.nextAt) return;

  const shown = headline.shown + 1;
  headline.arrivals[headline.shown] = elapsed;
  // A narrow step is a space: the hand rests a little longer before the next word.
  const space = headline.edges[shown]! - headline.edges[shown - 1]! < headline.height * 0.2;
  world.set(Headline, {
    shown,
    typing: shown < headline.length,
    nextAt: elapsed + 0.15 + 0.13 * jitter(shown * 5) + (space ? 0.2 : 0),
  });
  editorActions(world).standCaret(headline.edges[shown]!, headline.top, headline.height);

  if (shown === headline.length) sequenceActions(world).triggerSequence('headline-set');
}

/**
 * Measure the caret stops of the laid-out headline once, and hand the shader each character's edge and arrival so
 * it can draw the typed part and bleed the newest ink.
 */
export function syncHeadlineView(world: World): void {
  const view = world.get(HeadlineView);

  if (view === undefined) return;

  const headline = world.get(Headline)!;

  if (!headline.measured) {
    const length = view.text.text.length;
    let top = 0;
    let height = 1;

    for (let offset = 0; offset <= length; offset++) {
      const { rect } = view.text.caret({ offset, affinity: 'downstream' });
      headline.edges[offset] = view.originX + rect.x;
      top = view.originY + rect.y;
      height = rect.height;
    }

    world.set(Headline, { measured: true, length, top, height });
    editorActions(world).standCaret(headline.edges[headline.shown]!, top, height);
  }

  const edges = view.uniforms.uEdges.array as number[];
  const arrivals = view.uniforms.uArrivals.array as number[];
  const { elapsed } = world.get(Time)!;

  for (let index = 0; index < arrivals.length; index++) {
    // Paragraph x of each character's leading edge, and seconds since it arrived.
    edges[index] = index <= headline.length ? headline.edges[index]! - view.originX : 1e6;
    arrivals[index] = elapsed - headline.arrivals[index]!;
  }
}
