import { createFontStack, type AnyRasterTechnique } from '@pmndrs/glyph';
import Box3D from 'box3d.js/inline';
import type { Box3DModule, b3BodyId } from 'box3d.js/inline';
import { Text, useFont } from '@pmndrs/glyph/react';
import { Glyphs } from '@pmndrs/glyph/three';
import { bitmap } from '@pmndrs/glyph/three/bitmap';
import { msdf } from '@pmndrs/glyph/three/msdf';
import { slug } from '@pmndrs/glyph/three/slug';
import { useFrame, useThree } from '@react-three/fiber/webgpu';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
import type { Text as ThreeText } from '@pmndrs/glyph/three';
import { Group, Matrix4, Mesh, Plane, Quaternion, Raycaster, Vector2, Vector3 } from 'three';

import cjkFontUrl from '../assets/fonts/mplus1p-japanese.font.glb?url';
import geistFontUrl from '../assets/fonts/geist-msdf.font.glb?url';
import iconFontUrl from '../assets/fonts/font-awesome-icons-msdf.font.glb?url';
import loversQuarrelFontUrl from '../assets/fonts/lovers-quarrel-slug.font.glb?url';
import vt323FontUrl from '../assets/fonts/vt323-bitmap.font.glb?url';
import { setProxyPointNdc } from './glyph-editing';
import { defineGlyphRoot, GlyphOffscreenRootElement, type GlyphSceneProps } from './glyph-offscreen-root';
import { bindBodyToGlyph, bodyWorldToGlyphLocal } from './glyph-physics-matrix';

const SLUG_FONT = { input: loversQuarrelFontUrl, raster: { technique: slug } } as const;
const MSDF_FONT = {
  input: geistFontUrl,
  raster: { technique: msdf, options: { emSize: 32, pixelRange: 6 } },
} as const;
const BITMAP_FONT = {
  input: vt323FontUrl,
  raster: { technique: bitmap, options: { strikes: [16, 24, 32] } },
} as const;

const PHYSICS_PARAGRAPH_STRIKE_PPEM = 16;
const PHYSICS_TITLE_OFFSET_PX = -12;
const ICON_FONT = {
  input: iconFontUrl,
  raster: { technique: msdf, options: { emSize: 32, pixelRange: 6 } },
} as const;
const CJK_FONT = {
  input: cjkFontUrl,
  raster: { technique: msdf, options: { emSize: 32, pixelRange: 6 } },
} as const;

useFont.preload(SLUG_FONT.input, SLUG_FONT.raster.technique);
useFont.preload(MSDF_FONT.input, MSDF_FONT.raster.technique, MSDF_FONT.raster.options);
useFont.preload(BITMAP_FONT.input, BITMAP_FONT.raster.technique, BITMAP_FONT.raster.options);
useFont.preload(ICON_FONT.input, ICON_FONT.raster.technique, ICON_FONT.raster.options);
useFont.preload(CJK_FONT.input, CJK_FONT.raster.technique, CJK_FONT.raster.options);

const ICONS = ['\uf135', '\uf1fc', '\uf53f', '\uf0e7', '\uf011'];
const glyphCenter = (width: number, height: number) => [-width / 2, height / 2, 0] as [number, number, number];
function AnimatedGroup({
  children,
  speed = 1,
  amount = 0.04,
}: {
  children: ReactNode;
  speed?: number;
  amount?: number;
}) {
  const group = useRef<Group>(null);
  const elapsed = useRef(0);
  useFrame((_state, delta) => {
    elapsed.current += delta;
    if (group.current) {
      group.current.position.y = Math.sin(elapsed.current * speed) * amount;
      group.current.rotation.z = Math.sin(elapsed.current * speed * 0.7) * amount * 0.25;
    }
  });
  return <group ref={group}>{children}</group>;
}

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

function IntroductionScene({ inputs, onReady, scene }: GlyphSceneProps) {
  const font = useFont(SLUG_FONT.input, SLUG_FONT.raster.technique);
  const viewport = useThree((state) => state.viewport);
  const mark = useRef<Group>(null);
  const elapsed = useRef(0);
  const [pressed, setPressed] = useState(false);
  const word = scene === 'shaping' ? 'glÿph' : 'glyph';
  useEffect(() => onReady(), [onReady]);
  useFrame((_state, delta) => {
    for (const input of inputs.drain()) if (input.type === 'pointerdown') setPressed((value) => !value);
    elapsed.current += delta;
    if (mark.current) mark.current.rotation.z = Math.sin(elapsed.current * 1.2) * 0.025;
  });
  return (
    <group ref={mark}>
      <Text
        constraints={{ width: { mode: 'exact', size: viewport.width } }}
        font={font}
        layout={{ align: 'center', wrap: 'none' }}
        position={glyphCenter(viewport.width, viewport.height)}
        style={{
          color: pressed ? '#fb7185' : '#7dd3fc',
          fontSize: Math.min(viewport.width * 0.2, viewport.height * 0.35),
        }}
      >
        {word}
      </Text>
    </group>
  );
}

