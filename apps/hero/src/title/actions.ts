import { createActions } from 'koota';
import { editorActions } from '../editor/actions';
import { Time } from '../time/traits';
import { Headline, HeadlineView, type HeadlineDraw } from './traits';

export const titleActions = createActions((world) => ({
  /** Take the headline off the page and stand the caret where its first letter will go. */
  clearHeadline: () => {
    const headline = world.get(Headline)!;
    headline.arrivals.fill(1e9);
    world.set(Headline, { shown: 0, typing: false });
    editorActions(world).standCaret(headline.edges[0]!, headline.top, headline.height);
  },
  startTyping: () => {
    world.set(Headline, { typing: true, nextAt: world.get(Time)!.elapsed });
  },
  /** Show the whole headline, dry: for a visitor who takes over before it has finished. */
  completeHeadline: () => {
    const headline = world.get(Headline)!;

    for (let index = headline.shown; index < headline.length; index++) headline.arrivals[index] = -100;

    world.set(Headline, { shown: headline.length, typing: false });
  },
  mountHeadlineView: (view: HeadlineDraw) => {
    world.set(HeadlineView, view);
  },
  unmountHeadlineView: () => {
    world.set(HeadlineView, undefined);
    world.set(Headline, { measured: false });
  },
}));
