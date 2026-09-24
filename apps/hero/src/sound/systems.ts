import type { World } from 'koota';
import { clamp, lerp } from 'math';
import { Collapse } from '../black-hole/traits';
import { HORIZON, POP_AT } from '../black-hole/content';
import { Mode } from '../director/traits';
import { Viewport } from '../viewport/traits';
import { FEATURE_LINE } from '../letters/content';
import { Title, Typing } from '../letters/traits';
import { Body } from '../physics/traits';
import { PlayButton } from '../ui/traits';
import { Rain } from '../rain/traits';
import { Robot } from '../robot/traits';
import { Time } from '../time/traits';
import { jitter } from '../utils';
import { soundActions } from './actions';
import { Sound, SoundView, type OneShot } from './traits';

/**
 * Notes as semitones from each voice's own pitch, on one major pentatonic scale so whatever lands together agrees: a
 * chord for the title's five letters, the notes the tagline's letters and the robot's syllables may take, a fanfare
 * into play, a power-up for the Play button, and the notes the rain may ring. The embers sparkle rather than take
 * notes, so the Play button's run after them is the only tune there.
 */
const TITLE = [-12, -8, -5, -3, 0];
const TAGLINE = [-5, -3, 0, 2, 4];
const SPEECH = [-3, 0, 2, 4];
const FANFARE = [-12, -8, -5, 0];
const POWER_UP = [0, 4, 7, 9, 12, 16];
const RAIN = [0, 2, 4, 7, 9, 12];

const LETTER = /\p{L}/u;

function pitch(semitones: number): number {
  return 2 ** (semitones / 12);
}

/** Where a floor point sits across the stereo field, kept a little inside the speakers. */
function across(x: number, width: number): number {
  return clamp(x / (width / 2), -1, 1) * 0.8;
}

/**
 * Listen to what the scene publishes and cue a sound for each change: the title's lift and landings, typing on the
 * paper and on the robot's face, its trips and its motor, the rain landing, the hole opening, feeding, collapsing,
 * and popping, and the Play button. Runs last in the simulation, so everything this frame changed is heard.
 */
