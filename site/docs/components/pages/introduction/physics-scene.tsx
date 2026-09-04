import Box3D from 'box3d.js/inline';
import type { Box3DModule, b3BodyId } from 'box3d.js/inline';
import { Text, useFont } from '@pmndrs/glyph/react';
import type { Text as ThreeText } from '@pmndrs/glyph/three';
import { Glyphs } from '@pmndrs/glyph/three';
import { bitmap } from '@pmndrs/glyph/raster/bitmap';
import { msdf } from '@pmndrs/glyph/raster/msdf';
import { useFrame, useThree } from '@react-three/fiber/webgpu';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Matrix4, Quaternion, Vector3 } from 'three';

import type { GlyphSceneProps } from '../../explainer';
import { BITMAP_FONT, MSDF_FONT } from './fonts';
import { bindBodyToGlyph, bodyWorldToGlyphLocal } from './physics-matrix';
import { paragraphTopFromCenter } from './scene-layout';
import { useBitmapTextScale } from './use-bitmap-text-scale';
import { useSceneReady } from './use-scene-ready';

const PHYSICS_PARAGRAPH_STRIKE_PPEM = 16;
const PHYSICS_TITLE_OFFSET_PX = -12;

interface GlyphPhysicsSimulation {
  readonly module: Box3DModule;
  readonly world: ReturnType<Box3DModule['b3CreateWorld']>;
  readonly entries: readonly GlyphPhysicsEntry[];
  readonly roots: readonly GlyphPhysicsRoot[];
  readonly active: () => boolean;
  pulse(point?: Vector3): void;
  dispose(): void;
}

interface GlyphPhysicsEntry {
  readonly body: b3BodyId;
  readonly glyphs: Glyphs;
  readonly index: number;
  readonly bodyToGlyph: Matrix4;
  readonly worldInverse: Matrix4;
  readonly bodyPosition: [number, number, number];
  readonly bodyRotation: [number, number, number, number];
}

interface GlyphPhysicsRoot {
  readonly glyphs: Glyphs;
  readonly worldInverse: Matrix4;
}

