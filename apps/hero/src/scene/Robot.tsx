import { Text } from '@pmndrs/glyph/react';
import type { Text as ThreeText } from '@pmndrs/glyph/three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { useGLTF } from '@react-three/drei/webgpu';
import { useFrame } from '@react-three/fiber/webgpu';
import { useEffect, useMemo, useRef } from 'react';
import { exp, float, hash, mix, step as threshold, texture, uniform, uv, vec2, vec3 } from 'three/tsl';
import {
  AnimationMixer,
  type Bone,
  type Group,
  Matrix4,
  type Mesh,
  MeshBasicNodeMaterial,
  type MeshStandardMaterial,
  MeshStandardNodeMaterial,
  type Object3D,
  Quaternion,
  Vector3,
} from 'three/webgpu';

import robotUrl from '../../assets/robot.glb?url';
import type { Faces } from '../fonts';
import { screenInk } from '../materials/screen-ink';
import { setFootprint } from './floor';
import { requestCollapse } from './hole';
import { replayCount } from './replay';
import { latestShockwave } from './shockwave';
import { heroReady, usePreparation } from '../startup';
import { RetainedLine } from './retained-line';

/**
 * A small robot that treats the screen as its floor: it drives in from the bottom left with the camera straight
 * overhead, stops, leans back and turns its face up to the viewer, then drives on and off the top right. It runs once after
 * the page loads and again after every replay of the title, cued from the landing like the feature line is.
 */

/** How tall it stands in world units. The packed model's own root scales its 49.7-unit rig to 2.85. */
const ROBOT_HEIGHT = 3;
const MODEL_HEIGHT = 2.85;
const SCALE = ROBOT_HEIGHT / MODEL_HEIGHT;
/** The packed model's root scale: one rig unit in model units. The face is placed in rig units under its bone. */
const RIG_UNIT = 0.05737;
/** The floor is just in front of the title's glass. */
const FLOOR_Z = 0.04;
/** Its solid on the floor: along the direction of travel, across it, and up. The body is shallow and wide, about
 * 1.35 by 2.14 at ROBOT_HEIGHT, measured from the model; the floor's physics rounds the wide sides off. */
const PUSH_HALF_EXTENTS: readonly [number, number, number] = [0.68, 1.07, ROBOT_HEIGHT / 2];
/** Where it stops to look up: on top of the title, over the Y. The path is laid through this point. */
const STOP: readonly [x: number, y: number] = [-0.4, 0.3];
/** Direction of travel, from the x axis: up and to the right, steeper than the icon drift so the two read apart. */
const HEADING = 0.62;
/** How far past the visible edge it starts and ends, so it never pops into view; covers the meander too. */
const EDGE_MARGIN = 2.6;
/**
 * The meander: two sine waves across the line of travel, so the drive curves instead of ruling a straight line,
 * and the heading turns with it. Phase advances every run, so no two crossings take the same path.
 */
const MEANDER = [
  { amplitude: 0.7, wavelength: 9.5 },
  { amplitude: 0.22, wavelength: 3.1 },
] as const;
const PHASE_STEP = 2.4;

/** Seconds after the page loads before the first run, and after the title lands before a replay's run. */
const FIRST_RUN_DELAY = 1.6;
const REPLAY_DELAY = 1.4;
/** Timeline, in seconds from the start of a run. */
const ARRIVE_AT = 2.6;
const LOOK_UP_AT = 2.9;
const LOOK_UP_SECONDS = 0.55;
const LOOK_DOWN_AT = 5.3;
const LOOK_DOWN_SECONDS = 0.4;
const LEAVE_AT = 5.75;
const RUN_SECONDS = 7.6;
/** Where on its way out the robot counts as gone: this far inside the visible edge, its body just starting to
 * cross it, so the hole is already open by the time it has left. */
