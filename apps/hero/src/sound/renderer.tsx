import { useWorld } from 'koota/react';
import { use, useEffect } from 'react';
import { soundActions } from './actions';
import { loadSamples } from './samples';
import type { LoopDraw, SoundDraw } from './traits';

/**
 * The scene's sound: console-era samples through a modern mix. Browsers hold audio until a gesture, so the first
 * press or key in the page starts it, and nothing cued before then plays late.
 */
export function SoundRenderer() {
  const world = useWorld();
  const samples = use(loadSamples());

  useEffect(() => {
    const context = new AudioContext({ latencyHint: 'interactive' });
    let view: SoundDraw;

    try {
      view = mix(context, samples);
    } catch (error) {
      void context.close();
      throw error;
    }

    soundActions(world).mountSoundView(view);

    const unlock = () => {
      if (context.state === 'suspended') void context.resume();
    };

    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);

    return () => {
      soundActions(world).unmountSoundView();
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
      void context.close();
    };
  }, [world, samples]);

  return null;
}

/**
 * The mix. Everything meets at the input and splits between a plain path and a bit-crushed one, which the hole
 * leans on, then passes a low-pass the hole closes, a compressor that glues it, and the master. A hall in the
 * manner of the PlayStation's reverb and a void return to the input from their sends.
 */
function mix(context: AudioContext, samples: SoundDraw['samples']): SoundDraw {
  const input = context.createGain();
  const clean = context.createGain();
  const crushed = context.createGain();
  crushed.gain.value = 0;
  const crusher = context.createWaveShaper();
  // Seventeen levels, about four bits, with no oversampling so the steps alias as the old hardware's did.
  crusher.curve = Float32Array.from({ length: 1024 }, (_, index) => Math.round(((index / 1023) * 2 - 1) * 8) / 8);
  crusher.oversample = 'none';
  const tone = context.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = 16_000;
  tone.Q.value = 2;
  const glue = context.createDynamicsCompressor();
  glue.threshold.value = -16;
  glue.knee.value = 10;
  glue.ratio.value = 4;
  glue.attack.value = 0.004;
  glue.release.value = 0.2;
  const master = context.createGain();
  master.gain.value = 0;
  input.connect(clean).connect(tone);
  input.connect(crusher).connect(crushed).connect(tone);
  tone.connect(glue).connect(master).connect(context.destination);

  // The hall waits a moment before it answers, as a real room does.
  const reverb = context.createGain();
  const predelay = context.createDelay(0.1);
  predelay.delayTime.value = 0.025;
  const hall = context.createConvolver();
  hall.buffer = room(context, 2.6, 2.4, 1.6, true);
  const wet = context.createGain();
  wet.gain.value = 0.6;
  reverb.connect(predelay).connect(hall).connect(wet).connect(input);

  // The void, which only the embers' sparkle is sent into, so it sounds alone there: a far larger space with no
  // walls, which answers after a long moment and keeps its highs for seconds, and an echo that bounces it from ear to
  // ear, dulling a little with each return, whose repeats sink into the same space. The sparkle hangs there
  // glittering long after it has gone.
  const expanse = context.createGain();
  const distance = context.createDelay(0.5);
  distance.delayTime.value = 0.12;
  const vast = context.createConvolver();
  vast.buffer = room(context, 8, 0.75, 0.3, false);
  const far = context.createGain();
  far.gain.value = 0.8;
  expanse.connect(distance).connect(vast).connect(far).connect(input);
  const echo = context.createGain();
  echo.gain.value = 0.35;
  const left = context.createDelay(1);
  const right = context.createDelay(1);
  left.delayTime.value = 0.27;
  right.delayTime.value = 0.27;
  const dull = context.createBiquadFilter();
  dull.type = 'lowpass';
  dull.frequency.value = 6000;
  const feedback = context.createGain();
  feedback.gain.value = 0.38;
  const ears = context.createChannelMerger(2);
  const returned = context.createGain();
  returned.gain.value = 0.5;
  expanse.connect(echo).connect(left).connect(dull).connect(right).connect(feedback).connect(left);
  left.connect(ears, 0, 0);
  right.connect(ears, 0, 1);
  ears.connect(returned).connect(input);
  ears.connect(distance);

  const loop = (buffer: AudioBuffer): LoopDraw => {
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.loopStart = buffer.duration / 2;
    source.loopEnd = buffer.duration;
    const level = context.createGain();
    level.gain.value = 0;
    const pan = context.createStereoPanner();
    source.connect(level).connect(pan).connect(input);
    source.start(0, buffer.duration / 2);

    return { source, level, pan };
  };

  const drone = loop(samples.drone[0]!);
  const overtone = loop(samples.drone[0]!);
  drone.pan.connect(reverb);
  overtone.pan.connect(reverb);

  return {
    context,
    samples,
    input,
    reverb,
    expanse,
    clean,
    crushed,
    tone,
    master,
    motor: loop(samples.motor[0]!),
    drone,
    overtone,
  };
}

/**
 * A stereo space's impulse: a dense tail of noise, different in each ear, that dies at `decay` a second over
 * `seconds` and darkens at `darkening` a second, since air takes the highs first. A room with walls answers first
 * with a few sparse early reflections; a space without them has none, and its tail swells in rather than starting at
 * once.
 */
function room(context: AudioContext, seconds: number, decay: number, darkening: number, walls: boolean): AudioBuffer {
  const rate = context.sampleRate;
  const length = Math.floor(rate * seconds);
  const buffer = context.createBuffer(2, length, rate);

  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    let low = 0;

    for (let index = 0; index < length; index++) {
      const time = index / rate;
      low += (Math.random() * 2 - 1 - low) * (0.05 + 0.9 * Math.exp(-time * darkening));
      data[index] = low * Math.exp(-time * decay) * (walls ? 1 : 1 - Math.exp(-time / 0.15));
    }

    if (!walls) continue;

    for (let tap = 0; tap < 6; tap++) {
      data[Math.floor((0.011 + tap * 0.017 + channel * 0.007) * rate)]! += (tap % 2 === 0 ? 0.7 : -0.5) * (1 - tap / 8);
    }
  }

  return buffer;
}
