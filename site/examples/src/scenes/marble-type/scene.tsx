import type { GlyphLayoutInspection } from '@pmndrs/glyph';
import { Text } from '@pmndrs/glyph/react';
import { useMsdf } from '@pmndrs/glyph/react/msdf';
import type { Text as ThreeText } from '@pmndrs/glyph/three';
import type { msdf } from '@pmndrs/glyph/raster/msdf';
import { useFrame } from '@react-three/fiber/webgpu';
import { useEffect, useMemo, useRef, useState } from 'react';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import {
  BufferGeometry,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Group,
  LineBasicNodeMaterial,
  LineSegments,
  MathUtils,
} from 'three/webgpu';

import { INTER } from '../../fonts';
import { useSceneInputs } from '../../lib/inputs';
import { PAPER_DIM } from '../../theme';
import { AUTO_PHRASE, CRACKS, SLAB, STAMP, TEXT } from './config';
import { editLine, isPrintableKey, stampProgress, writeCrack, type EditableLine } from './helpers';
import { engravedInk, marbleMaterial } from './materials';

interface PendingStamp {
  readonly next: EditableLine;
  readonly offset: number;
  readonly previousTargetRevision: number;
  readonly seed: number;
  startedAt: number | undefined;
  targetX: number;
}

const INITIAL_LINE: EditableLine = { text: '', caret: 0 };
const FLOATS_PER_IMPACT = CRACKS.branches * CRACKS.segmentsPerBranch * 2 * 3;

/** Find a cluster edge in the committed paragraph without assuming one JS character is one glyph. */
function caretX(layout: GlyphLayoutInspection | undefined, offset: number): number {
  if (layout === undefined || layout.glyphCount === 0 || offset <= 0) return 0;
  for (let glyph = 0; glyph < layout.glyphCount; glyph += 1) {
    if ((layout.clusters[glyph] ?? 0) >= offset) return layout.x[glyph] ?? 0;
  }
  const last = layout.glyphCount - 1;
  return (layout.x[last] ?? 0) + (layout.glyphAdvances[last] ?? 0);
}

function createCracks(): {
  readonly object: LineSegments;
  readonly geometry: BufferGeometry;
  readonly material: LineBasicNodeMaterial;
  readonly positions: Float32Array;
} {
  const positions = new Float32Array(CRACKS.maxImpacts * FLOATS_PER_IMPACT);
  const position = new Float32BufferAttribute(positions, 3);
  position.setUsage(DynamicDrawUsage);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', position);
  geometry.setDrawRange(0, 0);
  const material = new LineBasicNodeMaterial({ color: '#111318', transparent: true, opacity: 0.72 });
  return { object: new LineSegments(geometry, material), geometry, material, positions };
}

/**
 * A live line of Glyph text stamped into procedural marble. The host's ordered
 * input stream is drained inside the frame, while all hot-path visuals mutate
 * retained Three objects and one preallocated crack buffer.
 */