const BODY_REACH = -0.8;
/** How far the whole body rocks back on its wheels, and how far the head tilts on top of that. */
const LEAN = 0.34;
const HEAD_TILT = 0.62;
/** The face screen is skinned to this joint, so tilting it is what turns the face up. */
const HEAD_JOINT = 'Bip001_Spine1_03';
const CLIP = 'Take 001';
/** The face screen's mesh, whose surface the display text borrows. */
const FACE_MESH = 'Object_9';
/**
 * The display, in the head joint's own frame, measured from the model: the screen spans x 2..19.9 (up the face),
 * z -13.6..14.6 (across it) and faces +y. The text is laid on the screen's own axes, as on a television, and
 * tilts with the head: the text's up is the screen's +x (up the face) and its right the screen's +z, with its
 * normal +y, a touch in front of the glass.
 */
const FACE_CENTER = new Vector3(10.96, 8.6, 0.49);
const FACE_BASIS = new Quaternion().setFromRotationMatrix(
  new Matrix4().makeBasis(new Vector3(0, 0, 1), new Vector3(1, 0, 0), new Vector3(0, 1, 0)),
);
/** The display frame in the head joint, in rig units. */
const FACE_LOCAL = new Matrix4().compose(FACE_CENTER, FACE_BASIS, new Vector3().setScalar(1 / (RIG_UNIT * SCALE)));
/** The display's finish under the printed pixels. */
const FACE_FINISH = { roughness: 0.35, metalness: 0.6 };
/** The eyes glitch out over this long before the text starts, and back in over it after the text clears. */
const GLITCH_SECONDS = 0.3;
const GLITCH_BANDS = 36;
const GLITCH_TEAR = 0.06;
/** Anything on the screen brighter than this is the eyes; the panel itself is darker, and this dark. */
const EYE_LEVEL = 0.06;
const PANEL_COLOUR = 0.03;
/** What it prints while it looks up, and how: pixels in the eyes' violet, typed a few a second. */
const FACE_TEXT = 'PMNDRS';
const FACE_FONT_SIZE = 0.26;
const FACE_LETTER_SPACING = 0.09;
const FACE_WIDTH = 1.7;
const FACE_COLOUR = '#a99cff';
/** The happy face holds a moment once it is looking up before the letters take over. */
const TYPE_FROM = LOOK_UP_AT + 1.1;
const TYPE_RATE = 9;
const TYPE_UNTIL = LOOK_DOWN_AT + 0.25;

/** The eyes' glitch: whether they are shown, and how hard the screen is tearing, `now` seconds into a run. */
function eyesAt(now: number): { readonly shown: number; readonly tear: number } {
  const out = (now - (TYPE_FROM - GLITCH_SECONDS)) / GLITCH_SECONDS;
  const back = (now - TYPE_UNTIL) / GLITCH_SECONDS;
  if (out >= 0 && out < 1) return { shown: out < 0.5 ? 1 : 0, tear: 1 - Math.abs(out * 2 - 1) };
  if (back >= 0 && back < 1) return { shown: back < 0.5 ? 0 : 1, tear: 1 - Math.abs(back * 2 - 1) };
  return { shown: now >= TYPE_FROM && now < TYPE_UNTIL ? 0 : 1, tear: 0 };
}

/** Driven each frame: the eyes shown or not, the tear's strength, and a seed that reshuffles the bands. */
const uEyes = uniform(1);
const uTear = uniform(0);
const uSeed = uniform(0);

/**
 * The face screen's own material, rebuilt as a node material so its picture can glitch: while the text prints,
 * the eyes are dropped in horizontal bands that tear sideways and flicker, then come back the same way.
 */
function glitchingScreen(screen: MeshStandardMaterial): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial({
    map: screen.map,
    roughnessMap: screen.roughnessMap,
    metalnessMap: screen.metalnessMap,
    roughness: screen.roughness,
    metalness: screen.metalness,
    emissive: screen.emissive,
    emissiveIntensity: screen.emissiveIntensity,
    envMapIntensity: screen.envMapIntensity,
    side: screen.side,
  });
  if (screen.map === null) return material;
  const at = uv();
  const band = hash(at.y.mul(GLITCH_BANDS).floor().add(uSeed));
  const torn = vec2(at.x.add(band.sub(0.5).mul(uTear).mul(GLITCH_TEAR)), at.y);
  const picture = texture(screen.map, torn).rgb;
  // The eyes are the only thing on the panel brighter than the panel: painting them its colour puts them out.
  const lit = threshold(EYE_LEVEL, picture.r.max(picture.g).max(picture.b));
  const dark = mix(picture, vec3(PANEL_COLOUR), lit);
  const flipped = threshold(band, uTear);
  const eyes = mix(uEyes, float(1).sub(uEyes), flipped);
  material.colorNode = mix(dark, picture, eyes);
  return material;
}

