import type { World } from 'koota';
import { spring } from 'math/time';
import { CLEARANCE, EXCLUSION_SIDES } from '../stone/content';
import { Stone } from '../stone/traits';
import { Quality } from '../quality/traits';
import { Time } from '../time/traits';
import { PULL_BOX } from './content';
import { BodyView, DropCap, Letterpress, Script, Spread } from './traits';
import {
  BODY_HEIGHT,
  BODY_ORIGIN,
  REST,
  RETURNING,
  SPRING,
  bodyFlow,
  columnBoxes,
  originalOffsets,
  pageToWorldX,
  pageToWorldY,
  pullBox,
  type Box,
  type Disc,
} from './utils';

const columnSpring = spring.create();
const widthSpring = spring.create();
const pull: Box = { left: 0, top: 0, right: 0, bottom: 0 };
const disc: Disc = { x: 0, y: 0, radius: 0 };

/**
 * Carry the column count and the page width to where they were asked to be, on springs that overshoot a little,
 * as a gutter let go of would. A held spread follows its hand instead. The page's light and ink ease the same way.
 */
export function springSpread(world: World): void {
  const spread = world.get(Spread)!;
  const { delta } = world.get(Time)!;
  const still = world.get(Quality)!.reducedMotion;
  let { columns, columnsVelocity, width, widthVelocity, geometry } = spread;

  if (!spread.held) {
    if (still) {
      if (columns !== spread.columnsTarget || width !== spread.widthTarget) geometry++;

      columns = spread.columnsTarget;
      width = spread.widthTarget;
      columnsVelocity = 0;
      widthVelocity = 0;
    } else {
      columnSpring.value = columns;
      columnSpring.velocity = columnsVelocity;
      spring.update(columnSpring, spread.columnsTarget, 0.62, 0.58, delta);
      widthSpring.value = width;
      widthSpring.velocity = widthVelocity;
      spring.update(widthSpring, spread.widthTarget, 0.7, 0.62, delta);
      const settledColumns =
        Math.abs(columnSpring.value - spread.columnsTarget) < 1.5e-3 && Math.abs(columnSpring.velocity) < 1e-2;
      const settledWidth =
        Math.abs(widthSpring.value - spread.widthTarget) < 4e-3 && Math.abs(widthSpring.velocity) < 2e-2;
      const nextColumns = settledColumns ? spread.columnsTarget : columnSpring.value;
      const nextWidth = settledWidth ? spread.widthTarget : widthSpring.value;

      if (nextColumns !== columns || nextWidth !== width) geometry++;

      columns = nextColumns;
      width = nextWidth;
      columnsVelocity = settledColumns ? 0 : columnSpring.velocity;
      widthVelocity = settledWidth ? 0 : widthSpring.velocity;
    }
  }

  const ease = still ? 1 : 1 - Math.exp(-delta * 1.6);
  world.set(Spread, {
    columns,
    columnsVelocity,
    width,
    widthVelocity,
    geometry,
    light: spread.light + (spread.lightTarget - spread.light) * ease,
    ink: spread.ink + (spread.inkTarget - spread.ink) * (still ? 1 : Math.min(1, delta * 0.55)),
  });
}

/**
 * Move every letter that is not where the layout wants it. A displaced letter rides an underdamped spring of its
 * own rate to its target, so a re-broken line arrives a little apart and settles; a letter being given back is
 * carried the same way from wherever it fell, turning upright and growing back as it comes.
 */
