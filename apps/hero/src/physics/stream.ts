/** Position quantum in world units. */
export const POSITION_QUANTUM = 1 / 4096;
/** Every KEYFRAME_INTERVAL-th step (0, 30, 60, …) stores every body absolutely. */
export const KEYFRAME_INTERVAL = 30;
/** Floats per body in every pose array: px, py, pz, qx, qy, qz, qw. */
export const POSE_STRIDE = 7;

const ROTATION_OFFSET = 3;
/** The three smallest components of a unit quaternion each lie in [-1/√2, 1/√2]. */
const ROTATION_RANGE = Math.SQRT1_2;
const ROTATION_LEVELS = 0x7fff;
const ROTATION_SCALE = ROTATION_LEVELS / (2 * ROTATION_RANGE);
const ROTATION_COMPONENT_SPAN = ROTATION_LEVELS + 1;
const ROTATION_BYTES = 6;
const INITIAL_BYTE_CAPACITY = 4096;
const INITIAL_STEP_CAPACITY = 64;

/** A sealed, immutable recording of every body's decoded pose at each step. */
export interface PoseStream {
  readonly bodyCount: number;
  readonly stepCount: number;
  readonly byteLength: number;
  /** Writes the decoded poses of `step` (0 ≤ step < stepCount) into `out` (length bodyCount*POSE_STRIDE). */
  decode(step: number, out: Float32Array): void;
}

/**
 * Playback state shared by the writer and the stream: every body's last decoded pose and the quantized position that
 * the next delta is taken against.
 */
interface PlaybackState {
  readonly quantized: Float64Array;
  readonly poses: Float32Array;
}

function createPlaybackState(bodyCount: number): PlaybackState {
  return { quantized: new Float64Array(bodyCount * 3), poses: new Float32Array(bodyCount * POSE_STRIDE) };
}

function isKeyframe(step: number): boolean {
  return step % KEYFRAME_INTERVAL === 0;
}

function quantizePosition(value: number): number {
  return Math.round(value / POSITION_QUANTUM);
}

function zigzag(value: number): number {
  return value >= 0 ? value * 2 : -value * 2 - 1;
}

function unzigzag(value: number): number {
  return value % 2 === 0 ? value / 2 : -(value + 1) / 2;
}

/** Append-only byte sink over a Uint8Array that doubles when full. */
class ByteBuffer {
  #bytes = new Uint8Array(INITIAL_BYTE_CAPACITY);
  #length = 0;

  get length(): number {
    return this.#length;
  }

  /** The current backing store; replaced whenever the buffer grows. */
  get bytes(): Uint8Array {
    return this.#bytes;
  }

