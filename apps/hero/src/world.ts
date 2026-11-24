import { createWorld } from 'koota';
import { actions } from './actions';
import { Shot, CameraView, Rig } from './camera/traits';
import { Grip, Mode } from './director/traits';
import { DiveView } from './dive/traits';
import { Caret, EditorView, Typist } from './editor/traits';
import { BodyView, DropCap, Letterpress, Script, Spread } from './page/traits';
import { Physics } from './physics/traits';
import { Quality } from './quality/traits';
import { Timeline } from './sequence/traits';
import { Stone, StoneView, Taken } from './stone/traits';
import { Time } from './time/traits';
import { Headline, HeadlineView } from './title/traits';
import { Viewport } from './viewport/traits';

/** The application shares one initialized world across its domains. */
export const world = createWorld(
  Time,
  Viewport,
  Quality,
  Timeline,
  Mode,
  Grip,
  Rig,
  Shot,
  CameraView,
  Spread,
  Letterpress,
  Script,
  DropCap,
  BodyView,
  Headline,
  HeadlineView,
  Stone,
  StoneView,
  Taken,
  Physics,
  Caret,
  Typist,
  EditorView,
  DiveView,
);

actions(world).initializePhysics();
actions(world).initializeScene();
