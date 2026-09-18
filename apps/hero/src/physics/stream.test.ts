import { describe, expect, it } from 'vitest';
import { KEYFRAME_INTERVAL, POSE_STRIDE, POSITION_QUANTUM, PoseStreamWriter, type PoseStream } from './stream';

const STEPS = 180;
const STEP_SECONDS = 1 / 60;
const HALF_QUANTUM = POSITION_QUANTUM / 2;

/** Numerical Recipes LCG: a deterministic uniform source in [0, 1). */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function between(random: () => number, min: number, max: number): number {
  return min + (max - min) * random();
}

function writeRandomUnitQuaternion(random: () => number, poses: Float32Array, offset: number): void {
  for (;;) {
    const x = between(random, -1, 1);
    const y = between(random, -1, 1);
    const z = between(random, -1, 1);
    const w = between(random, -1, 1);
    const lengthSquared = x * x + y * y + z * z + w * w;
    if (lengthSquared < 1e-4 || lengthSquared > 1) continue;
    const inverse = 1 / Math.sqrt(lengthSquared);
    poses.set([x * inverse, y * inverse, z * inverse, w * inverse], offset);
    return;
  }
}

function perturbQuaternion(random: () => number, poses: Float32Array, offset: number): void {
  const nudged = [0, 1, 2, 3].map((axis) => poses[offset + axis]! + between(random, -0.05, 0.05));
  const inverse = 1 / Math.hypot(...nudged);
  poses.set(
    nudged.map((component) => component * inverse),
    offset,
  );
}

interface Recording {
  readonly stream: PoseStream;
  /** Raw physics poses per step. */
  readonly raw: readonly Float32Array[];
  /** What `record` wrote into `decodedOut` per step: the poses shown live. */
  readonly shown: readonly Float32Array[];
}

interface Motion {
  readonly bodyCount: number;
  readonly seed: number;
  /** Probability that a body moves on `step`. */
  readonly moveShare: (step: number, random: () => number) => number;
  /** Bodies that never move and are never reported as moved. */
  readonly sleeping?: (body: number) => boolean;
}

function recordMotion({ bodyCount, seed, moveShare, sleeping = () => false }: Motion): Recording {
  const random = lcg(seed);
  const poses = new Float32Array(bodyCount * POSE_STRIDE);
  const velocities = new Float64Array(bodyCount * 3);
  for (let body = 0; body < bodyCount; body++) {
    const offset = body * POSE_STRIDE;
    poses.set([between(random, -6, 6), between(random, 0, 4), between(random, -1, 1)], offset);
    writeRandomUnitQuaternion(random, poses, offset + 3);
    velocities.set([between(random, -3, 3), between(random, -3, 3), between(random, -3, 3)], body * 3);
  }

  const writer = new PoseStreamWriter(bodyCount);
  const raw: Float32Array[] = [];
  const shown: Float32Array[] = [];
  for (let step = 0; step < STEPS; step++) {
    const share = moveShare(step, random);
    const moved: number[] = [];
    for (let body = 0; body < bodyCount; body++) {
      if (sleeping(body) || random() >= share) continue;
      const offset = body * POSE_STRIDE;
      for (let axis = 0; axis < 3; axis++) poses[offset + axis]! += velocities[body * 3 + axis]! * STEP_SECONDS;
      perturbQuaternion(random, poses, offset + 3);
      moved.push(body);
    }
    const decoded = new Float32Array(bodyCount * POSE_STRIDE);
    writer.record(poses, moved, decoded);
    raw.push(poses.slice());
    shown.push(decoded);
  }
  return { stream: writer.finish(), raw, shown };
}

function maxPositionError(decoded: Float32Array, raw: Float32Array): number {
  let error = 0;
  for (let offset = 0; offset < raw.length; offset += POSE_STRIDE) {
    for (let axis = 0; axis < 3; axis++) {
      error = Math.max(error, Math.abs(decoded[offset + axis]! - raw[offset + axis]!));
    }
  }
  return error;
}

function bodyPose(poses: Float32Array, body: number): Float32Array {
  return poses.subarray(body * POSE_STRIDE, (body + 1) * POSE_STRIDE);
}

const varyingMotion: Motion = { bodyCount: 60, seed: 0x5eed, moveShare: (_step, random) => between(random, 0.05, 0.9) };