  writeByte(value: number): void {
    if (this.#length === this.#bytes.length) {
      const grown = new Uint8Array(this.#bytes.length * 2);
      grown.set(this.#bytes);
      this.#bytes = grown;
    }
    this.#bytes[this.#length++] = value;
  }

  /** Unsigned LEB128; arithmetic rather than bit operations so every safe integer round-trips. */
  writeVarint(value: number): void {
    let rest = value;
    while (rest >= 0x80) {
      this.writeByte((rest % 0x80) | 0x80);
      rest = Math.floor(rest / 0x80);
    }
    this.writeByte(rest);
  }

  writeZigzag(value: number): void {
    this.writeVarint(zigzag(value));
  }

  /** Copies exactly the written bytes. */
  seal(): Uint8Array {
    return this.#bytes.slice(0, this.#length);
  }
}

class ByteReader {
  readonly #bytes: Uint8Array;
  #offset: number;

  constructor(bytes: Uint8Array, offset: number) {
    this.#bytes = bytes;
    this.#offset = offset;
  }

  seek(offset: number): void {
    this.#offset = offset;
  }

  readByte(): number {
    return this.#bytes[this.#offset++]!;
  }

  readVarint(): number {
    let value = 0;
    let scale = 1;
    let byte: number;
    do {
      byte = this.readByte();
      value += (byte & 0x7f) * scale;
      scale *= 0x80;
    } while (byte >= 0x80);
    return value;
  }

  readZigzag(): number {
    return unzigzag(this.readVarint());
  }
}

function largestComponent(poses: Float32Array, offset: number): number {
  let largest = 0;
  for (let component = 1; component < 4; component++) {
    if (Math.abs(poses[offset + component]!) > Math.abs(poses[offset + largest]!)) largest = component;
  }
  return largest;
}

function quantizeRotationComponent(value: number): number {
  return Math.min(ROTATION_LEVELS, Math.max(0, Math.round((value + ROTATION_RANGE) * ROTATION_SCALE)));
}

/**
 * Smallest-three: a 2-bit dropped-component index followed by three 15-bit components, 47 bits big-endian in 6 bytes.
 * The packed value stays below 2^53, so plain arithmetic is exact.
 */
function writeRotation(buffer: ByteBuffer, poses: Float32Array, offset: number): void {
  const largest = largestComponent(poses, offset);
  const length = Math.hypot(poses[offset]!, poses[offset + 1]!, poses[offset + 2]!, poses[offset + 3]!);
  // q and -q are the same rotation; flipping makes the dropped component positive, so decode needs no sign bit.
  const scale = (poses[offset + largest]! < 0 ? -1 : 1) / length;
  let packed = largest;
  for (let component = 0; component < 4; component++) {
    if (component === largest) continue;
    packed = packed * ROTATION_COMPONENT_SPAN + quantizeRotationComponent(poses[offset + component]! * scale);
  }
  for (let byte = ROTATION_BYTES - 1; byte >= 0; byte--) buffer.writeByte(Math.floor(packed / 2 ** (8 * byte)) % 256);
}

function readRotation(reader: ByteReader, poses: Float32Array, offset: number): void {
  let packed = 0;
  for (let byte = 0; byte < ROTATION_BYTES; byte++) packed = packed * 256 + reader.readByte();
  const largest = Math.floor(packed / ROTATION_COMPONENT_SPAN ** 3);
  let remaining = 1;
  // The last component written occupies the low bits, so unpack in reverse.
  for (let component = 3; component >= 0; component--) {
    if (component === largest) continue;
    const value = (packed % ROTATION_COMPONENT_SPAN) / ROTATION_SCALE - ROTATION_RANGE;
    packed = Math.floor(packed / ROTATION_COMPONENT_SPAN);
    poses[offset + component] = value;
    remaining -= value * value;
  }
  poses[offset + largest] = Math.sqrt(Math.max(0, remaining));
}

function writeKeyframe(buffer: ByteBuffer, poses: Float32Array, bodyCount: number): void {
  buffer.writeVarint(bodyCount);
  for (let body = 0; body < bodyCount; body++) {
    const offset = body * POSE_STRIDE;
    for (let axis = 0; axis < 3; axis++) buffer.writeZigzag(quantizePosition(poses[offset + axis]!));
    writeRotation(buffer, poses, offset + ROTATION_OFFSET);
  }
}

/** Deltas are taken against the previously decoded quantized position, so rounding error never accumulates. */
function writeDeltaStep(buffer: ByteBuffer, poses: Float32Array, moved: ArrayLike<number>, state: PlaybackState): void {
  buffer.writeVarint(moved.length);
  for (let entry = 0; entry < moved.length; entry++) {
    const body = moved[entry]!;
    const offset = body * POSE_STRIDE;
    buffer.writeVarint(body);
    for (let axis = 0; axis < 3; axis++) {
      buffer.writeZigzag(quantizePosition(poses[offset + axis]!) - state.quantized[body * 3 + axis]!);
    }
    writeRotation(buffer, poses, offset + ROTATION_OFFSET);
  }
}

/** The single decode path: the writer runs it over the bytes it just wrote, so live and replayed poses are identical. */
function applyStep(reader: ByteReader, keyframe: boolean, state: PlaybackState): void {
  const count = reader.readVarint();
  for (let entry = 0; entry < count; entry++) {
    const body = keyframe ? entry : reader.readVarint();
    const offset = body * POSE_STRIDE;
    for (let axis = 0; axis < 3; axis++) {
      const slot = body * 3 + axis;
      const stored = reader.readZigzag();
      const quantized = keyframe ? stored : state.quantized[slot]! + stored;
      state.quantized[slot] = quantized;
      state.poses[offset + axis] = quantized * POSITION_QUANTUM;
    }
    readRotation(reader, state.poses, offset + ROTATION_OFFSET);
  }
}

function assertPoseLength(name: string, poses: Float32Array, bodyCount: number): void {
  const expected = bodyCount * POSE_STRIDE;
  if (poses.length !== expected) {
    throw new RangeError(`${name} must hold bodyCount * POSE_STRIDE = ${expected} floats, received ${poses.length}`);
  }
}

class RecordedPoseStream implements PoseStream {
  readonly bodyCount: number;
  readonly stepCount: number;
  readonly byteLength: number;
  readonly #stepOffsets: Uint32Array;
  readonly #reader: ByteReader;
  readonly #state: PlaybackState;
  #decodedStep = -1;

  constructor(bodyCount: number, bytes: Uint8Array, stepOffsets: Uint32Array) {
    this.bodyCount = bodyCount;
    this.stepCount = stepOffsets.length;
    this.byteLength = bytes.length;
    this.#stepOffsets = stepOffsets;
    this.#reader = new ByteReader(bytes, 0);
    this.#state = createPlaybackState(bodyCount);
  }

  decode(step: number, out: Float32Array): void {
    if (!Number.isInteger(step) || step < 0 || step >= this.stepCount) {
      throw new RangeError(`step must be an integer in [0, ${this.stepCount}), received ${step}`);
    }
    assertPoseLength('out', out, this.bodyCount);

    const keyframe = step - (step % KEYFRAME_INTERVAL);
    // Rolling forward from the cached step is cheaper whenever it already sits at or past the governing keyframe.
    const resume = this.#decodedStep >= keyframe && this.#decodedStep <= step;
    const first = resume ? this.#decodedStep + 1 : keyframe;
    if (first <= step) this.#reader.seek(this.#stepOffsets[first]!);
    for (let current = first; current <= step; current++) applyStep(this.#reader, isKeyframe(current), this.#state);
    this.#decodedStep = step;
    out.set(this.#state.poses);
  }
}

/** Records one pose per fixed physics step and seals the result into a {@link PoseStream}. */
export class PoseStreamWriter {
  readonly #bodyCount: number;
  readonly #buffer = new ByteBuffer();
  readonly #state: PlaybackState;
  #stepOffsets = new Uint32Array(INITIAL_STEP_CAPACITY);
  #stepCount = 0;

  constructor(bodyCount: number) {
    if (!Number.isInteger(bodyCount) || bodyCount <= 0) {
      throw new RangeError(`bodyCount must be a positive integer, received ${bodyCount}`);
    }
    this.#bodyCount = bodyCount;
    this.#state = createPlaybackState(bodyCount);
  }

  /**
   * Records the next step. `poses` holds every body's current raw physics pose (bodyCount*POSE_STRIDE).
   * `moved` lists the distinct ids (0 ≤ id < bodyCount) of bodies whose pose changed since the previous step (ignored
   * on keyframe steps, where every body is written). Writes this step's decoded (quantized) poses into `decodedOut`,
   * which is exactly what `stream.decode(step, …)` later returns.
   */
  record(poses: Float32Array, moved: ArrayLike<number>, decodedOut: Float32Array): void {
    assertPoseLength('poses', poses, this.#bodyCount);
    assertPoseLength('decodedOut', decodedOut, this.#bodyCount);

    const step = this.#stepCount;
    const start = this.#buffer.length;
    this.#appendStepOffset(start);
    const keyframe = isKeyframe(step);
    if (keyframe) writeKeyframe(this.#buffer, poses, this.#bodyCount);
    else writeDeltaStep(this.#buffer, poses, moved, this.#state);

    applyStep(new ByteReader(this.#buffer.bytes, start), keyframe, this.#state);
    decodedOut.set(this.#state.poses);
  }

  /** Seals the stream, copying the recorded bytes to their exact length. The writer must not be used afterwards. */
  finish(): PoseStream {
    return new RecordedPoseStream(this.#bodyCount, this.#buffer.seal(), this.#stepOffsets.slice(0, this.#stepCount));
  }

  #appendStepOffset(offset: number): void {
    if (this.#stepCount === this.#stepOffsets.length) {
      const grown = new Uint32Array(this.#stepOffsets.length * 2);
      grown.set(this.#stepOffsets);
      this.#stepOffsets = grown;
    }
    this.#stepOffsets[this.#stepCount++] = offset;
  }
}
