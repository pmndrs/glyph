import { Text, TextGroup, useMsdf } from '@pmndrs/glyph/react';
import type { Glyphs, Text as ThreeText } from '@pmndrs/glyph/three';
import { useFrame, useThree } from '@react-three/fiber/webgpu';
import { useEffect, useRef, useState } from 'react';
import { Box3, Color, Matrix4, Vector3, type Group, type Mesh } from 'three/webgpu';

import fontUrl from '../assets/inter-latin.font.glb?url';
import {
  FONT_SIZE,
  createJugglerWorld,
  figure,
  placeLetter,
  removeLetter,
  resizeJugglerWorld,
  stepJugglerWorld,
  typeLetter,
  type JugglerWorld,
  type Letter,
  type Side,
} from './juggler.js';

const PALETTE = ['#f59e0b', '#fb7185', '#ff4dc4', '#60a5fa', '#34d399', '#fde047', '#c084fc'] as const;
const INK = '#f4f7ff';
/** Red-hot to white: a freshly typed letter walks these stops over `COOL_SECONDS`. */
const HEAT = ['#ff2d1a', '#ff6a1f', '#ffb347', '#ffe9c4', INK] as const;
const COOL_SECONDS = 1.8;
/** After cooling, the overlay letter yields to the paragraph's own white glyph over this long. */
const HANDOVER_SECONDS = 0.25;
/** A released letter takes this long to pick up its colour. */
const TINT_SECONDS = 0.5;
const PARAGRAPH_MARGIN = 48;
const PARAGRAPH_MAX_WIDTH = 960;
const LINE_HEIGHT = 1.25;
/** The sentence's source paragraph is kept far below the view; only its broken-apart copy is drawn. */
const OFFSCREEN_Y = -100_000;
/** Longest simulated step, so a background tab does not fling every letter through the floor on return. */
const MAX_STEP = 1 / 20;

useMsdf.preload(fontUrl);

export function App() {
  const font = useMsdf(fontUrl);
  const viewport = useThree((state) => state.viewport);
  const [world] = useState(() => createJugglerWorld(viewport.width, viewport.height));
  const [sentence, setSentence] = useState('');
  const [letters, setLetters] = useState<readonly Letter[]>([]);
  /** The typed text, mutated in the key handler rather than in a state updater so the world changes exactly once per key. */
  const typed = useRef('');

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const current = typed.current;
      if (event.key === 'Backspace') {
        if (current.length === 0) return;
        removeLetter(world, current.length - 1);
        typed.current = current.slice(0, -1);
      } else if (event.key.length === 1 && event.key >= ' ' && event.key <= '~') {
        if (event.key !== ' ') typeLetter(world, event.key, current.length);
        typed.current = current + event.key;
      } else return;
      event.preventDefault();
      setSentence(typed.current);
      setLetters([...world.letters]);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [world]);

  useFrame(
    (state, delta) => {
      const { width, height } = state.viewport;
      if (world.width !== width || world.height !== height) resizeJugglerWorld(world, width, height);
      stepJugglerWorld(world, Math.min(delta, MAX_STEP));
    },
    { id: 'juggler-simulation', phase: 'physics' },
  );

  const body = figure(viewport.height);
  const paragraphWidth = Math.min(viewport.width - 2 * PARAGRAPH_MARGIN, PARAGRAPH_MAX_WIDTH);

  return (
    <>
      <StickFigure world={world} />
      <mesh position={[0, body.floorY - 3, -1]} scale={[viewport.width, 1, 1]}>
        <planeGeometry args={[1, 2]} />
        <meshBasicNodeMaterial color="#293244" />
      </mesh>
      <Sentence font={font} sentence={sentence} width={paragraphWidth} world={world} />
      <TextGroup name="letters">
        {letters.map((letter) => (
          <LetterView font={font} key={letter.id} letter={letter} />
        ))}
      </TextGroup>
    </>
  );
}

type Font = ReturnType<typeof useMsdf>;

interface SentenceProps {
  readonly font: Font;
  readonly sentence: string;
  readonly width: number;
  readonly world: JugglerWorld;
}

/**
 * The typed sentence is one shaped paragraph, so kerning and word spacing are the engine's. The paragraph itself
 * lives off screen; each committed layout is broken apart into per-glyph copies drawn at the top of the view, which
 * lets a single glyph hide when its letter is hot or has left, while every other glyph keeps its shaped position.
 */