export function springLetters(world: World): void {
  const letters = world.get(Letterpress)!;

  if (letters.moving === 0) return;

  const { delta, elapsed } = world.get(Time)!;
  const step = Math.min(delta, 1 / 30);
  let moving = 0;

  for (let index = 0; index < letters.count; index++) {
    const state = letters.state[index]!;

    if (state === REST) continue;

    moving++;

    if (state !== SPRING && state !== RETURNING) continue;

    if (state === RETURNING && elapsed < letters.startAt[index]!) continue;

    const returning = state === RETURNING;
    const stiffness = returning ? 46 : letters.stiffness[index]!;
    const damping = 2 * Math.sqrt(stiffness) * (returning ? 0.86 : 0.7);
    const dx = letters.x[index]! - letters.targetX[index]!;
    const dy = letters.y[index]! - letters.targetY[index]!;
    const vx = letters.vx[index]! + (-stiffness * dx - damping * letters.vx[index]!) * step;
    const vy = letters.vy[index]! + (-stiffness * dy - damping * letters.vy[index]!) * step;
    letters.vx[index] = vx;
    letters.vy[index] = vy;
    letters.x[index]! += vx * step;
    letters.y[index]! += vy * step;

    if (returning) {
      const settle = 1 - Math.exp(-step * 5);
      // The nearest upright: a letter that tumbled round twice does not unwind both turns.
      const upright = Math.round(letters.angle[index]! / (Math.PI * 2)) * Math.PI * 2;
      letters.angle[index]! += (upright - letters.angle[index]!) * settle;
      letters.scale[index]! += (1 - letters.scale[index]!) * settle;
    }

    if (dx * dx + dy * dy < 4e-6 && vx * vx + vy * vy < 1e-4 && (!returning || letters.scale[index]! > 0.995)) {
      letters.x[index] = letters.targetX[index]!;
      letters.y[index] = letters.targetY[index]!;
      letters.vx[index] = 0;
      letters.vy[index] = 0;
      letters.angle[index] = 0;
      letters.scale[index] = 1;
      letters.state[index] = REST;
      letters.flush[index] = 1;
      moving--;
    }
  }

  letters.moving = moving;
}

/** State the exact edits the script queued, in order, so the engine's text is the original less what was taken. */
export function applyScriptEdits(world: World): void {
  const view = world.get(BodyView);
  const script = world.get(Script)!;

  if (view === undefined || script.edits.length === 0) return;

  for (const edit of script.edits) view.text.replace(edit.start, edit.end, edit.insert);

  script.edits.length = 0;
  view.layoutDirty = true;
}

/**
 * State the body's flow whenever the columns, the width, or the stone moved: the column boxes, less the pull quote
 * and the stone's disc. This is the whole of a reflow as the page sees it. The engine does the rest.
 */
export function syncFlow(world: World): void {
  const view = world.get(BodyView);

  if (view === undefined) return;

  const spread = world.get(Spread)!;
  const stone = world.get(Stone)!;
  const radius = stone.horizon * CLEARANCE * stone.presence;
  // The disc is restated when it has moved a hundredth of a unit, which is finer than a letter can show.
  const stoneKey =
    radius < 0.08
      ? 0
      : Math.round(stone.x * 100) * 4099 + Math.round(stone.y * 100) * 131 + Math.round(radius * 100) + 1;

  if (view.statedGeometry === spread.geometry && view.statedStone === stoneKey) return;

  view.statedGeometry = spread.geometry;
  view.statedStone = stoneKey;
  view.boxCount = columnBoxes(view.boxes, spread.columns, spread.width, BODY_HEIGHT);
  const measure = view.boxes[0]!.right - view.boxes[0]!.left;

  // Measure before publishing: the quote is set at the new measure and read at once, and the body's flow steps
  // around the height it reports, all before the frame that draws either.
  if (measure !== view.quoteMeasure) {
    view.quoteMeasure = measure;
    view.quote.constraints = { width: { mode: 'exact', size: measure } };
    view.quoteHeight = view.quote.measure().height;
  }

  pullBox(pull, spread.width, BODY_HEIGHT, measure, view.quoteHeight);
  view.quote.position.set(
    pageToWorldX(BODY_ORIGIN.x + pull.left),
    pageToWorldY(BODY_ORIGIN.y + pull.top + PULL_BOX.padding),
    0.01,
  );
  disc.x = stone.x - BODY_ORIGIN.x;
  disc.y = stone.y - BODY_ORIGIN.y;
  disc.radius = radius;
  view.text.flow = bodyFlow(view.boxes, view.boxCount, pull, stoneKey === 0 ? undefined : disc, EXCLUSION_SIDES);
  view.layoutDirty = true;
  const rules = view.uniforms.uRules.array as number[];

  for (let index = 0; index < rules.length; index++) {
    const box = view.boxes[index];
    const next = view.boxes[index + 1];
    // A rule runs down the middle of each gutter. Unused slots sit far off the page.
    rules[index] =
      index + 1 < view.boxCount && box !== undefined && next !== undefined
        ? pageToWorldX(BODY_ORIGIN.x + (box.right + next.left) / 2)
        : 1e6;
  }
}

/**
 * Read where the layout now puts every letter and make that its target. The read is the reflow: the engine
 * prepares the paragraph for the stated flow and text, and its cost is what the readout shows. A letter is found
 * by its identity, the offset of the original text it was split from, so letters keep their own springs through a
 * reflow and through other letters leaving and returning.
 */
