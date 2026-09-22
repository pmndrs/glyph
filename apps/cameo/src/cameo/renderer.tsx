import { useRenderPipeline } from '@react-three/fiber/webgpu';
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js';
import { pass } from 'three/tsl';
import { IconFieldRenderer } from '../icon-field/renderer';
import { RobotRenderer } from '../robot/renderer';
import { Framing } from './camera';
import { BOKEH_SCALE, FOCAL_LENGTH, FOCUS_DISTANCE } from './content';
import { useFonts } from './fonts';
import { Floor, Lighting } from './lighting';
import { PrepareCameo } from './prepare';

export function Cameo() {
  const fonts = useFonts();

  return (
    <>
      <PrepareCameo />
      <Framing />
      <Lighting />
      <Floor />
      <IconFieldRenderer font={fonts.icons} />
      <RobotRenderer font={fonts.face} icons={fonts.icons} />
      <Lens />
    </>
  );
}

/**
 * The whole look of the shot: one lens focused on the robot's face at the mark, holding half a metre of the
 * world either side of it. Everything else, which is the entire icon floor, goes soft.
 */
function Lens() {
  useRenderPipeline(({ renderPipeline, scene, camera }) => {
    const scenePass = pass(scene, camera, { samples: 4 });
    renderPipeline.outputNode = dof(
      scenePass.getTextureNode('output'),
      scenePass.getViewZNode(),
      FOCUS_DISTANCE,
      FOCAL_LENGTH,
      BOKEH_SCALE,
    );
  });

  return null;
}