function Sentence({ font, sentence, width, world }: SentenceProps) {
  const source = useRef<ThreeText<never> | null>(null);
  const anchor = useRef<Group | null>(null);
  const copies = useRef<Glyphs | undefined>(undefined);
  const revision = useRef(-1);
  /** Glyph index by UTF-16 offset in the sentence, with the ink centre in paragraph space. */
  const glyphs = useRef(new Map<number, { readonly index: number; readonly x: number; readonly y: number }>());
  const shown = useRef<boolean[]>([]);
  const kick = useRef(0);
  const releases = useRef(0);
  const matrix = useRef(new Matrix4());
  const center = useRef(new Vector3());

  useEffect(
    () => () => {
      copies.current?.dispose();
      copies.current = undefined;
    },
    [],
  );

  useFrame((_, delta) => {
    const text = source.current;
    const group = anchor.current;
    if (text === null || group === null) return;
    const state = text.commitState();
    if (state.status === 'committed' && state.revision !== revision.current) {
      revision.current = state.revision;
      copies.current?.dispose();
      copies.current = undefined;
      glyphs.current.clear();
      shown.current = [];
      if (text.computeBoundingBox().max.x > text.computeBoundingBox().min.x) {
        const [broken, decorations] = text.breakApart();
        decorations?.dispose();
        broken.position.set(0, 0, 0);
        group.add(broken);
        copies.current = broken;
        for (const measurement of broken.measurements) {
          const glyph = broken.glyphAt(measurement.index);
          if (glyph === undefined || measurement.localInkBounds.isEmpty()) continue;
          measurement.localInkBounds.getCenter(center.current);
          glyphs.current.set(glyph.cluster, { index: measurement.index, x: center.current.x, y: center.current.y });
          shown.current[measurement.index] = true;
        }
      }
    }

    const broken = copies.current;
    if (broken === undefined) return;
    if (world.releases !== releases.current) {
      releases.current = world.releases;
      kick.current = 7;
    }
    kick.current *= Math.exp(-12 * delta);
    group.position.y = paragraphTop(world.height) + kick.current;

    // Waiting letters sit on their glyphs; a glyph shows only once its letter has cooled and until it leaves.
    const visible = new Set<number>();
    for (const letter of world.letters) {
      const glyph = glyphs.current.get(letter.index);
      if (glyph === undefined) continue;
      if (letter.state === 'queued') {
        placeLetter(world, letter.index, group.position.x + glyph.x, group.position.y + glyph.y);
        if (letter.age >= COOL_SECONDS + HANDOVER_SECONDS) visible.add(glyph.index);
      }
    }
    for (const { index, x, y } of glyphs.current.values()) {
      const show = visible.has(index);
      if (shown.current[index] === show) continue;
      shown.current[index] = show;
      matrix.current.makeScale(show ? 1 : 0, show ? 1 : 0, 1);
      matrix.current.setPosition(x, y, 0);
      broken.setMatrixAt(index, matrix.current);
    }
  });

  return (
    <>
      <group position={[-width / 2, paragraphTop(world.height), 0]} ref={anchor} />
      <Text
        constraints={{ width: { mode: 'exact', size: width } }}
        font={font}
        layout={{ align: 'center', wrap: 'word' }}
        position={[-width / 2, OFFSCREEN_Y, 0]}
        ref={source}
        style={{ color: INK, fontSize: FONT_SIZE, lineHeight: LINE_HEIGHT }}
      >
        {sentence}
      </Text>
    </>
  );
}

function paragraphTop(height: number): number {
  return figure(height).topY + FONT_SIZE * 0.5;
}

interface LetterViewProps {
  readonly font: Font;
  readonly letter: Letter;
}

/**
 * One glyph that follows its letter. While the letter waits in the sentence it is the red-hot overlay on the
 * paragraph glyph's spot; once released it is the letter itself, picking up its colour as it falls.
 */