export default function MarbleType() {
  const inter = useMsdf(INTER);
  const inputs = useSceneInputs();
  const text = useRef<ThreeText<typeof msdf>>(null);
  const targetText = useRef<ThreeText<typeof msdf>>(null);
  const stamp = useRef<Group>(null);
  const rig = useRef<Group>(null);
  const [line, setLine] = useState<EditableLine>(INITIAL_LINE);
  const [targetLine, setTargetLine] = useState<EditableLine>(INITIAL_LINE);
  const [pendingCharacter, setPendingCharacter] = useState('');
  const [isInteractive, setIsInteractive] = useState(false);
  const [cursorX, setCursorX] = useState(0);
  const lineRef = useRef<EditableLine>(INITIAL_LINE);
  const pending = useRef<PendingStamp | undefined>(undefined);
  const keyQueue = useRef<string[]>([]);
  const interactive = useRef(false);
  const autoIndex = useRef(0);
  const sceneStartedAt = useRef<number | undefined>(undefined);
  const shakeStartedAt = useRef<number | undefined>(undefined);
  const impactCount = useRef(0);
  const cursorXRef = useRef(0);
  const cracks = useMemo(() => createCracks(), []);
  const stone = useMemo(() => marbleMaterial(), []);
  const slabGeometry = useMemo(() => new RoundedBoxGeometry(SLAB.width, SLAB.height, SLAB.depth, 5, SLAB.radius), []);

  useEffect(
    () => () => {
      cracks.geometry.dispose();
      cracks.material.dispose();
      slabGeometry.dispose();
      stone.dispose();
    },
    [cracks, slabGeometry, stone],
  );

  const publish = (next: EditableLine): void => {
    lineRef.current = next;
    setLine(next);
    setTargetLine(next);
  };

  const beginStamp = (key: string): void => {
    const before = lineRef.current;
    const next = editLine(before, key, TEXT.maxLength);
    if (next === before || next.text === before.text) {
      if (next !== before) publish(next);
      return;
    }
    if (!isPrintableKey(key)) {
      publish(next);
      return;
    }
    if (key === ' ') {
      publish(next);
      return;
    }
    const targetState = targetText.current?.commitState();
    setTargetLine(next);
    pending.current = {
      next,
      offset: before.caret,
      previousTargetRevision: targetState?.status === 'committed' ? targetState.revision : -1,
      seed: impactCount.current + (key.codePointAt(0) ?? 0),
      startedAt: undefined,
      targetX: 0,
    };
    setPendingCharacter(key);
    if (stamp.current !== null) stamp.current.visible = false;
  };

  useFrame(({ elapsed }) => {
    sceneStartedAt.current ??= elapsed;
    const localElapsed = elapsed - sceneStartedAt.current;

    for (const input of inputs?.drain() ?? []) {
      if (input.type === 'pointerdown') {
        interactive.current = true;
        setIsInteractive(true);
      }
      if (input.type === 'keydown' && input.value !== undefined) {
        interactive.current = true;
        setIsInteractive(true);
        keyQueue.current.push(input.value);
      }
    }

    if (!interactive.current && pending.current === undefined && autoIndex.current < AUTO_PHRASE.length) {
      const due = STAMP.autoDelay + autoIndex.current * STAMP.autoInterval;
      if (localElapsed >= due) {
        keyQueue.current.push(AUTO_PHRASE[autoIndex.current] ?? '');
        autoIndex.current += 1;
      }
    }
    if (pending.current === undefined) {
      const key = keyQueue.current.shift();
      if (key !== undefined) beginStamp(key);
    }

    const active = pending.current;
    const stampObject = stamp.current;
    if (active !== undefined && stampObject !== null) {
      const layout = targetText.current?.glyphs();
      const targetState = targetText.current?.commitState();
      if (
        active.startedAt === undefined &&
        layout !== undefined &&
        targetState?.status === 'committed' &&
        targetState.revision > active.previousTargetRevision
      ) {
        active.targetX = caretX(layout, active.offset);
        active.startedAt = elapsed;
        stampObject.visible = true;
      }
      if (active.startedAt !== undefined) {
        const progress = stampProgress(elapsed - active.startedAt, STAMP.duration);
        const scale = MathUtils.lerp(STAMP.startScale, 1, progress);
        stampObject.position.set(
          TEXT.x + active.targetX,
          TEXT.y,
          MathUtils.lerp(STAMP.startDepth, STAMP.surfaceDepth, progress),
        );
        stampObject.scale.setScalar(scale);
        if (progress >= 1) {
          const slot = impactCount.current % CRACKS.maxImpacts;
          const start = slot * FLOATS_PER_IMPACT;
          writeCrack(
            cracks.positions,
            start,
            TEXT.x + active.targetX + TEXT.fontSize * 0.28,
            TEXT.y - 0.38,
            CRACKS.depth,
            active.seed,
          );
          const attribute = cracks.object.geometry.getAttribute('position');
          attribute.needsUpdate = true;
          impactCount.current += 1;
          cracks.object.geometry.setDrawRange(
            0,
            (Math.min(impactCount.current, CRACKS.maxImpacts) * FLOATS_PER_IMPACT) / 3,
          );
          shakeStartedAt.current = elapsed;
          publish(active.next);
          pending.current = undefined;
          stampObject.visible = false;
          setPendingCharacter('');
        }
      }
    }

    const rigObject = rig.current;
    if (rigObject !== null) {
      const shakeAge = shakeStartedAt.current === undefined ? STAMP.shakeDuration : elapsed - shakeStartedAt.current;
      const envelope = Math.max(0, 1 - shakeAge / STAMP.shakeDuration);
      rigObject.position.set(
        Math.sin(shakeAge * 145) * 0.045 * envelope,
        Math.sin(shakeAge * 111) * 0.025 * envelope,
        0,
      );
    }

    const nextCursorX = caretX(text.current?.glyphs(), lineRef.current.caret);
    if (Math.abs(nextCursorX - cursorXRef.current) > 1e-4) {
      cursorXRef.current = nextCursorX;
      setCursorX(nextCursorX);
    }
  });

  const status = isInteractive ? 'EDIT MODE  ·  TYPE, DELETE, MOVE THE CARET' : 'AUTO TYPE  ·  CLICK, THEN TYPE';
  return (
    <group ref={rig} rotation={[-0.08, 0.045, 0]}>
      <hemisphereLight args={['#eef4ff', '#2b2422', 1.25]} />
      <directionalLight
        color="#fff1da"
        intensity={4.6}
        position={[-4, 6, 7]}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0004}
      />
      <pointLight color="#91b8ff" intensity={3.5} distance={12} position={[4.5, -2, 4]} />

      <mesh position={[0, 0, 0]} geometry={slabGeometry} material={stone} castShadow receiveShadow />
      <mesh position={[0.18, -0.18, -0.42]} receiveShadow>
        <planeGeometry args={[11.5, 7.2]} />
        <meshStandardNodeMaterial color="#17191d" roughness={0.92} />
      </mesh>

      <primitive object={cracks.object} />
      <Text
        ref={text}
        font={inter}
        material={engravedInk}
        style={{ fontSize: TEXT.fontSize, color: '#111318', letterSpacing: 0.025 }}
        layout={{ wrap: 'none' }}
        constraints={{ width: { mode: 'exact', size: TEXT.width } }}
        position={[TEXT.x, TEXT.y, STAMP.surfaceDepth]}
      >
        {line.text || ' '}
      </Text>
      <Text
        ref={targetText}
        visible={false}
        font={inter}
        style={{ fontSize: TEXT.fontSize, color: '#111318', letterSpacing: 0.025 }}
        layout={{ wrap: 'none' }}
        constraints={{ width: { mode: 'exact', size: TEXT.width } }}
        position={[TEXT.x, TEXT.y, STAMP.surfaceDepth]}
      >
        {targetLine.text || ' '}
      </Text>

      <group ref={stamp} visible={false}>
        <Text
          font={inter}
          style={{ fontSize: TEXT.fontSize, color: '#f7e8ba' }}
          layout={{ wrap: 'none' }}
          position={[0, 0, 0]}
        >
          {pendingCharacter || ' '}
        </Text>
      </group>

      <mesh position={[TEXT.x + cursorX, TEXT.y - 0.43, STAMP.surfaceDepth + 0.012]}>
        <planeGeometry args={[0.035, TEXT.fontSize * 1.15]} />
        <meshBasicNodeMaterial color="#c89b55" />
      </mesh>
      <Text
        font={inter}
        style={{ fontSize: 0.24, color: PAPER_DIM, letterSpacing: 0.035 }}
        layout={{ align: 'center', wrap: 'none' }}
        constraints={{ width: { mode: 'exact', size: 8.5 } }}
        position={[-4.25, -1.45, STAMP.surfaceDepth + 0.01]}
      >
        {status}
      </Text>
    </group>
  );
}
