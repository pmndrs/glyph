import { createActions } from 'koota';
import { PlayButtonView, type PlayButtonDraw } from './traits';

export const playButtonActions = createActions((world) => ({
  mountPlayButtonView: (view: PlayButtonDraw) => {
    world.add(PlayButtonView(view));
  },
  unmountPlayButtonView: () => {
    world.remove(PlayButtonView);
  },
}));
