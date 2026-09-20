import type { Entity, World } from 'koota';
import { clamp, mat4, quat, vec3, type Mat4, type Quat, type Vec3 } from 'math';
import { Time } from '../time/traits';
import { Viewport } from '../juggler/traits';
import { GRAVITY, figure, FONT_SIZE, timeToPlane, type Side } from '../juggler/utils';
import { RELEASE_HOP, RELEASE_INTERVAL, letterActions } from './actions';
import { Debris, DebrisView, FlameView, Letter, LetterView, Paragraph, Release } from './traits';
import { encodeLetterStyle, FLAME_CAPACITY } from './materials';

/** How long a struck letter takes to cool from white-hot to steel. */
export const COOL_SECONDS = 1.6;
/** A released letter takes this long to pick up its colour. */
const TINT_SECONDS = 0.5;

export function ageLetters(world: World): void {
  const { delta } = world.get(Time)!;

  world.query(Letter).updateEach(([letter]) => {
    letter.age += delta;

    if (letter.released >= 0) letter.released += delta;

    if (letter.died >= 0) letter.died += delta;
  });
}

/** Dropped letters explode the moment they hit the floor. */
export function explodeLetters(world: World): void {
  const landed: Entity[] = [];

  for (const entity of world.query(Letter)) {
    if (entity.get(Letter)!.died >= 0) landed.push(entity);
  }

  for (const entity of landed) letterActions(world).explodeLetter(entity);
}

/** Shards fly, spin, fall, and fade; spent ones are swapped out so the arrays stay packed. */
export function moveDebris(world: World): void {
  const { delta } = world.get(Time)!;
  const debris = world.get(Debris)!;
  const floor = figure(world.get(Viewport)!.height).floorY;
  let index = 0;

  while (index < debris.count) {
    debris.life[index]! -= delta * 1.4;

    if (debris.life[index]! <= 0) {
      const last = debris.count - 1;

      for (const column of [
        debris.x,
        debris.y,
        debris.vx,
        debris.vy,
        debris.angle,
        debris.spin,
        debris.size,
        debris.life,
        debris.hue,
      ]) {
        column[index] = column[last]!;
      }

      debris.count -= 1;
      continue;
    }

    debris.vy[index]! -= GRAVITY * delta;
    debris.x[index]! += debris.vx[index]! * delta;
    debris.y[index]! += debris.vy[index]! * delta;
    debris.angle[index]! += debris.spin[index]! * delta;

    if (debris.y[index]! < floor) {
      debris.y[index] = floor;
      debris.vy[index] = -debris.vy[index]! * 0.35;
      debris.vx[index]! *= 0.7;
    }

    index += 1;
  }

  world.set(Debris, debris);
}

const _debris_matrix: Mat4 = mat4.create();
const _debris_rotation: Quat = quat.create();
const _debris_position: Vec3 = vec3.create();
const _debris_scale: Vec3 = vec3.create();
const _debris_axis: Vec3 = [0, 0, 1];

export function syncDebrisView(world: World): void {
  const view = world.get(DebrisView);

  if (view === undefined) return;

  const debris = world.get(Debris)!;
  const matrices = view.mesh.instanceMatrix.array as Float32Array;
  const data = view.data.array as Float32Array;

  for (let index = 0; index < debris.count; index += 1) {
    quat.setAxisAngle(_debris_rotation, _debris_axis, debris.angle[index]!);
    vec3.set(_debris_position, debris.x[index]!, debris.y[index]!, 0.5);
    vec3.set(_debris_scale, debris.size[index]!, debris.size[index]! * 0.6, 1);
    mat4.fromRotationTranslationScale(_debris_matrix, _debris_rotation, _debris_position, _debris_scale);
    matrices.set(_debris_matrix, index * 16);
    data[index * 2] = debris.hue[index]!;
    data[index * 2 + 1] = debris.life[index]!;
  }

  view.mesh.count = debris.count;
  view.mesh.instanceMatrix.needsUpdate = true;
  view.data.needsUpdate = true;
}

/** Drops come faster the more letters wait, so typing ahead never stacks the sentence deep. */
export function releaseInterval(queued: number): number {
  return clamp((RELEASE_INTERVAL * 6) / Math.max(queued, 1), 0.1, RELEASE_INTERVAL);
}