describe('PoseStreamWriter / PoseStream', () => {
  it('shows exactly what the stream decodes, within half a quantum of the raw position', () => {
    const { stream, raw, shown } = recordMotion(varyingMotion);
    expect(stream.bodyCount).toBe(60);
    expect(stream.stepCount).toBe(STEPS);

    const decoded = new Float32Array(60 * POSE_STRIDE);
    for (let step = 0; step < STEPS; step++) {
      stream.decode(step, decoded);
      expect(decoded).toEqual(shown[step]);
      expect(maxPositionError(decoded, raw[step]!)).toBeLessThanOrEqual(HALF_QUANTUM);
    }
  });

  it('decodes backwards through keyframe seeks to the values shown going forwards', () => {
    const { stream, shown } = recordMotion(varyingMotion);

    const decoded = new Float32Array(60 * POSE_STRIDE);
    for (let step = STEPS - 1; step >= 0; step--) {
      stream.decode(step, decoded);
      expect(decoded).toEqual(shown[step]);
    }
  });

  it('does not accumulate drift from sub-quantum steps', () => {
    const drift = 0.37 * POSITION_QUANTUM;
    const poses = new Float32Array(POSE_STRIDE);
    const shown = new Float32Array(POSE_STRIDE);
    const writer = new PoseStreamWriter(1);
    for (let step = 0; step < STEPS; step++) {
      poses.set([1.25 + step * drift, -0.5 - step * drift, 3 + 2 * step * drift, 0, 0, 0, 1]);
      writer.record(poses, [0], shown);
      expect(maxPositionError(shown, poses)).toBeLessThanOrEqual(HALF_QUANTUM);
    }

    const decoded = new Float32Array(POSE_STRIDE);
    writer.finish().decode(STEPS - 1, decoded);
    expect(maxPositionError(decoded, poses)).toBeLessThanOrEqual(HALF_QUANTUM);
  });

  it('reconstructs rotations to within 1e-6 of the raw rotation on keyframe and delta steps', () => {
    const random = lcg(0xc0ffee);
    const edgeCases = [
      [0, 0, 0, 1],
      [0, 0, 0, -1],
      [1, 0, 0, 0],
      [0, -1, 0, 0],
      [0.5, 0.5, 0.5, 0.5],
      [-0.5, 0.5, -0.5, 0.5],
      [Math.SQRT1_2, Math.SQRT1_2, 0, 0],
      [0, 0, -Math.SQRT1_2, Math.SQRT1_2],
    ];
    const bodyCount = edgeCases.length + 512;
    const poses = new Float32Array(bodyCount * POSE_STRIDE);
    const everyBody = Array.from({ length: bodyCount }, (_, body) => body);
    const decoded = new Float32Array(bodyCount * POSE_STRIDE);
    const writer = new PoseStreamWriter(bodyCount);

    for (let step = 0; step < 2; step++) {
      edgeCases.forEach((rotation, body) => poses.set(rotation, body * POSE_STRIDE + 3));
      for (let body = edgeCases.length; body < bodyCount; body++) {
        writeRandomUnitQuaternion(random, poses, body * POSE_STRIDE + 3);
      }
      writer.record(poses, everyBody, decoded);

      let worstAlignment = 1;
      for (let body = 0; body < bodyCount; body++) {
        const actual = bodyPose(decoded, body);
        const expected = bodyPose(poses, body);
        let dot = 0;
        for (let axis = 3; axis < POSE_STRIDE; axis++) dot += actual[axis]! * expected[axis]!;
        worstAlignment = Math.min(worstAlignment, Math.abs(dot));
      }
      expect(worstAlignment).toBeGreaterThanOrEqual(1 - 1e-6);
    }
  });

  it('holds sleeping bodies at their exact keyframe pose between keyframes', () => {
    const sleeping = (body: number): boolean => body % 3 === 1;
    const bodyCount = 40;
    const { stream } = recordMotion({ bodyCount, seed: 0xdead, moveShare: () => 0.5, sleeping });

    const decoded = new Float32Array(bodyCount * POSE_STRIDE);
    const keyframe = new Float32Array(bodyCount * POSE_STRIDE);
    for (let step = 0; step < STEPS; step++) {
      stream.decode(step, decoded);
      if (step % KEYFRAME_INTERVAL === 0) keyframe.set(decoded);
      for (let body = 0; body < bodyCount; body++) {
        if (sleeping(body)) expect(bodyPose(decoded, body)).toEqual(bodyPose(keyframe, body));
      }
    }
  });

  it('keeps 400 bodies over 180 steps with a quarter moving under 700 kB', async ({ annotate }) => {
    const { stream } = recordMotion({ bodyCount: 400, seed: 0xb0d1e5, moveShare: () => 0.25 });
    await annotate(`byteLength ${stream.byteLength}`);
    expect(stream.byteLength).toBeLessThan(700_000);
  });

  it('rejects malformed public arguments', () => {
    for (const bodyCount of [0, -1, 1.5, Number.NaN]) {
      expect(() => new PoseStreamWriter(bodyCount)).toThrow(RangeError);
    }

    const writer = new PoseStreamWriter(2);
    const pose = new Float32Array(2 * POSE_STRIDE);
    expect(() => writer.record(new Float32Array(POSE_STRIDE), [], pose)).toThrow(RangeError);
    expect(() => writer.record(pose, [], new Float32Array(POSE_STRIDE))).toThrow(RangeError);

    writer.record(pose, [], pose);
    const stream = writer.finish();
    expect(() => stream.decode(0, new Float32Array(POSE_STRIDE))).toThrow(RangeError);
    for (const step of [-1, 1, 0.5]) expect(() => stream.decode(step, pose)).toThrow(RangeError);
  });
});