function LetterView({ font, letter }: LetterViewProps) {
  const group = useRef<Group | null>(null);
  const text = useRef<ThreeText<never> | null>(null);
  const centered = useRef(false);
  const applied = useRef('');
  const ink = useRef(new Box3());
  const center = useRef(new Vector3());
  const tint = PALETTE[letter.id % PALETTE.length] ?? INK;

  useFrame(() => {
    const view = group.current;
    const glyph = text.current;
    if (view === null || glyph === null) return;

    if (!centered.current && glyph.commitState().status === 'committed') {
      ink.current.copy(glyph.computeBoundingBox());
      if (ink.current.max.x > ink.current.min.x) {
        ink.current.getCenter(center.current);
        glyph.position.set(-center.current.x, -center.current.y, 0);
        centered.current = true;
      }
    }

    view.position.set(letter.x, letter.y, 0);
    view.rotation.z = letter.rotation;
    const boing = letter.released >= 0 ? 0.28 * Math.exp(-7 * letter.released) * Math.sin(22 * letter.released) : 0;
    view.scale.set(1 + boing, 1 - boing, 1);

    let color: string;
    let opacity: number;
    if (letter.released < 0) {
      color = heat(letter.age);
      opacity = letter.placed ? 1 - clamp((letter.age - COOL_SECONDS) / HANDOVER_SECONDS, 0, 1) : 0;
    } else {
      color = mix(INK, tint, clamp(letter.released / TINT_SECONDS, 0, 1));
      opacity = 1;
    }
    const key = `${color}/${opacity.toFixed(3)}`;
    if (key === applied.current) return;
    applied.current = key;
    glyph.style = { color, fontSize: FONT_SIZE, lineHeight: 1, opacity };
  });

  return (
    <group ref={group} visible={letter.placed || letter.released >= 0}>
      <Text font={font} ref={text} style={{ color: HEAT[0], fontSize: FONT_SIZE, lineHeight: 1, opacity: 0 }}>
        {letter.char}
      </Text>
    </group>
  );
}

const scratchA = new Color();
const scratchB = new Color();

/** Colour of a typed letter `age` seconds after it appeared. */
function heat(age: number): string {
  const position = clamp(age / COOL_SECONDS, 0, 1) * (HEAT.length - 1);
  const stop = Math.min(Math.floor(position), HEAT.length - 2);
  return mix(HEAT[stop] ?? INK, HEAT[stop + 1] ?? INK, position - stop);
}

function mix(from: string, to: string, amount: number): string {
  scratchA.set(from);
  scratchB.set(to);
  return `#${scratchA.lerp(scratchB, amount).getHexString()}`;
}

type Limb =
  | 'torso'
  | 'leftUpperArm'
  | 'leftForearm'
  | 'rightUpperArm'
  | 'rightForearm'
  | 'leftThigh'
  | 'leftShin'
  | 'rightThigh'
  | 'rightShin';
type Joint = 'head' | 'leftHand' | 'rightHand' | 'leftKnee' | 'rightKnee' | 'leftElbow' | 'rightElbow';

const LIMBS: readonly Limb[] = [
  'torso',
  'leftUpperArm',
  'leftForearm',
  'rightUpperArm',
  'rightForearm',
  'leftThigh',
  'leftShin',
  'rightThigh',
  'rightShin',
];
const JOINTS: readonly Joint[] = ['head', 'leftHand', 'rightHand', 'leftKnee', 'rightKnee', 'leftElbow', 'rightElbow'];
const LIMB_THICKNESS = 5;
const ARM_SEGMENT = 36;
const LEG_SEGMENT = 34;
const SIDES: readonly Side[] = ['left', 'right'];