function TechniqueScene({ onReady }: GlyphSceneProps) {
  const slugFont = useFont(SLUG_FONT.input, SLUG_FONT.raster.technique);
  const msdfFont = useFont(MSDF_FONT.input, MSDF_FONT.raster.technique, MSDF_FONT.raster.options);
  const bitmapFont = useFont(BITMAP_FONT.input, BITMAP_FONT.raster.technique, BITMAP_FONT.raster.options);
  const viewport = useThree((state) => state.viewport);
  useEffect(() => onReady(), [onReady]);
  return (
    <AnimatedGroup speed={0.8} amount={0.035}>
      <Text
        constraints={{ width: { mode: 'exact', size: viewport.width } }}
        font={slugFont}
        layout={{ align: 'center', wrap: 'none' }}
        position={[-viewport.width / 2, viewport.height / 2 - 1.45, 0]}
        style={{ color: '#f0abfc', fontSize: Math.min(viewport.width * 0.16, 2.2) }}
      >
        Lovers + Quarrel
      </Text>
      <Text
        constraints={{ width: { mode: 'exact', size: viewport.width } }}
        font={msdfFont}
        layout={{ align: 'center', wrap: 'none' }}
        position={[-viewport.width / 2, viewport.height / 2 - 0.45, 0]}
        style={{ color: '#7dd3fc', fontSize: Math.min(viewport.width * 0.075, 0.9) }}
      >
        Geist MSDF subtitle
      </Text>
      <Text
        constraints={{ width: { mode: 'exact', size: viewport.width } }}
        font={bitmapFont}
        layout={{ align: 'center', wrap: 'none' }}
        position={[-viewport.width / 2, viewport.height / 2 + 0.4, 0]}
        style={{ color: '#fbbf24', fontSize: Math.min(viewport.width * 0.045, 0.55) }}
      >
        VT323 bitmap prose keeps the pixels honest.
      </Text>
    </AnimatedGroup>
  );
}

function StylingScene({ onReady }: GlyphSceneProps) {
  const font = useFont(MSDF_FONT.input, MSDF_FONT.raster.technique, MSDF_FONT.raster.options);
  const viewport = useThree((state) => state.viewport);
  useEffect(() => onReady(), [onReady]);
  return (
    <AnimatedGroup speed={1.2} amount={0.05}>
      <Text
        constraints={{ width: { mode: 'exact', size: viewport.width } }}
        font={font}
        layout={{ align: 'center', wrap: 'none' }}
        position={[-viewport.width / 2, viewport.height / 2 - 0.55, 0]}
        style={{ fontSize: Math.min(viewport.width * 0.1, 1.2) }}
      >
        <Text style={{ color: '#f8fafc' }}>styled </Text>
        <Text style={{ color: '#22d3ee' }}>runs </Text>
        <Text style={{ color: '#f472b6' }}>inherit</Text>
      </Text>
    </AnimatedGroup>
  );
}

function PositioningScene({ onReady }: GlyphSceneProps) {
  const font = useFont(MSDF_FONT.input, MSDF_FONT.raster.technique, MSDF_FONT.raster.options);
  const viewport = useThree((state) => state.viewport);
  const group = useRef<Group>(null);
  const elapsed = useRef(0);
  useEffect(() => onReady(), [onReady]);
  useFrame((_state, delta) => {
    elapsed.current += delta;
    if (group.current) group.current.rotation.y = Math.sin(elapsed.current * 0.8) * 0.1;
  });
  return (
    <group ref={group}>
      {(['x', 'y', 'z'] as const).map((axis, index) => (
        <Text
          key={axis}
          font={font}
          position={[-viewport.width * 0.33 + index * viewport.width * 0.27, 0.25 - index * 0.48, 0.1 * index]}
          style={{ color: ['#34d399', '#60a5fa', '#fbbf24'][index]!, fontSize: Math.min(viewport.width * 0.07, 0.8) }}
        >
          {axis}
        </Text>
      ))}
    </group>
  );
}

