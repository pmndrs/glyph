import { createWorld } from 'koota';
import { jugglerActions } from './juggler/actions';
import { FigureView, Juggler, Viewport } from './juggler/traits';
import { Debris, DebrisView, FlameView, Paragraph, Release, Sentence } from './letters/traits';
import { Time } from './time/traits';

/** The application shares one initialized world across its domains. */
export const world = createWorld(
  Time,
  Viewport,
  Sentence,
  Release,
  Paragraph,
  Debris,
  Juggler,
  FlameView,
  DebrisView,
  FigureView,
);
jugglerActions(world).spawnJuggler();
