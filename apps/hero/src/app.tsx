import './styles.css';

import { Environment, Lightformer } from '@react-three/drei/webgpu';
import { Canvas, useRenderPipeline, useThree } from '@react-three/fiber/webgpu';
import { WorldProvider, useTrait } from 'koota/react';
import { Suspense, useEffect } from 'react';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js';
import { convertToTexture, float, mx_noise_float, pass, screenCoordinate, smoothstep, uv, vec3, vec4 } from 'three/tsl';
import { NoToneMapping, type Node } from 'three/webgpu';
import { cameraUniforms } from './camera/materials';
import { CameraRig } from './camera/renderer';
import { OutlineRenderer } from './dive/renderer';
import { CaretRenderer } from './editor/renderer';
import { FrameLoop } from './frameloop';
import { Hud } from './hud/renderer';
import { useFonts } from './loading/fonts';
import { PrepareHero } from './loading/prepare';
import { pageUniforms } from './page/materials';
import { PageRenderer } from './page/renderer';
import { qualityActions } from './quality/actions';
import { TIERS } from './quality/content';
import { Quality, type Tier } from './quality/traits';
import { lensFrame } from './stone/materials';
import { StoneRenderer } from './stone/renderer';
import { HeadlineRenderer } from './title/renderer';
import { world } from './world';

/**
 * `?tier=lite` or `?tier=full` pins the tier, `?dpr=` pins the pixel ratio, and `?still` asks for less motion as
 * the system setting would. Without a pinned tier a coarse pointer or a small device starts lite.
 */
const query = new URLSearchParams(location.search);
const pinnedDpr = Number(query.get('dpr'));
const pinnedTier = query.get('tier');
const startTier: Tier =
  pinnedTier === 'lite' || pinnedTier === 'full'
    ? pinnedTier
    : matchMedia('(pointer: coarse)').matches || Math.min(screen.width, screen.height) < 700
      ? 'lite'
      : 'full';
qualityActions(world).setTier(startTier);

export function App() {
  return (
    <WorldProvider world={world}>
      <Hud />
      <Stage />
    </WorldProvider>
  );
}

/** The canvas, rebuilt when the tier changes: a tier is a different set of passes and materials. */
function Stage() {
  const tier = useTrait(world, Quality)?.tier ?? startTier;
  const budget = TIERS[tier];

  useEffect(() => {
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => qualityActions(world).setReducedMotion(motion.matches || query.has('still'));
    update();
    motion.addEventListener('change', update);

    return () => motion.removeEventListener('change', update);
  }, []);

  return (
    <Canvas
      background={'#000000'}
      camera={{ far: 400, fov: 30, near: 0.05, position: [0, 0, 30] }}
      dpr={pinnedDpr > 0 ? pinnedDpr : [budget.dpr[0], budget.dpr[1]]}
      key={tier}
      // Only a probe page times its passes on the GPU's clock: the queries are not free.
      renderer={{ scheduler: { fps: 60 }, toneMapping: NoToneMapping, trackTimestamp: query.has('probe') }}
    >
      <Suspense fallback={null}>
        <FrameLoop />
        <Resolution tier={tier} />
        <Scene tier={tier} />
      </Suspense>
    </Canvas>
  );
}

/** Draw at the share of the tier's pixel ratio the frame budget currently allows. */
function Resolution({ tier }: { readonly tier: Tier }) {
  const scale = useTrait(world, Quality)?.scale ?? 1;
  const setDpr = useThree((state) => state.setDpr);

  useEffect(() => {
    if (pinnedDpr > 0) return;

    const [least, most] = TIERS[tier].dpr;
    setDpr(Math.max(least * 0.6, Math.min(most, devicePixelRatio) * scale));
  }, [tier, scale, setDpr]);

  return null;
}

/** The scene: every domain's renderer, in a dark studio, composed through the post pass. */
function Scene({ tier }: { readonly tier: Tier }) {
  const fonts = useFonts();
  const budget = TIERS[tier];

  return (
    <>
      <PrepareHero />
      <CameraRig />
      <Studio />
      <PageRenderer fonts={fonts} />
      <HeadlineRenderer font={fonts.display} glass={budget.transmission} />
      <StoneRenderer />
      <CaretRenderer />
      <OutlineRenderer />
      <Post tier={tier} />
    </>
  );
}

/**
 * The lens, the glow, the stone's bending of the frame, and the grade. Depth of field focuses on the page where
 * the camera is looking, so a tilted spread falls off toward its far edge; only what is brighter than paper
 * blooms; the stone bends the finished picture; and the grade lifts the shadows a touch cool, rolls the
 * highlights off warm, darkens the corners and lays a fine grain over it.
 */
function Post({ tier }: { readonly tier: Tier }) {
  useRenderPipeline(({ renderPipeline, scene, camera }) => {
    const budget = TIERS[tier];
    const scenePass = pass(scene, camera, { samples: query.has('nomsaa') ? 0 : budget.samples });
    const beauty = scenePass.getTextureNode('output');
    const { uFocus, uAperture, uDive } = cameraUniforms;
    // @types/three 0.185.4 types the depth-of-field node without the node operators it has.
    const focused: Node<'vec4'> =
      budget.depthOfField && !query.has('nodof')
        ? (dof(
            beauty,
            scenePass.getViewZNode(),
            uFocus,
            uFocus.mul(0.5).div(uAperture.add(0.25)),
            uAperture.mul(1.5),
          ) as unknown as Node<'vec4'>)
        : beauty;
    const glow = bloom(focused, 0.62, 0.55, 1.02);
    glow.setResolutionScale(budget.bloomScale);
    const lit = convertToTexture(query.has('nobloom') ? focused : focused.add(glow));
    const frame = uv();
    const seen = lensFrame(lit, frame);
    // Filmic shoulder, per channel: paper white stays put and what is brighter rolls off instead of clipping.
    const rolled = seen.div(seen.mul(0.22).add(1)).mul(1.22);
    const luma = rolled.dot(vec3(0.2126, 0.7152, 0.0722));
    const toned = rolled.mul(vec3(1.03, 1, 0.965)).add(vec3(0.004, 0.006, 0.012).mul(float(1).sub(luma)));
    const corner = frame.sub(0.5).length();
    const vignette = float(1).sub(smoothstep(0.42, 0.95, corner).mul(0.55));
    // Grain rides its own clock, which holds still for a visitor who asked for less motion.
    const grain = mx_noise_float(vec3(screenCoordinate.xy.mul(0.9), pageUniforms.uGrain.mul(24)))
      .mul(0.035)
      .mul(float(1).sub(uDive.mul(0.5)));
    renderPipeline.outputNode = vec4(toned.mul(vignette).add(grain.mul(luma.add(0.25))), 1);
  });

  return null;
}

/** A dark studio for the glass: a broad soft key overhead and two edge strips, dim enough to leave the field black. */
function Studio() {
  return (
    <Environment background={false} environmentIntensity={0.55} resolution={256}>
      <Lightformer
        color="#fff3e0"
        form="rect"
        intensity={3}
        position={[0, 8, 9]}
        rotation-x={Math.PI / 2}
        scale={[22, 3, 1]}
      />
      <Lightformer
        color="#dfe8ff"
        form="rect"
        intensity={2}
        position={[-13, 0, 5]}
        rotation-y={Math.PI / 2}
        scale={[3, 12, 1]}
      />
      <Lightformer
        color="#ffe2c4"
        form="rect"
        intensity={2}
        position={[13, 0, 5]}
        rotation-y={-Math.PI / 2}
        scale={[3, 12, 1]}
      />
    </Environment>
  );
}
