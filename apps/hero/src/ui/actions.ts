import { createActions } from 'koota';
import { PlayButton, PlayButtonView, type PlayButtonDraw } from './traits';

export const uiActions = createActions((world) => ({
  initializePlayButton: () => {
    world.add(PlayButton);
  },
  mountPlayButtonView: (view: PlayButtonDraw) => {
    world.add(PlayButtonView(view));
  },
  unmountPlayButtonView: () => {
    world.remove(PlayButtonView);
  },
}));