/** Soft contact shadow under the wheels, along and across the line of travel; without it the robot floats. */
const SHADOW_LENGTH = 3.2;
const SHADOW_WIDTH = 2.6;
const shadowMaterial = new MeshBasicNodeMaterial({ color: '#000000', depthWrite: false, transparent: true });
shadowMaterial.opacityNode = exp(uv().sub(0.5).length().mul(3.2).pow(2).negate()).mul(0.32);

useGLTF.preload(robotUrl);

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

function easeInCubic(t: number): number {
  return t ** 3;
}

function easeInOutSine(t: number): number {
  return 0.5 - Math.cos(Math.PI * t) / 2;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

interface Path {
  /** Arc length from the start to the stop, and from the stop to the exit. */
  readonly inward: number;
  readonly outward: number;
  readonly phase: number;
}

interface Pose {
  readonly x: number;
  readonly y: number;
  /** Direction of travel at this point, from the x axis. */
  readonly heading: number;
  /** 0 = looking ahead along the path, 1 = face turned up to the camera. */
  readonly look: number;
}

/** Lays the run through STOP so it starts and ends past the visible edge of a `width` by `height` floor. */
function layPath(width: number, height: number, run: number): Path {
  const [stopX, stopY] = STOP;
  const cos = Math.cos(HEADING);
  const sin = Math.sin(HEADING);
  // In from beyond both the left and the bottom edge; out once beyond the right or the top edge.
  const inward = Math.max((stopX + width / 2 + EDGE_MARGIN) / cos, (stopY + height / 2 + EDGE_MARGIN) / sin);
  const outward = Math.min((width / 2 + EDGE_MARGIN - stopX) / cos, (height / 2 + EDGE_MARGIN - stopY) / sin);
  return { inward, outward, phase: run * PHASE_STEP };
}

/** Sideways offset from the line of travel at arc length `s` from the stop, and its slope. Zero at the stop. */
function meander(s: number, phase: number): { readonly offset: number; readonly slope: number } {
  let offset = 0;
  let slope = 0;
  MEANDER.forEach(({ amplitude, wavelength }, index) => {
    const k = (2 * Math.PI) / wavelength;
    const shift = phase * (index + 1);
    offset += amplitude * (Math.sin(k * s + shift) - Math.sin(shift));
    slope += amplitude * k * Math.cos(k * s + shift);
  });
  return { offset, slope };
}

/** Where the robot is `time` seconds into a run along `path`. */
function poseAt(time: number, path: Path): Pose {
  // Arc length along the line of travel, measured from the stop.
  let s: number;
  if (time < ARRIVE_AT) s = -path.inward * (1 - easeOutCubic(time / ARRIVE_AT));
  else if (time < LEAVE_AT) s = 0;
  else s = path.outward * easeInCubic(clamp01((time - LEAVE_AT) / (RUN_SECONDS - LEAVE_AT)));

  const { offset, slope } = meander(s, path.phase);
  const cos = Math.cos(HEADING);
  const sin = Math.sin(HEADING);
  const x = STOP[0] + cos * s - sin * offset;
  const y = STOP[1] + sin * s + cos * offset;

  let look: number;
  if (time < LOOK_UP_AT) look = 0;
  else if (time < LOOK_DOWN_AT) look = easeInOutSine(clamp01((time - LOOK_UP_AT) / LOOK_UP_SECONDS));
  else look = 1 - easeInOutSine(clamp01((time - LOOK_DOWN_AT) / LOOK_DOWN_SECONDS));
  return { x, y, heading: HEADING + Math.atan(slope), look };
}

/** The wheel axle in world space: across the line of travel, in the floor plane. */
const axle = new Vector3();
const parentWorld = new Quaternion();
const tilt = new Quaternion();
const jointRotation = new Quaternion();

/** Rotates `joint` about a world-space axis through its own origin, on top of whatever the clip posed. */
function tiltJoint(joint: Object3D, worldAxis: Vector3, angle: number): void {
  const parent = joint.parent;
  if (parent === null) return;
  parent.getWorldQuaternion(parentWorld);
  tilt.setFromAxisAngle(worldAxis, angle);
  // parent⁻¹ · tilt · parent: the world rotation expressed in the parent's frame, applied before the joint's own.
  joint.quaternion.premultiply(jointRotation.copy(parentWorld).invert().multiply(tilt).multiply(parentWorld));
}

export function Robot({ faces }: { readonly faces: Faces }) {
  const model = useGLTF(robotUrl);
  const { animations } = model;
  const mover = useRef<Group>(null);
  const body = useRef<Group>(null);
  const { scene, display, screenMaterial } = useMemo(() => {
    const owned = clone(model.scene);
    const screenMesh = owned.getObjectByName(FACE_MESH) as Mesh;
    const original = screenMesh.material as MeshStandardMaterial;
    const material = glitchingScreen(original);
    screenMesh.material = material;
    return { scene: owned, display: screenInk(original, FACE_FINISH), screenMaterial: material };
  }, [model.scene]);
  const mixer = useMemo(() => new AnimationMixer(scene), [scene]);
  const head = useMemo(() => scene.getObjectByName(HEAD_JOINT) as Bone | undefined, [scene]);
  const text = useRef<ThreeText<never> | null>(null);
  const line = useRef<RetainedLine | undefined>(undefined);
  usePreparation('robot', () => line.current !== undefined);
  useEffect(
    () => () => {
      line.current?.dispose();
      line.current = undefined;
      screenMaterial.dispose();
    },
    [screenMaterial],
  );
  /** The display's group: kept in the robot's tree and moved to the head joint each frame. */
  const face = useRef<Group>(null);
  /** Whether this run has already announced the robot leaving the screen. */
  const gone = useRef(false);
  /** Seconds into the current run, or undefined while parked off screen. */
  const time = useRef<number | undefined>(undefined);
  const path = useRef<Path | undefined>(undefined);
  const runs = useRef(0);
  /** `performance.now()` at which the next run starts; undefined until the first frame schedules the first run. */
  const runAt = useRef<number | undefined>(undefined);
  const replay = useRef(replayCount());
  const wave = useRef(latestShockwave()?.id ?? 0);
  /** Development only: a run time to freeze at, so a pose can be inspected. */
  const hold = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    Object.assign(globalThis, {
      heroRobot: {
        run: () => {
          runAt.current = 0;
        },
        hold: (at?: number) => {
          hold.current = at;
          if (at !== undefined) runAt.current = 0;
        },
      },
    });
  }, []);

  useEffect(() => {
    const clip = animations.find((candidate) => candidate.name === CLIP);
    if (clip === undefined) return;
    const action = mixer.clipAction(clip);
    action.play();
    return () => {
      action.stop();
      mixer.uncacheClip(clip);
    };
  }, [animations, mixer]);

  useFrame(
    ({ viewport }, delta) => {
      const root = mover.current;
      const lean = body.current;
      if (root === null || lean === null) return;

      if (line.current === undefined) {
        if (text.current === null || text.current.commitState().status !== 'committed') return;
        line.current = new RetainedLine(text.current);
        line.current.show(FACE_TEXT.length);
      }
      if (!heroReady()) return;

      // A replay parks the robot at once; the landing that follows schedules the next run.
      const replays = replayCount();
      if (replays !== replay.current) {
        replay.current = replays;
        time.current = undefined;
        runAt.current = Number.POSITIVE_INFINITY;
      }
      const shock = latestShockwave();
      if (shock !== undefined && shock.id !== wave.current) {
        wave.current = shock.id;
        runAt.current = shock.at + REPLAY_DELAY * 1000;
      }

      if (time.current === undefined || path.current === undefined) {
        runAt.current ??= performance.now() + FIRST_RUN_DELAY * 1000;
        if (performance.now() < runAt.current) {
          root.visible = false;
          setFootprint(undefined);
          return;
        }
        time.current = 0;
        runAt.current = Number.POSITIVE_INFINITY;
        path.current = layPath(viewport.width, viewport.height, runs.current);
        runs.current += 1;
        gone.current = false;
      }

      const step = Math.min(delta, 0.1);
      time.current = hold.current ?? time.current + step;
      if (time.current >= RUN_SECONDS) {
        time.current = undefined;
        root.visible = false;
        line.current.show(0);
        setFootprint(undefined);
        // Off the far end of its path, if the edge was somehow never crossed: what follows is the black hole.
        requestCollapse();
        return;
      }

      const { x, y, heading, look } = poseAt(time.current, path.current);
      root.visible = true;
      root.position.set(x, y, FLOOR_Z);
      root.rotation.z = heading;
      setFootprint({ x, y, z: FLOOR_Z, heading, halfExtents: PUSH_HALF_EXTENTS });
      // As its body starts to leave the screen, the black hole opens; the pull lands a beat after it has gone.
      if (
        !gone.current &&
        time.current >= LEAVE_AT &&
        (Math.abs(x) > viewport.width / 2 + BODY_REACH || Math.abs(y) > viewport.height / 2 + BODY_REACH)
      ) {
        gone.current = true;
        requestCollapse();
      }
      // Rocks back on its wheels. The axle is the mover's y, and a negative turn about it tips the top backwards.
      lean.rotation.y = -LEAN * look;
      // Looking up, the face prints its message a letter at a time, and clears it as it looks back down.
      const now = time.current;
      const count =
        now >= TYPE_FROM && now < TYPE_UNTIL
          ? Math.min(FACE_TEXT.length, Math.floor((now - TYPE_FROM) * TYPE_RATE))
          : 0;
      line.current.show(count);
      if (face.current !== null) face.current.visible = count > 0;
      const eyes = eyesAt(now);
      uEyes.value = eyes.shown;
      uTear.value = eyes.tear;
      uSeed.value = Math.floor(now * 48);

      mixer.update(step);
      if (head !== undefined && look > 0) {
        root.updateWorldMatrix(true, true);
        axle.set(0, 1, 0).applyQuaternion(root.quaternion);
        tiltJoint(head, axle, -HEAD_TILT * look);
      }
      // The display rides on the head joint: its matrix is the joint's, brought into the mover's frame.
      const screen = face.current;
      if (head !== undefined && screen !== null && count > 0) {
        root.updateWorldMatrix(true, true);
        screen.matrix.copy(root.matrixWorld).invert().multiply(head.matrixWorld).multiply(FACE_LOCAL);
      }
      // Before the physics phase: the title reads the footprint this frame publishes.
    },
    { phase: 'start' },
  );

  return (
    <group ref={mover} visible={false}>
      <group ref={body}>
        {/* The model faces its own -z once stood up, and the quarter turn points that along the mover's +x, its
            direction of travel. Inside it, the model's +y becomes the world's +z, towards the camera. */}
        <group rotation={[0, 0, Math.PI / 2]}>
          <group rotation={[Math.PI / 2, 0, 0]} scale={SCALE}>
            <primitive object={scene} />
          </group>
        </group>
      </group>
      <mesh material={shadowMaterial} position={[0, 0, 0.01]}>
        <planeGeometry args={[SHADOW_LENGTH, SHADOW_WIDTH]} />
      </mesh>
      {display !== undefined ? (
        <group matrixAutoUpdate={false} ref={face} visible={false}>
          <Text
            constraints={{ width: { mode: 'exact', size: FACE_WIDTH } }}
            font={faces['geist-pixel-grid']}
            layout={{ align: 'center', wrap: 'none' }}
            material={display}
            ref={text}
            position={[-FACE_WIDTH / 2, FACE_FONT_SIZE / 2, 0]}
            style={{
              color: FACE_COLOUR,
              fontSize: FACE_FONT_SIZE,
              letterSpacing: FACE_LETTER_SPACING,
              lineHeight: 1,
            }}
          >
            {FACE_TEXT}
          </Text>
        </group>
      ) : null}
    </group>
  );
}