/**
 * The sentence drops its earliest waiting letter on the release timer, toward whichever hand has the widest gap in
 * its arrivals around the moment the letter will land, so two letters never reach one hand together.
 */
export function releaseLetters(world: World): void {
  const { delta } = world.get(Time)!;
  const { catchY } = figure(world.get(Viewport)!.height);
  let earliest: Entity | undefined;
  let earliestIndex = Number.POSITIVE_INFINITY;
  let queued = 0;

  for (const entity of world.query(Letter)) {
    const letter = entity.get(Letter)!;

    if (letter.state !== 'queued') continue;

    queued += 1;

    if (letter.index < earliestIndex) {
      earliest = entity;
      earliestIndex = letter.index;
    }
  }

  if (earliest === undefined) return;

  const release = world.get(Release)!;
  release.timer -= delta;
  world.set(Release, release);

  if (release.timer > 0) return;

  release.timer = releaseInterval(queued);
  world.set(Release, release);
  const landing = timeToPlane(earliest.get(Letter)!.y, RELEASE_HOP, catchY);
  const gap: Record<Side, number> = { left: Number.POSITIVE_INFINITY, right: Number.POSITIVE_INFINITY };
  const load: Record<Side, number> = { left: 0, right: 0 };

  for (const entity of world.query(Letter)) {
    const letter = entity.get(Letter)!;

    if (letter.state !== 'airborne' && letter.state !== 'held') continue;

    load[letter.target] += 1;
    const arrival = letter.state === 'held' ? 0 : timeToPlane(letter.y, letter.vy, catchY);
    gap[letter.target] = Math.min(gap[letter.target], Math.abs(arrival - landing));
  }

  const side: Side =
    gap.left === gap.right ? (load.left <= load.right ? 'left' : 'right') : gap.left > gap.right ? 'left' : 'right';
  letterActions(world).releaseLetter(earliest, side);
}

export function fallLetters(world: World): void {
  const { delta } = world.get(Time)!;
  const floor = figure(world.get(Viewport)!.height).floorY + FONT_SIZE * 0.3;

  world.query(Letter).updateEach(([letter]) => {
    if ((letter.state !== 'airborne' && letter.state !== 'dead') || letter.died >= 0) return;

    letter.vy -= GRAVITY * delta;
    letter.x += letter.vx * delta;
    letter.y += letter.vy * delta;
    letter.rotation += letter.spin * delta;

    if (letter.state === 'dead' && letter.y <= floor && letter.died < 0) {
      letter.y = floor;
      letter.vx = 0;
      letter.vy = 0;
      letter.spin = 0;
      letter.died = 0;
    }
  });
}

/** Where the paragraph's origin sits in the view: left edge of the centred column, top line. */
export function paragraphOrigin(out: [number, number], width: number, height: number): [number, number] {
  out[0] = -paragraphWidth(width) / 2;
  out[1] = figure(height).topY + FONT_SIZE * 0.5;

  return out;
}

export function paragraphWidth(viewportWidth: number): number {
  return Math.max(viewportWidth - 96, 1);
}

/**
 * The first line that still holds a waiting letter scrolls to the top; letters release in order, so the lines above
 * it are already empty. A letter dropping out kicks the sentence upward.
 */
export function scrollParagraph(world: World): void {
  const { delta } = world.get(Time)!;
  const paragraph = world.get(Paragraph)!;
  const release = world.get(Release)!;

  if (release.count !== paragraph.seenReleases) {
    paragraph.seenReleases = release.count;
    paragraph.kick = 7;
  }

  paragraph.kick *= Math.exp(-12 * delta);
  let firstLine = Number.POSITIVE_INFINITY;

  for (const entity of world.query(Letter)) {
    const letter = entity.get(Letter)!;

    if (letter.state === 'queued' && letter.placed) firstLine = Math.min(firstLine, letter.line);
  }

  const lift = Number.isFinite(firstLine)
    ? (paragraph.baselines[firstLine] ?? 0) - (paragraph.baselines[0] ?? 0)
    : paragraph.scroll;
  paragraph.scroll += (lift - paragraph.scroll) * (1 - Math.exp(-8 * delta));
  world.set(Paragraph, paragraph);
}

