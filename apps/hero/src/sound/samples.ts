import { EMBER_SECONDS } from '../star-embers/traits';
import { jitter } from '../utils';
import type { SoundDraw } from './traits';

/** A constant, or seconds and values alternating: held at the first value, then ramped exponentially onward. */
type Curve = number | readonly number[];

let samples: Promise<SoundDraw['samples']> | undefined;

/**
 * Every voice, baked once and shared. `use` needs the same promise on every render to see it settle, so the first
 * call starts the bake and each later call returns its promise.
 */
export function loadSamples(): Promise<SoundDraw['samples']> {
  samples ??= bakeSamples();

  return samples;
}

/**
 * Voices are rendered offline the way a late-nineties console stored them, at 11 or 22 kHz and five to eight bits,
 * and the mixer pitches them by playback rate like that console's sampler. The acoustic voices, the tagline's note,
 * the robot's hums, the button's tap, and the embers' sparkle, are kept finer, since grit on a clean decay sounds like
 * a machine rather than a thing struck. Loops are baked twice over and repeat their settled second half, since every
 * part of them repeats there.
 */
async function bakeSamples(): Promise<SoundDraw['samples']> {
  // The robot's voice, halfway between a hummed voice and the tagline's mallet: C4, the middle of the two, as a round
  // sine and a dark buzz through a vowel's two lowest formants in equal parts, easing a little down into its note
  // from a soft onset. Each syllable is its own vowel, glide, and length, drawn from a recording of a person humming
  // along: mostly settling from above, one rising, one level.
  const hum = (low: number, high: number, glide: number, length: number) =>
    bake(length + 0.12, 22_050, 12, (context) => {
      const pitch = [0, 261.63 * glide, 0.04, 261.63];
      const level = [0, 1e-4, 0.012, 1, length, 0.5, length + 0.12, 1e-4];
      oscillator(context, 'sine', pitch, level);
      oscillator(context, 'sawtooth', pitch, level, filter(context, 'bandpass', low, 5, gain(context, 0.6)));
      oscillator(context, 'sawtooth', pitch, level, filter(context, 'bandpass', high, 8, gain(context, 0.15)));
    });
  // The embers' sparkle: a spray of tiny high grains, each a few milliseconds of a sine between 4 and 9 kHz, far above
  // the boom it plays over, thick at the burst and thinning over the embers' life the way a sparkler spits. The grains
  // are plain arithmetic, written into a buffer the bake plays through. Two sprays apart glitter wider than one.
  const spray = (seed: number) =>
    bake(EMBER_SECONDS + 0.1, 32_000, 12, (context) => {
      const grains = context.createBuffer(1, context.length, context.sampleRate);
      const data = grains.getChannelData(0);

      for (let grain = 0; grain < 90; grain++) {
        const draw = seed * 1000 + grain * 3;
        // Times fall as the square of a uniform draw, so the grains crowd the burst.
        const start = EMBER_SECONDS * jitter(draw) ** 2;
        const frequency = 4000 + 5000 * jitter(draw + 1);
        const ring = 0.002 + 0.006 * jitter(draw + 2);
        const level = 1 - 0.7 * (start / EMBER_SECONDS);
        const from = Math.floor(start * context.sampleRate);
        const length = Math.min(Math.floor(ring * 5 * context.sampleRate), data.length - from);

        for (let index = 0; index < length; index++) {
          const seconds = index / context.sampleRate;
          const envelope = Math.min(1, index / 8) * Math.exp(-seconds / ring);
          data[from + index]! += level * envelope * Math.sin(2 * Math.PI * frequency * seconds);
        }
      }

      const source = context.createBufferSource();
      source.buffer = grains;
      source.connect(context.destination);
      source.start();
    });
  const sparkle = Promise.all([spray(1), spray(2)]);
  const speech = Promise.all([
    hum(515, 2135, 1.06, 0.12),
    hum(500, 1500, 1.03, 0.09),
    hum(330, 2230, 1.12, 0.14),
    hum(560, 1750, 0.95, 0.11),
    hum(300, 900, 1.05, 0.1),
    hum(520, 1800, 1, 0.13),
  ]);
  const [doo, chime, thud, tick, tap, whoosh, blip, gulp, boom, motor, drone] = await Promise.all([
    bake(0.3, 32_000, 12, (context) => {
      // A soft felt mallet on a wooden bar, C5: a round sine that eases a hair down into its note, the bar's faint
      // overtone near four times up damped almost at once, and a hush of noise where the mallet meets it.
      oscillator(context, 'sine', [0, 540, 0.03, 523.25], [0, 1e-4, 0.006, 1, 0.3, 1e-4]);
      oscillator(context, 'sine', 523.25 * 3.93, [0, 1e-4, 0.002, 0.12, 0.05, 1e-4]);
      noise(context, [0, 0.15, 0.012, 1e-4], filter(context, 'lowpass', 1800, 0.7));
    }),
    bake(1.6, 22_050, 8, (context) => {
      // An FM bell on C6: a sine carrier whose brightness, a modulator at 3.5 times its pitch, fades before it does.
      const carrier = oscillator(context, 'sine', 1046.5, [0, 1e-4, 0.004, 0.5, 1.6, 1e-4]);
      const depth = gain(context, [0, 2400, 0.9, 1], carrier.frequency);
      oscillator(context, 'sine', 1046.5 * 3.5, 1, depth);
      // A glassy upper partial rings briefly over it.
      oscillator(context, 'sine', 1046.5 * 2.76, [0, 1e-4, 0.002, 0.18, 0.35, 1e-4]);
    }),
    bake(0.45, 11_025, 8, (context) => {
      // A dull blow: a sine falling from a knock to a thump, and a short scuff of low noise.
      oscillator(context, 'sine', [0, 160, 0.14, 48], [0, 1e-4, 0.003, 0.9, 0.42, 1e-4]);
      noise(context, [0, 0.6, 0.07, 1e-4], filter(context, 'lowpass', 1400, 0.8));
    }),
    bake(0.06, 22_050, 6, (context) => {
      // A key: a click of bright noise over a square blip.
      oscillator(context, 'square', 1900, [0, 0.22, 0.03, 1e-4]);
      noise(context, [0, 0.5, 0.025, 1e-4], filter(context, 'bandpass', 3800, 1.4));
    }),
    bake(0.12, 32_000, 12, (context) => {
      // A modern console's button: a click, then a small hard shell ringing in three quickly damped modes. It is
      // kept at a finer rate and depth than the rest, so the click stays crisp.
      noise(context, [0, 1, 0.004, 1e-4], filter(context, 'highpass', 2500, 0.7));
      oscillator(context, 'sine', [0, 1500, 0.01, 1320], [0, 0.9, 0.035, 1e-4]);
      oscillator(context, 'sine', 1320 * 2.57, [0, 0.35, 0.015, 1e-4]);
      oscillator(context, 'sine', 520, [0, 1e-4, 0.002, 0.6, 0.06, 1e-4]);
    }),
    bake(0.9, 11_025, 8, (context) => {
      // Air rushing past the lifting title: noise through a band that sweeps up as it swells, and back as it fades.
      noise(context, [0, 1e-4, 0.38, 0.8, 0.9, 1e-4], filter(context, 'bandpass', [0, 280, 0.45, 2600, 0.9, 900], 1.6));
    }),
    bake(0.12, 22_050, 5, (context) => {
      // A voice chip's syllable on C5: a square that slides up a fourth into its note.
      const tone = filter(context, 'lowpass', 4200, 1);
      oscillator(context, 'square', [0, 392, 0.025, 523.25], [0, 0.3, 0.08, 0.2, 0.12, 1e-4], tone);
    }),
    bake(0.5, 11_025, 8, (context) => {
      // A gulp: a sine swallowing down past an octave with a wobble in its throat, and a little wet noise.
      const throat = oscillator(context, 'sine', [0, 480, 0.32, 70], [0, 1e-4, 0.015, 0.9, 0.46, 1e-4]);
      oscillator(context, 'sine', 26, 1, gain(context, 45, throat.frequency));
      noise(context, [0, 0.3, 0.12, 1e-4], filter(context, 'lowpass', 500, 2));
    }),
    bake(2.6, 11_025, 8, (context) => {
      // The pop: a sub drop under a burst of noise whose brightness falls away, with a crack at the front.
      oscillator(context, 'sine', [0, 120, 0.9, 28], [0, 1e-4, 0.005, 1, 2.5, 1e-4]);
      noise(context, [0, 0.9, 1.6, 1e-4], filter(context, 'lowpass', [0, 2400, 1.2, 110], 0.9));
      oscillator(context, 'triangle', [0, 260, 0.2, 50], [0, 0.6, 0.25, 1e-4]);
    }),
    bake(2, 11_025, 8, (context) => {
      // A little electric motor: a buzz through a resonant low-pass, chattering at the wheels' rate, over faint
      // gear noise. Everything repeats each second.
      const chatter = gain(context, 0.7);
      oscillator(context, 'sine', 12, 1, gain(context, 0.3, chatter.gain));
      const body = filter(context, 'lowpass', 520, 5, chatter);
      oscillator(context, 'sawtooth', 60, 0.5, body);
      oscillator(context, 'square', 120, 0.12, body);
      noise(context, 0.1, filter(context, 'bandpass', 1300, 3, chatter));
    }),
    bake(4, 11_025, 8, (context) => {
      // The hole: a low sine under two saws half a hertz apart, beating once every two seconds through a low-pass
      // that breathes at the same rate, over a rumble. Everything repeats each two seconds.
      const breath = filter(context, 'lowpass', 260, 4);
      oscillator(context, 'sine', 0.5, 1, gain(context, 140, breath.frequency));
      oscillator(context, 'sine', 41, 0.5);
      oscillator(context, 'sawtooth', 55, 0.25, breath);
      oscillator(context, 'sawtooth', 55.5, 0.25, breath);
      noise(context, 0.3, filter(context, 'lowpass', 140, 1));
    }),
  ]);

  return {
    doo: [doo],
    chime: [chime],
    thud: [thud],
    tick: [tick],
    tap: [tap],
    whoosh: [whoosh],
    blip: [blip],
    gulp: [gulp],
    boom: [boom],
    motor: [motor],
    drone: [drone],
    speech: await speech,
    sparkle: await sparkle,
  };
}