/** A stick figure posed every frame from the simulation: two-bone arms reach the hands, legs stride with the body. */
function StickFigure({ world }: { readonly world: JugglerWorld }) {
  const parts = useRef(new Map<Limb | Joint, Mesh>());
  /** Eased body velocity so lean and stride do not flicker with the chase steps. */
  const eased = useRef(0);

  useFrame((_, delta) => {
    const { juggler } = world;
    const body = figure(world.height);
    const part = (name: Limb | Joint) => parts.current.get(name);
    eased.current += (juggler.vx - eased.current) * (1 - Math.exp(-10 * delta));
    const velocity = eased.current;
    const lean = clamp(velocity * 0.014, -18, 18);
    const running = clamp(Math.abs(velocity) / 700, 0, 1);
    const forward = Math.abs(velocity) > 40 ? Math.sign(velocity) : 0;

    const hipX = juggler.x;
    const shoulderX = hipX + lean;
    poseLimb(part('torso'), hipX, body.hipY, shoulderX, body.shoulderY);
    poseJoint(part('head'), shoulderX + lean * 0.4, body.headY);

    for (const [index, side] of SIDES.entries()) {
      const sign = side === 'left' ? -1 : 1;
      const hand = juggler.hands[side];
      const sx = shoulderX + sign * 8;
      // Elbows hang below a low hand and point outward under a raised one.
      const elbow =
        hand.y > body.shoulderY
          ? bend(sx, body.shoulderY, hand.x, hand.y, ARM_SEGMENT, sign, 0.2)
          : bend(sx, body.shoulderY, hand.x, hand.y, ARM_SEGMENT, sign * 0.4, -1);
      poseLimb(part(side === 'left' ? 'leftUpperArm' : 'rightUpperArm'), sx, body.shoulderY, elbow[0], elbow[1]);
      poseLimb(part(side === 'left' ? 'leftForearm' : 'rightForearm'), elbow[0], elbow[1], hand.x, hand.y);
      poseJoint(part(side === 'left' ? 'leftElbow' : 'rightElbow'), elbow[0], elbow[1]);
      poseJoint(part(side === 'left' ? 'leftHand' : 'rightHand'), hand.x, hand.y);

      const phase = juggler.stride / 28 + index * Math.PI;
      const footX = hipX + sign * 14 + Math.sin(phase) * 22 * running * (forward || 1);
      const footY = body.floorY + Math.max(0, Math.cos(phase)) * 16 * running;
      const knee = bend(hipX, body.hipY, footX, footY, LEG_SEGMENT, forward || sign, 0.2);
      poseLimb(part(side === 'left' ? 'leftThigh' : 'rightThigh'), hipX, body.hipY, knee[0], knee[1]);
      poseLimb(part(side === 'left' ? 'leftShin' : 'rightShin'), knee[0], knee[1], footX, footY);
      poseJoint(part(side === 'left' ? 'leftKnee' : 'rightKnee'), knee[0], knee[1]);
    }
  });

  const register = (name: Limb | Joint) => (mesh: Mesh | null) => {
    if (mesh === null) parts.current.delete(name);
    else parts.current.set(name, mesh);
  };

  return (
    <group name="juggler">
      {LIMBS.map((name) => (
        <mesh key={name} ref={register(name)}>
          <planeGeometry args={[1, LIMB_THICKNESS]} />
          <meshBasicNodeMaterial color={INK} />
        </mesh>
      ))}
      {JOINTS.map((name) => (
        <mesh key={name} ref={register(name)}>
          <circleGeometry args={[name === 'head' ? figure(world.height).headRadius : LIMB_THICKNESS / 2, 32]} />
          <meshBasicNodeMaterial color={INK} />
        </mesh>
      ))}
    </group>
  );
}

/** Stretches a unit-length plane between two points. */
function poseLimb(mesh: Mesh | undefined, ax: number, ay: number, bx: number, by: number): void {
  if (mesh === undefined) return;
  const dx = bx - ax;
  const dy = by - ay;
  mesh.position.set((ax + bx) / 2, (ay + by) / 2, 0);
  mesh.rotation.z = Math.atan2(dy, dx);
  mesh.scale.x = Math.max(Math.hypot(dx, dy), 0.001);
}

function poseJoint(mesh: Mesh | undefined, x: number, y: number): void {
  mesh?.position.set(x, y, 0);
}

/**
 * Two-bone inverse kinematics: the middle joint of two equal segments joining `a` to `b`, bending toward the
 * preferred direction. When the target is out of reach the joint sits on the line and the limb stretches.
 */
function bend(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  segment: number,
  preferX: number,
  preferY: number,
): readonly [number, number] {
  const dx = bx - ax;
  const dy = by - ay;
  const distance = Math.hypot(dx, dy);
  const midX = (ax + bx) / 2;
  const midY = (ay + by) / 2;
  if (distance >= 2 * segment || distance === 0) return [midX, midY];
  const height = Math.sqrt(segment * segment - (distance / 2) * (distance / 2));
  const px = (-dy / distance) * height;
  const py = (dx / distance) * height;
  const toward = px * preferX + py * preferY >= 0 ? 1 : -1;
  return [midX + px * toward, midY + py * toward];
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}