function ColumnsScene({ onReady }: GlyphSceneProps) {
  const font = useFont(BITMAP_FONT.input, BITMAP_FONT.raster.technique, BITMAP_FONT.raster.options);
  const viewport = useThree((state) => state.viewport);
  const group = useRef<Group>(null);
  const elapsed = useRef(0);
  useEffect(() => onReady(), [onReady]);
  useFrame((_state, delta) => {
    elapsed.current += delta;
    if (group.current) group.current.position.x = Math.sin(elapsed.current * 0.9) * 0.05;
  });
  return (
    <group ref={group}>
      <Text
        constraints={{
          height: { mode: 'exact', size: viewport.height * 0.72 },
          width: { mode: 'exact', size: viewport.width * 0.82 },
        }}
        font={font}
        layout={{ align: 'start', columns: { count: 2, gap: 0.35 }, overflow: 'clip', wrap: 'word' }}
        position={[-viewport.width * 0.41, viewport.height * 0.37, 0]}
        style={{ color: '#fde68a', fontSize: Math.min(viewport.width * 0.038, 0.48), lineHeight: 1.25 }}
      >
        Two columns are one paragraph. The layout engine flows lines through the first column, then continues into the
        second while preserving the same shaping and style rules.
      </Text>
    </group>
  );
}

function FontStackScene({ onReady }: GlyphSceneProps) {
  const latin = useFont(MSDF_FONT.input, MSDF_FONT.raster.technique, MSDF_FONT.raster.options);
  const cjk = useFont(CJK_FONT.input, CJK_FONT.raster.technique, CJK_FONT.raster.options);
  const stack = useMemo(() => createFontStack(latin, cjk), [cjk, latin]);
  const viewport = useThree((state) => state.viewport);
  const group = useRef<Group>(null);
  const elapsed = useRef(0);
  useEffect(() => onReady(), [onReady]);
  useFrame((_state, delta) => {
    elapsed.current += delta;
    if (group.current) group.current.scale.setScalar(1 + Math.sin(elapsed.current * 1.1) * 0.02);
  });
  return (
    <group ref={group}>
      <Text
        constraints={{ width: { mode: 'exact', size: viewport.width } }}
        font={stack}
        layout={{ align: 'center', wrap: 'none' }}
        position={[-viewport.width / 2, viewport.height / 2 - 0.25, 0]}
        style={{ color: '#c4b5fd', fontSize: Math.min(viewport.width * 0.075, 0.9) }}
      >
        glyph 文字 字形
      </Text>
    </group>
  );
}

function IconsScene({ onReady }: GlyphSceneProps) {
  const font = useFont(ICON_FONT.input, ICON_FONT.raster.technique, ICON_FONT.raster.options);
  const viewport = useThree((state) => state.viewport);
  const group = useRef<Group>(null);
  const elapsed = useRef(0);
  useEffect(() => onReady(), [onReady]);
  useFrame((_state, delta) => {
    elapsed.current += delta;
    if (group.current) group.current.rotation.z = Math.sin(elapsed.current * 1.1) * 0.04;
  });
  return (
    <group ref={group}>
      {ICONS.map((icon, index) => (
        <Text
          key={icon}
          font={font}
          position={[-viewport.width * 0.34 + index * viewport.width * 0.17, -0.22, 0]}
          style={{
            color: ['#fb7185', '#f472b6', '#c084fc', '#818cf8', '#38bdf8'][index]!,
            fontSize: Math.min(viewport.width * 0.09, 1.15),
          }}
        >
          {icon}
        </Text>
      ))}
    </group>
  );
}