export function PhysicsScene({ inputs, onReady }: GlyphSceneProps) {
  const titleFont = useFont(MSDF_FONT.src, { format: MSDF_FONT.format });
  const paragraphFont = useFont(BITMAP_FONT.src, { format: BITMAP_FONT.format });
  const viewport = useThree((state) => state.viewport);
  const canvasSize = useThree((state) => state.size);
  const camera = useThree((state) => state.camera);
  const paragraphScale = useBitmapTextScale(PHYSICS_PARAGRAPH_STRIKE_PPEM);
  const titleSize = Math.min(viewport.width * 0.105, 1.3);
  const paragraphHeight = viewport.height * 0.58;
  const titleCenterY = viewport.height * 0.21 + (PHYSICS_TITLE_OFFSET_PX * viewport.height) / canvasSize.height;
  const titleText = useRef<ThreeText<typeof msdf>>(null);
  const paragraphText = useRef<ThreeText<typeof bitmap>>(null);
  const detachedRef = useRef<readonly Glyphs[] | undefined>(undefined);
  const [detached, setDetachedState] = useState<readonly Glyphs[] | undefined>(undefined);
  const [box3d, setBox3d] = useState<Box3DModule | undefined>(undefined);
  const simulation = useRef<GlyphPhysicsSimulation | undefined>(undefined);
  const pendingPulses = useRef<(Vector3 | undefined)[]>([]);
  const matrix = useMemo(() => new Matrix4(), []);
  const position = useMemo(() => new Vector3(), []);
  const rotation = useMemo(() => new Quaternion(), []);
  const scale = useMemo(() => new Vector3(1, 1, 1), []);
  const physicsAccumulator = useRef(0);
  const settledFrames = useRef(0);
  const setDetached = useCallback((value: readonly Glyphs[] | undefined) => {
    detachedRef.current = value;
    setDetachedState(value);
  }, []);
  useEffect(() => {
    let cancelled = false;
    void Box3D().then((module) => {
      if (!cancelled) setBox3d(module);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const reset = useCallback(() => {
    simulation.current?.dispose();
    simulation.current = undefined;
    pendingPulses.current.length = 0;
    physicsAccumulator.current = 0;
    settledFrames.current = 0;
    for (const glyphs of detachedRef.current ?? []) glyphs.dispose();
    setDetached(undefined);
    if (titleText.current !== null) titleText.current.visible = true;
    if (paragraphText.current !== null) paragraphText.current.visible = true;
  }, [setDetached]);
  useSceneReady(onReady);
  useEffect(() => {
    if (box3d === undefined || detached === undefined || simulation.current !== undefined) return;
    const worldDefinition = box3d.b3DefaultWorldDef();
    worldDefinition.gravity = [0, -9.8, 0];
    worldDefinition.enableSleep = true;
    worldDefinition.enableContinuous = true;
    const world = box3d.b3CreateWorld(worldDefinition);
    const wallThickness = 0.12;
    const halfWidth = viewport.width / 2;
    const halfHeight = viewport.height / 2;
    const frontBoundary = 0.35;
    const backBoundary = -3;
    const halfDepth = (frontBoundary - backBoundary) / 2;
    const wallCenterZ = (frontBoundary + backBoundary) / 2;
    const cameraRotation = camera.getWorldQuaternion(new Quaternion());
    const screenCenter = camera
      .getWorldPosition(new Vector3())
      .add(new Vector3(0, 0, -1).applyQuaternion(cameraRotation).multiplyScalar(viewport.distance));
    const toWorld = (x: number, y: number, z: number) =>
      new Vector3(x, y, z).applyQuaternion(cameraRotation).add(screenCenter);
    const walls: b3BodyId[] = [];
    const createWall = (wallPosition: Vector3, halfExtents: [number, number, number]) => {
      const bodyDefinition = box3d.b3DefaultBodyDef();
      bodyDefinition.type = box3d.b3BodyType.b3_staticBody;
      bodyDefinition.position = [wallPosition.x, wallPosition.y, wallPosition.z];
      bodyDefinition.rotation = [cameraRotation.x, cameraRotation.y, cameraRotation.z, cameraRotation.w];
      const body = box3d.b3CreateBody(world, bodyDefinition);
      const shapeDefinition = box3d.b3DefaultShapeDef();
      shapeDefinition.baseMaterial.restitution = 0.1;
      shapeDefinition.baseMaterial.friction = 0.8;
      box3d.b3CreateBoxShape(body, shapeDefinition, ...halfExtents);
      walls.push(body);
    };
    // The inner faces are exactly the visible viewport bounds. The front plane is just beyond
    // the scene so glyph depth can move toward the camera; the rear plane leaves three units of
    // depth for the 3D impulse to explore without escaping the explainer. Box3D remains in world
    // space; cameraRotation makes this volume follow the screen axes.
    createWall(toWorld(0, -halfHeight - wallThickness, wallCenterZ), [
      halfWidth + wallThickness,
      wallThickness,
      halfDepth + wallThickness,
    ]);
    createWall(toWorld(0, halfHeight + wallThickness, wallCenterZ), [
      halfWidth + wallThickness,
      wallThickness,
      halfDepth + wallThickness,
    ]);
    createWall(toWorld(-halfWidth - wallThickness, 0, wallCenterZ), [
      wallThickness,
      halfHeight + wallThickness,
      halfDepth + wallThickness,
    ]);
    createWall(toWorld(halfWidth + wallThickness, 0, wallCenterZ), [
      wallThickness,
      halfHeight + wallThickness,
      halfDepth + wallThickness,
    ]);
    createWall(toWorld(0, 0, frontBoundary + wallThickness), [
      halfWidth + wallThickness,
      halfHeight + wallThickness,
      wallThickness,
    ]);
    createWall(toWorld(0, 0, backBoundary - wallThickness), [
      halfWidth + wallThickness,
      halfHeight + wallThickness,
      wallThickness,
    ]);

    const entries: GlyphPhysicsEntry[] = [];
    const roots: GlyphPhysicsRoot[] = [];
    for (const glyphs of detached) {
      glyphs.updateWorldMatrix(true, false, true);
      const glyphsMatrixWorld = glyphs.matrixWorld.clone();
      const root = { glyphs, worldInverse: new Matrix4() };
      roots.push(root);
      for (const [glyphIndex, measurement] of glyphs.measurements.entries()) {
        const glyphLocalMatrix = new Matrix4();
        glyphs.getMatrixAt(glyphIndex, glyphLocalMatrix);
        const glyphWorld = glyphsMatrixWorld.clone().multiply(glyphLocalMatrix);
        const glyphLocalBounds = measurement.localInkBounds
          .clone()
          .applyMatrix4(measurement.originalMatrix.clone().invert());
        const center = glyphLocalBounds.getCenter(new Vector3()).applyMatrix4(glyphWorld);
        const localSize = glyphLocalBounds.getSize(new Vector3());
        const glyphRotation = new Quaternion();
        const glyphScale = new Vector3();
        glyphWorld.decompose(new Vector3(), glyphRotation, glyphScale);
        const size = localSize.multiply(
          new Vector3(Math.abs(glyphScale.x), Math.abs(glyphScale.y), Math.abs(glyphScale.z)),
        );
        const bodyDefinition = box3d.b3DefaultBodyDef();
        bodyDefinition.type = box3d.b3BodyType.b3_dynamicBody;
        bodyDefinition.position = [center.x, center.y, center.z];
        bodyDefinition.rotation = [glyphRotation.x, glyphRotation.y, glyphRotation.z, glyphRotation.w];
        bodyDefinition.isBullet = true;
        bodyDefinition.isAwake = false;
        const body = box3d.b3CreateBody(world, bodyDefinition);
        const shapeDefinition = box3d.b3DefaultShapeDef();
        shapeDefinition.density = 1;
        shapeDefinition.baseMaterial.restitution = 0.2;
        shapeDefinition.baseMaterial.friction = 0.5;
        box3d.b3CreateBoxShape(body, shapeDefinition, Math.max(size.x / 2, 0.04), Math.max(size.y / 2, 0.04), 0.08);
        box3d.b3Body_SetAwake(body, false);
        const initialBodyMatrix = new Matrix4().compose(center, glyphRotation, new Vector3(1, 1, 1));
        const bodyToGlyph = bindBodyToGlyph(initialBodyMatrix, glyphWorld, new Matrix4());
        entries.push({
          body,
          glyphs,
          index: glyphIndex,
          bodyToGlyph,
          worldInverse: root.worldInverse,
          bodyPosition: [0, 0, 0],
          bodyRotation: [0, 0, 0, 1],
        });
      }
    }

    let activated = false;
    const state: GlyphPhysicsSimulation = {
      module: box3d,
      world,
      entries,
      roots,
      active: () => activated,
      pulse(point) {
        const currentCenters = entries.map((entry) => {
          const bodyPosition: [number, number, number] = [0, 0, 0];
          box3d.b3Body_GetPosition(bodyPosition, entry.body);
          return new Vector3(bodyPosition[0], bodyPosition[1], bodyPosition[2]);
        });
        const center = currentCenters
          .reduce((sum, currentCenter) => sum.add(currentCenter), new Vector3())
          .multiplyScalar(1 / Math.max(currentCenters.length, 1));
        const origin = point ?? center;
        const radius = Math.min(viewport.width * 0.12, 0.8);
        for (const [index, entry] of entries.entries()) {
          const offset = currentCenters[index]!.clone().sub(origin);
          const distance = offset.length();
          if (distance > radius) continue;
          if (distance < 1e-6) offset.set(index % 2 === 0 ? 1 : -1, 0, 0);
          offset.normalize();
          const falloff = 1 - distance / radius;
          const strength = box3d.b3Body_GetMass(entry.body) * 0.16 * falloff;
          const impulse: [number, number, number] = [offset.x * strength, offset.y * strength, offset.z * strength];
          box3d.b3Body_SetAwake(entry.body, true);
          box3d.b3Body_ApplyLinearImpulseToCenter(entry.body, impulse, false);
          activated = true;
        }
      },
      dispose() {
        for (const entry of entries) box3d.b3DestroyBody(entry.body);
        for (const wall of walls) box3d.b3DestroyBody(wall);
        box3d.b3DestroyWorld(world);
      },
    };
    simulation.current = state;
    return () => {
      if (simulation.current === state) state.dispose();
      simulation.current = undefined;
    };
  }, [box3d, camera, detached, viewport.distance, viewport.height, viewport.width]);
  useEffect(
    () => () => {
      const current = detachedRef.current;
      detachedRef.current = undefined;
      for (const glyphs of current ?? []) glyphs.dispose();
    },
    [],
  );
  useFrame((_state, delta) => {
    for (const input of inputs.drain()) {
      if (input.type === 'control' && input.value === 'reset') {
        reset();
        continue;
      }
      if (input.type !== 'pointerdown') continue;
      const cameraRotation = camera.getWorldQuaternion(new Quaternion());
      const point =
        input.x === undefined || input.y === undefined
          ? undefined
          : new Vector3(
              (input.x / canvasSize.width - 0.5) * viewport.width,
              (0.5 - input.y / canvasSize.height) * viewport.height,
              0.25,
            )
              .applyQuaternion(cameraRotation)
              .add(
                camera
                  .getWorldPosition(new Vector3())
                  .add(new Vector3(0, 0, -viewport.distance).applyQuaternion(cameraRotation)),
              );
      if (detachedRef.current === undefined) {
        const title = titleText.current;
        const paragraph = paragraphText.current;
        if (title === null || paragraph === null || title.parent === null || paragraph.parent === null) continue;
        let titleGlyphs: Glyphs | undefined;
        let paragraphGlyphs: Glyphs | undefined;
        try {
          [titleGlyphs] = title.breakApart();
          [paragraphGlyphs] = paragraph.breakApart();
          // Source visibility and detached ownership change in one synchronous scene-graph
          // mutation. No promise, React commit, or retained-publication swap sits in this path.
          title.parent.add(titleGlyphs);
          paragraph.parent.add(paragraphGlyphs);
          title.visible = false;
          paragraph.visible = false;
          setDetached([titleGlyphs, paragraphGlyphs]);
        } catch (error) {
          titleGlyphs?.dispose();
          paragraphGlyphs?.dispose();
          title.visible = true;
          paragraph.visible = true;
          throw error;
        }
      }
      pendingPulses.current.push(point);
    }
    const current = simulation.current;
    if (current === undefined) return;
    for (const point of pendingPulses.current.splice(0)) current.pulse(point);
    physicsAccumulator.current = Math.min(physicsAccumulator.current + delta, 4 / 60);
    while (physicsAccumulator.current >= 1 / 60) {
      current.module.b3World_Step(current.world, 1 / 60, 4);
      physicsAccumulator.current -= 1 / 60;
    }
    for (const root of current.roots) {
      root.glyphs.updateWorldMatrix(true, false, true);
      root.worldInverse.copy(root.glyphs.matrixWorld).invert();
    }
    for (const entry of current.entries) {
      current.module.b3Body_GetTransform(entry.bodyPosition, entry.bodyRotation, entry.body);
      position.set(entry.bodyPosition[0], entry.bodyPosition[1], entry.bodyPosition[2]);
      rotation.set(entry.bodyRotation[0], entry.bodyRotation[1], entry.bodyRotation[2], entry.bodyRotation[3]);
      matrix.compose(position, rotation, scale);
      bodyWorldToGlyphLocal(entry.worldInverse, matrix, entry.bodyToGlyph, matrix);
      entry.glyphs.setMatrixAt(entry.index, matrix);
    }
    if (
      current.active() &&
      current.entries.length > 0 &&
      current.entries.every((entry) => !current.module.b3Body_IsAwake(entry.body))
    ) {
      settledFrames.current += 1;
      if (settledFrames.current >= 4) reset();
    } else {
      settledFrames.current = 0;
    }
  });
  return (
    <group>
      <Text
        ref={titleText}
        constraints={{ width: { mode: 'exact', size: viewport.width } }}
        font={titleFont}
        layout={{ align: 'center', wrap: 'none' }}
        position={[-viewport.width / 2, paragraphTopFromCenter(titleSize, titleCenterY), 0]}
        style={{ color: '#22d3ee', fontSize: titleSize }}
      >
        Glyph Physics
      </Text>
      <Text
        ref={paragraphText}
        constraints={{
          height: { mode: 'exact', size: paragraphHeight },
          width: { mode: 'exact', size: viewport.width * 0.72 },
        }}
        font={paragraphFont}
        layout={{ align: 'justify', wrap: 'word' }}
        position={[-viewport.width * 0.36, paragraphTopFromCenter(paragraphHeight, -viewport.height * 0.25), 0]}
        rasterPixelRatio={paragraphScale.rasterPixelRatio}
        style={{
          color: '#bae6fd',
          fontSize: paragraphScale.fontSize,
          lineHeight: 1.2,
        }}
      >
        Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer vitae sem at sapien consequat tincidunt. Sed
        posuere, justo at aliquet luctus, lectus nibh cursus nibh, vitae volutpat est magna sed neque. Praesent commodo,
        arcu non feugiat posuere, augue massa tincidunt sapien, vel tincidunt erat libero sit amet urna. Donec finibus,
        sapien a porttitor faucibus, nunc arcu suscipit nunc, vitae aliquam nibh sem non erat.
      </Text>
    </group>
  );
}