export function listenForSounds(world: World): void {
  const sound = world.get(Sound)!;
  const heard = sound.heard;
  const { width } = world.get(Viewport)!;
  const { delta } = world.get(Time)!;
  const cue = soundActions(world).cueSound;
  const title = world.queryFirst(Title)?.get(Title)?.bodies;

  // The lift draws breath, and each letter lands on its own note, so the smash plays a chord in the order it lands.
  if (title !== undefined) {
    if (title.lifting && !heard.lifting) cue('whoosh', 0, 1, 0.5);

    heard.lifting = title.lifting;

    for (let slot = 0; slot < title.landingCount; slot++) {
      const landing = title.landings[slot]!;
      const pan = across(landing.x, width);
      cue('thud', pan, 1, 0.8);
      cue('chime', pan, pitch(TITLE[landing.index % TITLE.length]!), 0.35);
    }
  }

  // The tagline types in soft mallet notes, dooh dooh dooh, a note a letter, each letter always its own note so a
  // word keeps its tune, quiet over spaces and dots and well under everything else. Backspacing runs three times as
  // fast, so it takes back every other letter on a lower, fainter note.
  const typing = world.queryFirst(Typing)?.get(Typing);

  if (typing !== undefined) {
    const pan = (typing.count / FEATURE_LINE.length - 0.5) * 0.6;

    if (typing.count > heard.typed) {
      const letter = FEATURE_LINE[typing.count - 1]!;

      if (LETTER.test(letter)) cue('doo', pan, pitch(TAGLINE[letter.charCodeAt(0) % TAGLINE.length]!), 0.09);
    } else if (typing.count === heard.typed - 1 && typing.count % 2 === 0 && LETTER.test(FEATURE_LINE[typing.count]!)) {
      cue('doo', pan, pitch(-7), 0.04);
    }

    heard.typed = typing.count;
  }

  // The motor runs with the robot's speed across the floor, and the robot hums each letter its face prints: the next
  // of its syllables, each on a note of its own, so no two greetings sound alike.
  const robot = world.queryFirst(Robot)?.get(Robot);
  let motor = 0;
  let motorPan = 0;

  if (robot?.active) {
    const { x, y } = robot.pose;
    const step = Math.hypot(x - heard.x, y - heard.y);
    motorPan = across(x, width);

    // A jump across the floor is the robot being placed, not driven.
    if (heard.rolling && delta > 0 && step < 1) motor = clamp(step / delta / 7, 0, 1);

    const letters = robot.printed;

    if (letters > heard.printed) {
      const note = SPEECH[Math.floor(jitter(heard.spoken * 3 + 1) * SPEECH.length)]!;
      cue('speech', motorPan, pitch(note), 0.25, 0, heard.spoken++);
    }

    heard.x = x;
    heard.y = y;
    heard.rolling = true;
    heard.printed = letters;
  } else {
    heard.rolling = false;
    heard.printed = 0;
  }

  // Each press that sends it off in play answers with a button's tap where the marker lands, never quite the same.
  if (robot !== undefined) {
    if (robot.drive.trips > heard.trips) {
      cue('tap', across(robot.drive.targetX, width), lerp(0.94, 1.06, jitter(robot.drive.trips)), 0.5);
    }

    heard.trips = robot.drive.trips;
  }

  // Each glyph of rain rings its own note once, the first time it strikes anything, whether the floor, the glass, or
  // another glyph, so the rain plays a tune.
  const drops = world.get(Rain)?.drops;

  if (drops !== undefined) {
    for (let slot = 0; slot < drops.length; slot++) {
      const drop = drops[slot]!;

      if (drop.phase !== 'live' || heard.rang[slot] === drop.serial || !drop.entity!.get(Body)!.struck) continue;

      heard.rang[slot] = drop.serial;
      const pan = across(drop.x, width);
      cue('chime', pan, pitch(RAIN[Math.floor(jitter(drop.serial * 11 + 3) * RAIN.length)]!), 0.1 + 0.08 * drop.size);
      cue('tick', pan, 1.3, 0.12);
    }
  }

  // The hole opens with a deep gulp and gulps again at each meal, lower as it grows, and it pops with a boom.
  const collapse = world.get(Collapse)!;
  const hole = collapse.hole;
  const holePan = across(hole.x, width);

  if (heard.beat === 'closed' && (hole.beat === 'play' || hole.beat === 'open')) cue('gulp', holePan, 0.55, 0.7);

  if (collapse.fedAt > heard.fedAt) {
    cue('gulp', holePan, 1.3 - 0.6 * clamp(collapse.playHorizon / HORIZON, 0, 1), 0.6);
  }

  if (heard.beat !== 'black' && hole.beat === 'black') cue('boom', holePan, 1, 1);

  // The embers sparkle from their burst on their own clock: two faint sprays, either side of where the hole popped,
  // which thin out with the stars as they cool and hang on in the void long after.
  const embers = hole.sincePop ?? -1;

  if (heard.embers < 0 && embers >= 0) {
    cue('sparkle', clamp(holePan - 0.5, -1, 1), 1, 0.08, 0, 0);
    cue('sparkle', clamp(holePan + 0.5, -1, 1), 1, 0.08, 0, 1);
  }

  heard.embers = embers;

  const drawn = hole.beat === 'play' || hole.beat === 'open';
  heard.beat = hole.beat;
  heard.fedAt = collapse.fedAt;

  // Taking the wheel plays a little fanfare.
  const mode = world.get(Mode)!;

  if (mode.kind !== heard.mode || mode.since !== heard.modeSince) {
    if (mode.kind === 'play') {
      for (let note = 0; note < FANFARE.length; note++) cue('chime', 0, pitch(FANFARE[note]!), 0.3, note * 0.07);
    }

    heard.mode = mode.kind;
    heard.modeSince = mode.since;
  }

  // The Play button powers up with a run of blips as it draws in, and ticks when the pointer finds it.
  const button = world.get(PlayButton)!;
  const revealed = button.reveal > 0;
  const over = button.over;

  if (revealed && !heard.revealed) {
    for (let note = 0; note < POWER_UP.length; note++) cue('blip', 0, pitch(POWER_UP[note]!), 0.2, note * 0.12);
  }

  if (over && !heard.over) cue('tick', 0, 1.6, 0.35);

  heard.revealed = revealed;
  heard.over = over;

  // The drones climb as play's hole grows, and through the finale on its clock to the pop, from where play left them,
  // then hold where they reached while they fade under it. They swell as they climb, fading in with the hole as it
  // opens but not out with its last pinch before the pop.
  const rise =
    hole.beat === 'play'
      ? 0.5 * clamp(collapse.playGrown / HORIZON, 0, 1)
      : hole.beat === 'open'
        ? lerp(collapse.fromPlay ? 0.5 : 0, 1, clamp(hole.time / POP_AT, 0, 1))
        : hole.beat === 'black'
          ? sound.rise
          : 0;

  world.set(Sound, {
    motor,
    motorPan,
    drone: drawn ? Math.min(1, hole.presence + rise) * (0.3 + 0.7 * rise) : 0,
    dronePan: holePan,
    rise,
  });
}