function EditingScene({ inputs, onReady }: GlyphSceneProps) {
  const font = useFont(MSDF_FONT.input, MSDF_FONT.raster.technique, MSDF_FONT.raster.options);
  const viewport = useThree((state) => state.viewport);
  const canvasSize = useThree((state) => state.size);
  const camera = useThree((state) => state.camera);
  const text = useRef<ThreeText<typeof msdf>>(null);
  const caretMesh = useRef<Mesh>(null);
  const dragging = useRef<number | undefined>(undefined);
  const selectionRef = useRef<readonly [number, number]>([0, 0]);
  const pendingCaretOffset = useRef<number | undefined>(undefined);
  const pendingCaretFrames = useRef(0);
  const blinkElapsed = useRef(0);
  const [value, setValue] = useState('edit glyphs with a caret');
  const [selection, setSelection] = useState<[number, number]>([0, 0]);
  const [caretRect, setCaretRect] = useState({ x: 0, y: 0, width: 0, height: 1 });
  const raycaster = useMemo(() => new Raycaster(), []);
  const plane = useMemo(() => new Plane(), []);
  const ndc = useMemo(() => new Vector2(), []);
  const worldPoint = useMemo(() => new Vector3(), []);
  const planePoint = useMemo(() => new Vector3(), []);
  const planeNormal = useMemo(() => new Vector3(), []);
  const textWidth = viewport.width * 0.84;
  const textPosition = useMemo(
    () => new Vector3(-viewport.width * 0.42, viewport.height * 0.16, 0.2),
    [viewport.height, viewport.width],
  );
  useEffect(() => onReady(), [onReady]);
  const select = useCallback((anchor: number, focus: number) => {
    const next: [number, number] = [anchor, focus];
    selectionRef.current = next;
    setSelection(next);
  }, []);
  useFrame((_state, delta) => {
    const currentText = text.current;
    if (currentText !== null) {
      for (const input of inputs.drain()) {
        if (
          (input.type === 'pointerdown' || input.type === 'pointermove' || input.type === 'pointerup') &&
          input.x !== undefined &&
          input.y !== undefined &&
          (input.type !== 'pointermove' || dragging.current !== undefined)
        ) {
          const local = proxyPointToTextLocal(
            input.x,
            input.y,
            canvasSize.width,
            canvasSize.height,
            camera,
            currentText,
            raycaster,
            plane,
            ndc,
            worldPoint,
            planePoint,
            planeNormal,
          );
          if (local !== undefined) {
            const caret = currentText.caretAt(local.x, -local.y);
            if (caret !== undefined) {
              if (input.type === 'pointerdown') dragging.current = caret.offset;
              const anchor = dragging.current ?? caret.offset;
              select(anchor, caret.offset);
              setCaretRect(caret.rect);
              blinkElapsed.current = 0;
            }
          }
          if (input.type === 'pointerup') dragging.current = undefined;
          continue;
        }
        if (input.type === 'pointercancel') {
          dragging.current = undefined;
          continue;
        }
        if (input.type !== 'keydown' || input.value === undefined) continue;
        const [anchor, focus] = selectionRef.current;
        const left = Math.min(anchor, focus);
        const right = Math.max(anchor, focus);
        if (input.value === 'ArrowLeft' || input.value === 'ArrowRight') {
          const direction = input.value === 'ArrowLeft' ? -1 : 1;
          const offset = Math.max(0, Math.min(value.length, (direction < 0 ? left : right) + direction));
          select(offset, offset);
          pendingCaretOffset.current = offset;
          pendingCaretFrames.current = 1;
        } else if (input.value === 'Backspace') {
          const start = left === right ? Math.max(0, left - 1) : left;
          setValue((current) => current.slice(0, start) + current.slice(right));
          select(start, start);
          pendingCaretOffset.current = start;
          pendingCaretFrames.current = 1;
        } else if (input.value.length === 1) {
          setValue((current) => current.slice(0, left) + input.value + current.slice(right));
          const offset = left + input.value.length;
          select(offset, offset);
          pendingCaretOffset.current = offset;
          pendingCaretFrames.current = 1;
        }
        blinkElapsed.current = 0;
      }
      if (pendingCaretOffset.current !== undefined) {
        if (pendingCaretFrames.current > 0) {
          pendingCaretFrames.current -= 1;
        } else {
          const next = caretRectAtOffset(currentText, pendingCaretOffset.current, value.length);
          if (next !== undefined) {
            setCaretRect(next);
            pendingCaretOffset.current = undefined;
          }
        }
      }
    } else {
      inputs.drain();
    }
    blinkElapsed.current += delta;
    if (caretMesh.current) caretMesh.current.visible = Math.floor(blinkElapsed.current / 0.5) % 2 === 0;
  });
  const selectionRects = text.current?.selectionRects(selection[0], selection[1]) ?? [];
  return (
    <group position={textPosition}>
      {selectionRects.map((rect, index) => (
        <mesh key={index} position={[rect.x + rect.width / 2, -rect.y - rect.height / 2, 0.1]}>
          <planeGeometry args={[rect.width, rect.height]} />
          <meshBasicMaterial color="#38bdf8" depthWrite={false} opacity={0.25} transparent />
        </mesh>
      ))}
      <Text
        ref={text}
        constraints={{ width: { mode: 'exact', size: textWidth } }}
        font={font}
        layout={{ align: 'start', wrap: 'none' }}
        style={{ color: '#e0f2fe', fontSize: Math.min(viewport.width * 0.075, 0.9) }}
      >
        {value}
      </Text>
      <mesh ref={caretMesh} position={[caretRect.x, -caretRect.y - caretRect.height / 2, 0.25]}>
        <planeGeometry args={[Math.max(viewport.width * 0.0025, 0.015), caretRect.height]} />
        <meshBasicMaterial color="#f8fafc" depthWrite={false} />
      </mesh>
    </group>
  );
}