/**
 * Render `seconds` of a patch at `rate`, bring its peak up to full scale so the quiet ones keep every step of their
 * depth, and keep `bits` of it. How loud each voice plays is the mixer's to set.
 */
async function bake(
  seconds: number,
  rate: number,
  bits: number,
  patch: (context: OfflineAudioContext) => void,
): Promise<AudioBuffer> {
  const context = new OfflineAudioContext(1, Math.ceil(seconds * rate), rate);
  patch(context);
  const buffer = await context.startRendering();
  const data = buffer.getChannelData(0);
  let peak = 0;

  for (let index = 0; index < data.length; index++) peak = Math.max(peak, Math.abs(data[index]!));

  const steps = 2 ** (bits - 1) - 1;
  const scale = (steps * 0.95) / peak;

  for (let index = 0; index < data.length; index++) data[index] = Math.round(data[index]! * scale) / steps;

  return buffer;
}

function shape(param: AudioParam, curve: Curve): void {
  if (typeof curve === 'number') {
    param.value = curve;

    return;
  }

  param.setValueAtTime(curve[1]!, curve[0]!);

  for (let index = 2; index < curve.length; index += 2)
    param.exponentialRampToValueAtTime(curve[index + 1]!, curve[index]!);
}

/** A gain stage into `into`, which may be another node's parameter, as when one oscillator modulates another. */
function gain(
  context: OfflineAudioContext,
  level: Curve,
  into: AudioNode | AudioParam = context.destination,
): GainNode {
  const node = context.createGain();
  shape(node.gain, level);

  // `connect` is overloaded for nodes and parameters, so each is connected through its own overload.
  if (into instanceof AudioParam) node.connect(into);
  else node.connect(into);

  return node;
}

function oscillator(
  context: OfflineAudioContext,
  type: OscillatorType,
  frequency: Curve,
  level: Curve,
  into: AudioNode = context.destination,
): OscillatorNode {
  const source = context.createOscillator();
  source.type = type;
  shape(source.frequency, frequency);
  source.connect(gain(context, level, into));
  source.start();

  return source;
}

/** White noise from a second-long buffer on repeat, so a loop holding it repeats exactly each second. */
function noise(context: OfflineAudioContext, level: Curve, into: AudioNode): void {
  const buffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
  const data = buffer.getChannelData(0);

  for (let index = 0; index < data.length; index++) data[index] = jitter(index) * 2 - 1;

  const source = context.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  source.connect(gain(context, level, into));
  source.start();
}

function filter(
  context: OfflineAudioContext,
  type: BiquadFilterType,
  frequency: Curve,
  q: number,
  into: AudioNode = context.destination,
): BiquadFilterNode {
  const node = context.createBiquadFilter();
  node.type = type;
  node.Q.value = q;
  shape(node.frequency, frequency);
  node.connect(into);

  return node;
}