export function readLayout(world: World): void {
  const view = world.get(BodyView);

  if (view === undefined || !view.layoutDirty) return;

  view.layoutDirty = false;
  const spread = world.get(Spread)!;
  const before = performance.now();

  if (spread.mode === 'direct' || view.glyphs === undefined) {
    const { lineCount } = view.text.measure();
    world.set(Spread, { reflowMs: performance.now() - before, lines: lineCount });

    return;
  }

  const layout = view.text.glyphs();
  world.set(Spread, { reflowMs: performance.now() - before, lines: layout.lineCount });
  const letters = world.get(Letterpress)!;
  const script = world.get(Script)!;

  if (view.originalsRevision !== script.revision) {
    view.originalsRevision = script.revision;
    originalOffsets(view.originals, script);
  }

  const springs = !world.get(Quality)!.reducedMotion;
  const { clusters, x, y } = layout;
  let previous = -1;
  let letter = -1;

  for (let glyph = 0; glyph < clusters.length; glyph++) {
    const original = view.originals[clusters[glyph]!]!;
    // Glyphs of one cluster follow one another in the detached order as they do here.
    letter = original === previous && letter >= 0 ? letter + 1 : view.byCluster[original]!;
    previous = original;

    if (letter < 0 || letter >= letters.count || letters.cluster[letter] !== original) {
      letter = -1;
      continue;
    }

    const targetX = x[glyph]!;
    const targetY = y[glyph]!;

    if (letters.targetX[letter] === targetX && letters.targetY[letter] === targetY) continue;

    letters.targetX[letter] = targetX;
    letters.targetY[letter] = targetY;
    const state = letters.state[letter]!;

    if (state === REST) {
      if (springs) {
        letters.state[letter] = SPRING;
        letters.moving++;
      } else {
        letters.x[letter] = targetX;
        letters.y[letter] = targetY;
        letters.flush[letter] = 1;
      }
    }
  }
}

/** Write each moving letter's pose into its glyph: a turn and a scale about its ink centre, then its place. */
export function writeLetters(world: World): void {
  const view = world.get(BodyView);
  const letters = world.get(Letterpress)!;

  if (view?.glyphs === undefined || letters.count === 0) return;

  const elements = view.matrix.elements;

  for (let index = 0; index < letters.count; index++) {
    if (letters.state[index] === REST) {
      if (letters.flush[index] === 0) continue;

      letters.flush[index] = 0;
    }

    const scale = letters.scale[index]!;
    const cos = Math.cos(letters.angle[index]!) * scale;
    const sin = Math.sin(letters.angle[index]!) * scale;
    // Body-local runs y down; the glyphs' own space runs y up.
    const pivotX = letters.pivotX[index]!;
    const pivotY = -letters.pivotY[index]!;
    elements[0] = cos;
    elements[1] = sin;
    elements[4] = -sin;
    elements[5] = cos;
    elements[12] = letters.x[index]! + pivotX - (cos * pivotX - sin * pivotY);
    elements[13] = -letters.y[index]! + pivotY - (sin * pivotX + cos * pivotY);
    view.glyphs.setMatrixAt(index, view.matrix);
  }
}

/** Show the letters or the paragraph, whichever the spread's mode draws, and hand the shaders the page's light. */
export function syncPageView(world: World): void {
  const view = world.get(BodyView);

  if (view === undefined) return;

  const spread = world.get(Spread)!;
  view.uniforms.uLight.value = spread.light;
  view.uniforms.uInk.value = spread.ink;
  view.uniforms.uTime.value = world.get(Time)!.elapsed;

  if (!world.get(Quality)!.reducedMotion) view.uniforms.uGrain.value = world.get(Time)!.elapsed;

  view.uniforms.uBodyRight.value = pageToWorldX(BODY_ORIGIN.x + spread.width);
  const letters = world.get(Letterpress)!;

  // The drop cap is the first letter, wherever the layout has it now.
  if (letters.count > 0) {
    world.set(DropCap, {
      x: BODY_ORIGIN.x + letters.x[0]! + letters.pivotX[0]!,
      y: BODY_ORIGIN.y + letters.y[0]! + letters.pivotY[0]!,
    });
  }

  const detached = spread.mode === 'detached' && view.glyphs !== undefined;
  view.text.visible = !detached;

  if (view.glyphs !== undefined) view.glyphs.visible = detached;
}
