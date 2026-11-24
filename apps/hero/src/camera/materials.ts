import { uniform } from 'three/tsl';
import { retained } from '../utils';

/** What the camera tells the shaders: where the lens is focused, how open it is, and how far the dive has gone. */
export const cameraUniforms = retained('camera', () => ({
  uFocus: uniform(10),
  uAperture: uniform(0),
  uDive: uniform(0),
}));