function proxyPointToTextLocal<Technique extends AnyRasterTechnique>(
  x: number,
  y: number,
  width: number,
  height: number,
  camera: Parameters<Raycaster['setFromCamera']>[1],
  text: ThreeText<Technique>,
  raycaster: Raycaster,
  plane: Plane,
  ndc: Vector2,
  worldPoint: Vector3,
  planePoint: Vector3,
  planeNormal: Vector3,
): Vector3 | undefined {
  text.updateWorldMatrix(true, false);
  setProxyPointNdc(ndc, x, y, width, height);
  raycaster.setFromCamera(ndc, camera);
  text.getWorldPosition(planePoint);
  text.getWorldQuaternion(_editingQuaternion);
  planeNormal.set(0, 0, 1).applyQuaternion(_editingQuaternion);
  plane.setFromNormalAndCoplanarPoint(planeNormal, planePoint);
  if (raycaster.ray.intersectPlane(plane, worldPoint) === null) return undefined;
  return text.worldToLocal(worldPoint);
}

function caretRectAtOffset<Technique extends AnyRasterTechnique>(
  text: ThreeText<Technique>,
  offset: number,
  length: number,
) {
  if (offset <= 0) return text.caretAt(-1_000_000, 0)?.rect;
  if (offset >= length) return text.caretAt(1_000_000, 0)?.rect;
  const rect = text.selectionRects(offset - 1, offset)?.at(-1);
  return rect === undefined ? undefined : { ...rect, x: rect.x + rect.width, width: 0 };
}

const _editingQuaternion = new Quaternion();

/** Standalone glyph-physics scene used by both the docs proxy and the direct-canvas diagnostic. */
export function GlyphPhysicsScene({ inputs, onReady }: GlyphSceneProps) {
  const titleFont = useFont(MSDF_FONT.input, MSDF_FONT.raster.technique, MSDF_FONT.raster.options);
  const paragraphFont = useFont(BITMAP_FONT.input, BITMAP_FONT.raster.technique, BITMAP_FONT.raster.options);
  const viewport = useThree((state) => state.viewport);
  const canvasSize = useThree((state) => state.size);
  const camera = useThree((state) => state.camera);
  const renderPixelRatio = useThree((state) => state.gl.getPixelRatio());
  const worldUnitsPerPixel = viewport.height / canvasSize.height;
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
  useEffect(() => {
    onReady();
  }, [onReady]);
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
    const createWall = (position: Vector3, halfExtents: [number, number, number]) => {
      const bodyDefinition = box3d.b3DefaultBodyDef();
      bodyDefinition.type = box3d.b3BodyType.b3_staticBody;
      bodyDefinition.position = [position.x, position.y, position.z];
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
        position={[
          -viewport.width / 2,
          viewport.height * 0.36 + (PHYSICS_TITLE_OFFSET_PX * viewport.height) / canvasSize.height,
          0,
        ]}
        style={{ color: '#22d3ee', fontSize: Math.min(viewport.width * 0.105, 1.3) }}
      >
        Glyph Physics
      </Text>
      <Text
        ref={paragraphText}
        constraints={{
          height: { mode: 'exact', size: viewport.height * 0.58 },
          width: { mode: 'exact', size: viewport.width * 0.72 },
        }}
        font={paragraphFont}
        layout={{ align: 'justify', wrap: 'word' }}
        position={[-viewport.width * 0.36, viewport.height * 0.04, 0]}
        rasterPixelRatio={renderPixelRatio / worldUnitsPerPixel}
        style={{
          color: '#bae6fd',
          fontSize: PHYSICS_PARAGRAPH_STRIKE_PPEM * worldUnitsPerPixel,
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

const SCENES: Record<string, ComponentType<GlyphSceneProps>> = {
  glyph: IntroductionScene,
  shaping: IntroductionScene,
  techniques: TechniqueScene,
  styling: StylingScene,
  positioning: PositioningScene,
  columns: ColumnsScene,
  'font-stack': FontStackScene,
  icons: IconsScene,
  editing: EditingScene,
  physics: GlyphPhysicsScene,
};

export class GlyphIntroductionRootElement extends GlyphOffscreenRootElement {
  protected createScene(props: GlyphSceneProps) {
    const Scene = SCENES[props.scene] ?? IntroductionScene;
    return <Scene {...props} />;
  }
}

defineGlyphRoot('glyph-introduction-root', GlyphIntroductionRootElement);
