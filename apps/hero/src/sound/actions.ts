import { createActions } from 'koota';
import { Sound, SoundView, type OneShot, type SoundDraw } from './traits';

export const soundActions = createActions((world) => ({
  initializeSound: () => {
    world.add(Sound);
  },
  /** Attach the mixer. Whatever was cued while no mixer listened is dropped rather than played late. */
  mountSoundView: (view: SoundDraw) => {
    world.get(Sound)!.queue.count = 0;
    world.add(SoundView(view));
  },
  unmountSoundView: () => {
    world.remove(SoundView);
  },
  toggleSound: () => {
    world.set(Sound, { muted: !world.get(Sound)!.muted });
  },
  /** Queue a voice for the mixer. A frame holds a bounded number of cues, and any past that are dropped. */
  cueSound: (voice: OneShot, pan: number, rate: number, gain: number, delay = 0, take = 0) => {
    const queue = world.get(Sound)!.queue;

    if (queue.count === queue.cues.length) return;

    const cue = queue.cues[queue.count++]!;
    cue.voice = voice;
    cue.pan = pan;
    cue.rate = rate;
    cue.gain = gain;
    cue.delay = delay;
    cue.take = take;
  },
}));