/**
 * How much of each voice goes to the room and to the void, and how far the hole's pull may bend its pitch. Only the
 * embers' sparkle is sent into the void, with its echo, so it sounds alone there, and the button tap stays crisp.
 */
const MIX: Readonly<Record<OneShot, readonly [reverb: number, expanse: number, bend: number]>> = {
  doo: [0.15, 0, 1],
  speech: [0.15, 0, 1],
  chime: [0.55, 0, 1],
  sparkle: [0.2, 1, 0],
  thud: [0.25, 0, 1],
  tick: [0.15, 0, 1],
  tap: [0.12, 0, 0],
  whoosh: [0.4, 0, 1],
  blip: [0.35, 0, 1],
  gulp: [0.5, 0, 1],
  boom: [0.8, 0, 0],
};

/**
 * Play this frame's cues through the mounted mixer, and set its loops and master from the scene. Near an open hole
 * every sound sinks in pitch, dulls, and crushes, as though the hole drew the sound in too, and it all comes back
 * clean at the pop.
 */
export function playSounds(world: World): void {
  const view = world.get(SoundView);

  if (view === undefined) return;

  const sound = world.get(Sound)!;
  const queue = sound.queue;
  const context = view.context;
  const now = context.currentTime;
  const hole = world.get(Collapse)!.hole;
  const bend = hole.beat === 'play' || hole.beat === 'open' ? clamp(hole.pull, 0, 1) : 0;

  // Audio waits for a gesture. A suspended context would hold these and play them all at once when it resumed.
  if (context.state === 'running') {
    for (let index = 0; index < queue.count; index++) {
      const cue = queue.cues[index]!;
      const takes = view.samples[cue.voice];
      const [reverb, expanse, bends] = MIX[cue.voice];
      const source = context.createBufferSource();
      source.buffer = takes[cue.take % takes.length]!;
      source.playbackRate.value = cue.rate * (1 - 0.3 * bend * bends);
      const level = context.createGain();
      level.gain.value = cue.gain;
      const pan = context.createStereoPanner();
      pan.pan.value = cue.pan;
      source.connect(level).connect(pan).connect(view.input);
      send(pan, reverb, view.reverb);
      send(pan, expanse, view.expanse);

      source.start(now + cue.delay);
    }
  }

  soundActions(world).clearSoundCues();

  const { motor, drone, overtone } = view;
  motor.level.gain.setTargetAtTime(sound.motor * 0.2, now, 0.05);
  motor.source.playbackRate.setTargetAtTime(0.7 + 0.6 * sound.motor, now, 0.08);
  motor.pan.pan.setTargetAtTime(sound.motorPan, now, 0.05);
  // The hole's drones climb together, faster the nearer the pop: the drone by up to a fifth, and its overtone an
  // octave above it, joining as it goes.
  const climb = 7 * sound.rise ** 1.5;
  drone.level.gain.setTargetAtTime(sound.drone * 0.55, now, 0.2);
  drone.source.playbackRate.setTargetAtTime(pitch(climb), now, 0.2);
  drone.pan.pan.setTargetAtTime(sound.dronePan, now, 0.2);
  overtone.level.gain.setTargetAtTime(sound.drone * sound.rise * 0.35, now, 0.2);
  overtone.source.playbackRate.setTargetAtTime(pitch(12 + climb), now, 0.2);
  overtone.pan.pan.setTargetAtTime(sound.dronePan, now, 0.2);
  view.tone.frequency.setTargetAtTime(lerp(16_000, 700, bend ** 0.8), now, 0.03);
  view.crushed.gain.setTargetAtTime(0.7 * bend, now, 0.03);
  view.clean.gain.setTargetAtTime(1 - 0.7 * bend, now, 0.03);
  view.master.gain.setTargetAtTime(sound.muted ? 0 : 0.9, now, 0.05);
}

/** Send `amount` of a voice into one of the mix's spaces. */
function send(from: AudioNode, amount: number, into: AudioNode): void {
  if (amount === 0) return;

  const level = from.context.createGain();
  level.gain.value = amount;
  from.connect(level).connect(into);
}