const _seat_origin: [number, number] = [0, 0];

/** Waiting letters sit on their glyphs' ink centres, following the paragraph as it scrolls and kicks. */
export function seatLetters(world: World): void {
  const { width, height } = world.get(Viewport)!;
  const { scroll, kick } = world.get(Paragraph)!;
  const [originX, originY] = paragraphOrigin(_seat_origin, width, height);

  world.query(Letter).updateEach(([letter]) => {
    if (letter.state !== 'queued' || !letter.placed) return;

    letter.x = originX + letter.homeX;
    letter.y = originY + scroll + kick + letter.homeY;
  });
}

export function letterHeat(age: number): number {
  return 1 - clamp(age / COOL_SECONDS, 0, 1);
}

/** Poses each mounted glyph from its letter and writes its heat and tint into the glyph's style when they change. */
export function syncLetterViews(world: World): void {
  world.query(Letter, LetterView).updateEach(([letter, view]) => {
    if (view === undefined) return;

    const { group, text } = view;

    if (!view.centered && text.commitState().status === 'committed') {
      const ink = text.computeBoundingBox();

      if (ink.max.x > ink.min.x) {
        text.position.set(-(ink.min.x + ink.max.x) / 2, -(ink.min.y + ink.max.y) / 2, 0);
        view.centered = true;
      }
    }

    group.visible = letter.placed || letter.released >= 0;
    group.position.set(letter.x, letter.y, 0);
    group.rotation.z = letter.rotation;
    // Struck with force: the letter lands oversized and springs to rest; leaving, it squashes and stretches.
    const strike = 0.45 * Math.exp(-9 * letter.age) * Math.cos(16 * letter.age);
    const boing = letter.released >= 0 ? 0.28 * Math.exp(-7 * letter.released) * Math.sin(22 * letter.released) : 0;
    group.scale.set(1 + strike + boing, 1 + strike - boing, 1);

    // Quantized so a cooling letter rewrites its style a few dozen times, not every frame.
    const heat = Math.round(letterHeat(letter.age) * 100) / 100;
    const blend = letter.released >= 0 ? Math.round(clamp(letter.released / TINT_SECONDS, 0, 1) * 100) / 100 : 0;

    if (heat === view.heat && blend === view.blend) return;

    view.heat = heat;
    view.blend = blend;
    text.style = encodeLetterStyle(heat, blend, letter.index);
  });
}

const _flame_matrix: Mat4 = mat4.create();
const _flame_rotation: Quat = quat.create();
const _flame_position: Vec3 = vec3.create();
const _flame_scale: Vec3 = vec3.create();

/** One instanced quad of flames per hot letter, drawn behind it and dying out as the letter cools or leaves. */
export function syncFlames(world: World): void {
  const view = world.get(FlameView);

  if (view === undefined) return;

  const matrices = view.mesh.instanceMatrix.array as Float32Array;
  const data = view.data.array as Float32Array;
  let count = 0;

  for (const entity of world.query(Letter)) {
    if (count >= FLAME_CAPACITY) break;

    const letter = entity.get(Letter)!;
    const heat = letterHeat(letter.age);
    const visible = letter.placed || letter.released >= 0;

    if (!visible || heat <= 0.5) continue;

    quat.identity(_flame_rotation);
    vec3.set(_flame_position, letter.x, letter.y + FONT_SIZE * 0.55, -0.5);
    vec3.set(_flame_scale, FONT_SIZE * 1.9, FONT_SIZE * 2.6, 1);
    mat4.fromRotationTranslationScale(_flame_matrix, _flame_rotation, _flame_position, _flame_scale);
    matrices.set(_flame_matrix, count * 16);
    const fade = letter.released >= 0 ? 1 - clamp(letter.released / TINT_SECONDS, 0, 1) : 1;
    data.set([heat, fade, (letter.index * 7.31) % 97, 0], count * 4);
    count += 1;
  }

  view.mesh.count = count;
  view.mesh.instanceMatrix.needsUpdate = true;
  view.data.needsUpdate = true;
}
