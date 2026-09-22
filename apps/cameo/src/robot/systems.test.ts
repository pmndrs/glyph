import { createWorld } from 'koota';
import { describe, expect, it } from 'vitest';
import { actions } from '../actions';
import { bearingToCamera, CAMERA, framePosition, MARK, offFrameDistance } from '../cameo/content';
import { triggerTakeEnd } from '../cameo/systems';
import { Lens } from '../cameo/traits';
import { IconField, Shocks } from '../icon-field/traits';
import { moveIconField } from '../icon-field/systems';
import { advanceSequence } from '../sequence/systems';
import { updateTime } from '../time/systems';
import { WORLD_TRAITS } from '../traits';
import { pressFloorWithRobot } from '../cameo/systems';
import { CARDS, GREETING, POSTSCRIPT, SHOCKS, TAKE_SECONDS } from './content';
import { eyesAt, poseAt, printedAt, runTake, stepDust } from './systems';
import { Robot, type Pose } from './traits';

const FRAME = 16 / 9;

/** A world wound up exactly as the application winds it up, so tests step the same systems the film does. */
function startFilm() {
  const world = createWorld(...WORLD_TRAITS);
  actions(world).initializeCameo();
  actions(world).setFrame(FRAME);

  return world;
}

/** Advance the simulation by `seconds` at the frame rate the loop runs at, and report the robot each step. */
function play(world: ReturnType<typeof startFilm>, seconds: number, watch?: (robot: ReturnType<typeof read>) => void) {
  const step = 1 / 60;

  for (let frame = 0; frame * step < seconds; frame++) {
    updateTime(world, step, (frame + 1) * step * 1000);
    advanceSequence(world);
    runTake(world);
    triggerTakeEnd(world);
    advanceSequence(world);
    pressFloorWithRobot(world);
    moveIconField(world);
    stepDust(world);
    watch?.(read(world));
  }
}

function read(world: ReturnType<typeof startFilm>) {
  return world.queryFirst(Robot)!.get(Robot)!;
}

function poseIn(time: number, take = 1): Pose {
  return poseAt({ x: 0, y: 0, heading: 0, look: 0, lean: 0 }, time, offFrameDistance(FRAME), take);
}

describe('the take', () => {
  it('rolls the robot in from off frame, stops it, and sends it off the other side', () => {
    const reach = offFrameDistance(FRAME);
    const entrance = poseIn(0);
    const mark = poseIn(4);
    const exit = poseIn(TAKE_SECONDS - 0.01);

    expect(Math.hypot(entrance.x, entrance.y)).toBeGreaterThan(reach * 0.9);
    expect(Math.hypot(mark.x, mark.y)).toBeLessThan(0.5);
    expect(Math.hypot(exit.x, exit.y)).toBeGreaterThan(reach * 0.9);
    // It leaves on the opposite side of the mark from where it came in.
    expect(Math.sign(exit.x - mark.x)).toBe(-Math.sign(entrance.x - mark.x));
  });

  it('turns its face to the lens for every screenful and watches the road between the two messages', () => {
    for (const card of CARDS) {
      const reading = poseIn((card.from + card.until) / 2);
      expect(reading.look).toBe(1);
      expect(reading.heading).toBeCloseTo(bearingToCamera(reading.x, reading.y), 5);
    }

    const away = poseIn((GREETING.at(-1)!.until + POSTSCRIPT[0]!.from) / 2);
    expect(away.look).toBeLessThan(0.2);
  });

  it('sets off after the greeting, stops short, and holds there for the postscript', () => {
    const greeted = poseIn(GREETING.at(-1)!.until);
    const halted = poseIn(POSTSCRIPT[0]!.from);
    const finished = poseIn(POSTSCRIPT.at(-1)!.until);
    const travelled = Math.hypot(halted.x - greeted.x, halted.y - greeted.y);

    expect(travelled).toBeGreaterThan(0.5);
    expect(travelled).toBeLessThan(2.5);
    // Having stopped, it does not creep while it delivers the rest of the line.
    expect(Math.hypot(finished.x - halted.x, finished.y - halted.y)).toBeLessThan(0.001);
  });

  it('prints one screenful at a time, in full, and clears it before the next', () => {
    const blank = CARDS.map(() => 0);

    expect(printedAt(CARDS[0]!.from - 0.1)).toEqual(blank);
    expect(printedAt(TAKE_SECONDS - 0.01)).toEqual(blank);

    for (const [index, card] of CARDS.entries()) {
      const shown = printedAt(card.until - 0.01);

      expect(shown[index]).toBe(card.text.length);
      expect(shown.filter((count) => count > 0)).toHaveLength(1);
    }
  });

  it('holds each screenful long enough to read after it has finished printing', () => {
    for (const card of CARDS) {
      const printing = card.text.length / 13;

      expect(card.until - card.from - printing).toBeGreaterThan(0.8);
    }
  });

  it('keeps the eyes out for a whole message and blinks between the two', () => {
    const state = { shown: 1, tear: 0 };

    for (const card of GREETING) {
      eyesAt(state, (card.from + card.until) / 2);
      expect(state.shown).toBe(0);
    }

    // The eyes do not come back as one screenful gives way to the next.
    eyesAt(state, GREETING[1]!.from);
    expect(state.shown).toBe(0);
    expect(state.tear).toBeGreaterThan(0.5);

    const blinks: number[] = [];

    for (let now = GREETING.at(-1)!.until + 0.3; now < POSTSCRIPT[0]!.from - 0.3; now += 1 / 120) {
      eyesAt(state, now);
      blinks.push(state.shown);
    }

    expect(blinks).toContain(0);
    expect(blinks).toContain(1);
  });

  it('rushes in, leaning into the charge and rocking back out of the skid', () => {
    const charging = poseIn(0.6);
    const skidding = poseIn(0.95);
    const settled = poseIn(3);

    expect(charging.lean).toBeGreaterThan(0.1);
    expect(skidding.lean).toBeLessThan(-0.1);
    expect(settled.lean).toBeCloseTo(0, 5);
    // It bursts into frame rather than easing in, and is on its mark inside two seconds.
    expect(Math.hypot(charging.x - MARK[0], charging.y - MARK[1])).toBeLessThan(offFrameDistance(FRAME) * 0.75);
    expect(Math.hypot(poseIn(1.7).x - MARK[0], poseIn(1.7).y - MARK[1])).toBeLessThan(0.2);
  });

  it('comes in from deep behind the mark, on a diagonal, and is off frame at both ends', () => {
    const reach = offFrameDistance(FRAME);
    const entrance = poseIn(0);
    const exit = poseIn(TAKE_SECONDS - 0.01);

    // Off frame at both ends, measured through the lens rather than assumed from the frame's width.
    expect(Math.abs(framePosition(entrance.x, entrance.y, FRAME))).toBeGreaterThan(1);
    expect(Math.abs(framePosition(exit.x, exit.y, FRAME))).toBeGreaterThan(1);
    // It starts further from the lens than it finishes, so it arrives out of the blur.
    const depth = (pose: Pose) => Math.hypot(pose.x - CAMERA.position[0], pose.y - CAMERA.position[1]);
    expect(depth(entrance)).toBeGreaterThan(depth(poseIn(4)) + 3);
    expect(reach).toBeGreaterThan(6);
  });

  it('whips past the lens and settles back onto it on every turn', () => {
    const turns = [1.9, 10.35];

    for (const at of turns) expect(poseIn(at).look).toBeGreaterThan(1.1);

    // It waits a beat after halting before it remembers, then snaps round faster than it turned away.
    expect(poseIn(9.8).look).toBe(0);
    expect(10.35 - 10).toBeLessThan(8.6 - 8.1);

    for (const card of CARDS) expect(poseIn((card.from + card.until) / 2).look).toBe(1);
  });

  it('knocks the lens when it lands, hardest on the way in', () => {
    const world = startFilm();
    play(world, 0.5);

    expect(world.get(Lens)!.force).toBe(0);

    play(world, 1.6);
    const landing = world.get(Lens)!;

    expect(landing.force).toBe(SHOCKS[0]!.force);
    expect(landing.shookAt).toBeGreaterThan(0);
    expect(SHOCKS[0]!.force).toBeGreaterThan(SHOCKS[1]!.force);
  });

  it('never jumps: the rig is continuous from one frame to the next for a whole take', () => {
    const world = startFilm();
    const pose = () => ({ ...read(world).pose });
    let previous = pose();
    let move = 0;
    let turn = 0;
    let lean = 0;

    // Once the take is running, nothing about the rig may step. A beat handing over to the next one used to flip
    // the lean its full range in a single frame, which read as the robot popping as it arrived.
    play(world, 0.7);
    previous = pose();

    play(world, TAKE_SECONDS - 1, () => {
      const now = pose();

      if (read(world).time === undefined) return;

      move = Math.max(move, Math.hypot(now.x - previous.x, now.y - previous.y));
      turn = Math.max(turn, Math.abs(now.heading - previous.heading));
      lean = Math.max(lean, Math.abs(now.lean - previous.lean));
      previous = now;
    });

    expect(lean).toBeLessThan(0.06);
    expect(turn).toBeLessThan(0.12);
    expect(move).toBeLessThan(0.45);
  });

  it('signs off with hearts that beat where they stand', () => {
    const closing = CARDS.at(-1)!;

    expect(closing.beating).toBe(true);
    expect(closing.text).toMatch(/^<3(3*)( <33*)*$/);
    // Nothing before it beats, so the beat reads as the sign-off rather than as the display's habit.
    expect(CARDS.slice(0, -1).every((card) => card.beating !== true)).toBe(true);
  });

  it('plays take after take without being asked twice', () => {
    const world = startFilm();
    const takes = new Set<number>();
    play(world, TAKE_SECONDS * 2.4, (robot) => takes.add(robot.takes));

    expect(read(world).takes).toBeGreaterThanOrEqual(2);
    expect(takes.size).toBeGreaterThanOrEqual(2);
  });

  it('kicks up dust while it is rolling and lets it settle once it has stopped', () => {
    const world = startFilm();
    let moving = 0;
    play(world, CARDS[0]!.from, (robot) => {
      moving = Math.max(moving, robot.dust.particles.filter((particle) => particle.age < particle.life).length);
    });

    expect(moving).toBeGreaterThan(8);

    play(world, GREETING.at(-1)!.until - CARDS[0]!.from);
    const resting = read(world).dust.particles.filter((particle) => particle.age < particle.life).length;

    expect(resting).toBe(0);
  });

  it('shoves the icon floor as it rolls over it and thumps it when it brakes', () => {
    const world = startFilm();
    // Before the take is called the robot is nowhere, and the floor is perfectly still.
    play(world, 0.5);
    const sheets = world.query(IconField);
    const resting = sheets.map((entity) => displacement(entity.get(IconField)!.lattice!));

    expect(resting.every((amount) => amount === 0)).toBe(true);
    expect(world.get(Shocks)!.next).toBe(1);

    // By the time it has braked on the mark it has shoved the cells it rolled past and thumped both sheets.
    play(world, 2.6);
    const pushed = sheets.map((entity) => displacement(entity.get(IconField)!.lattice!));

    expect(pushed.every((amount) => amount > 0.01)).toBe(true);
    expect(world.get(Shocks)!.next).toBeGreaterThan(1);
  });

  it('flips a motif to a spare glyph without ever showing two cells the same choice twice', () => {
    const world = startFilm();
    const sheet = world.query(IconField)[0]!;
    const before = Int32Array.from(sheet.get(IconField)!.lattice!.selected);
    play(world, 6);
    const after = sheet.get(IconField)!.lattice!.selected;

    expect(Array.from(after)).not.toEqual(Array.from(before));
    expect(new Set(sheet.get(IconField)!.lattice!.motifGlyphs).size).toBe(
      sheet.get(IconField)!.lattice!.motifGlyphs.length,
    );
  });
});

/** Total distance the lattice's cells sit from their rest positions. */
function displacement(lattice: { x: Float32Array; y: Float32Array }): number {
  let total = 0;

  for (let index = 0; index < lattice.x.length; index++) total += Math.hypot(lattice.x[index]!, lattice.y[index]!);

  return total;
}
