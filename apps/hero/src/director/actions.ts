import { BlendCurves } from '@pmndrs/klipp';
import { createActions } from 'koota';
import { cameraActions } from '../camera/actions';
import { DIVE_SECONDS } from '../camera/content';
import { Shot } from '../camera/traits';
import { editorActions } from '../editor/actions';
import { BODY_FIELD, Caret } from '../editor/traits';
import { pageActions } from '../page/actions';
import { BODY, COLUMN_RANGE, GUTTER, SPECIMENS, TYPED_LINE } from '../page/content';
import { Spread } from '../page/traits';
import { BODY_HEIGHT, BODY_ORIGIN, BODY_WIDTH, columnBoxes, type Box } from '../page/utils';
import { qualityActions } from '../quality/actions';
import { sequenceActions } from '../sequence/actions';
import type { Cue } from '../sequence/traits';
import { stoneActions } from '../stone/actions';
import { Stone } from '../stone/traits';
import { Time } from '../time/traits';
import { titleActions } from '../title/actions';
import { STONE_REST } from './content';
import { Grip, Mode } from './traits';

const boxes: Box[] = [];

export const directorActions = createActions((world) => {
  const camera = cameraActions(world);
  const page = pageActions(world);
  const stone = stoneActions(world);
  const editor = editorActions(world);
  const title = titleActions(world);

  /** The letters must be drawn one by one before anything may move them. */
  function detachBody(): void {
    if (world.get(Caret)!.field === BODY_FIELD) editor.hideCaret();

    page.setBodyMode('detached');
  }

  /** The paragraph must be whole and drawn as the engine sets it before the caret may enter it. */
  function attachBody(): void {
    stone.rewindStone(true);
    page.settleLetters();
    page.setBodyMode('direct');
  }

  /**
   * The attract loop: one shot, from the caret on a black field to the dive through the drop cap, which lands
   * back on the caret. Beats after the headline are timed from the moment its last letter lands.
   */
  function script(): Cue[] {
    const after = (seconds: number, run: () => void): Cue => ({ on: 'headline-set', after: seconds, run });
    // An offset inside the Arabic word of the first specimen: between its second and third letters.
    const arabic = SPECIMENS[0]!.text.search(/\p{Script=Arabic}/u) + 2;

    return [
      { at: 1.3, run: () => title.startTyping() },
      // The spread: the crane pulls back as the room's light comes up and the ink arrives.
      after(0.8, () => {
        camera.blendTo('crane', 6.2);
        page.setPageLight(1);
        page.setInk(1);
      }),
      after(3.4, () => editor.hideCaret()),
      // Editorial columns: three, two, four, and back.
      after(7.6, () => camera.blendTo('columns', 3.4)),
      after(9.8, () => page.setColumns(2)),
      after(13.4, () => page.setColumns(4)),
      after(17.6, () => page.setColumns(3)),
      // The stone.
      after(19.6, () => {
        directorActions(world).walkStone();
        camera.blendTo('stone', 3.2);
      }),
      // Rewind.
      after(31.4, () => {
        world.set(Mode, { pathSince: -1 });
        stone.releaseStone(0, 0);
        stone.rewindStone();
      }),
      // Edit: a click at the end of the essay, a sentence typed, then a click inside an Arabic word.
      after(35.2, () => {
        stone.dismissStone();
        attachBody();
        editor.placeCaret(BODY_FIELD, BODY.length);
        camera.blendTo('edit', 3.4);
      }),
      after(38.2, () => editor.typeText(TYPED_LINE)),
      after(42.2, () => editor.placeCaret(1, arabic)),
      after(43.9, () => editor.moveCaret('left')),
      after(44.5, () => editor.moveCaret('left')),
      after(45.3, () => editor.moveCaret('right')),
      // The dive.
      after(46.6, () => {
        editor.hideCaret();
        camera.blendTo('dive', 2.8, BlendCurves.easeInOut);
        camera.driveDive(1, 1 / DIVE_SECONDS);
      }),
      { on: 'dive-through', run: () => directorActions(world).beginAttract() },
    ];
  }

  /** Whatever the visitor did, the page is theirs from now. */
  function takeOver(): void {
    world.set(Mode, { touchedAt: world.get(Time)!.elapsed });

    if (world.get(Mode)!.kind === 'play') return;

    world.set(Mode, { kind: 'play', pathSince: -1 });
    sequenceActions(world).loadSequence([{ on: 'dive-through', run: () => directorActions(world).beginAttract() }]);
    title.completeHeadline();
    page.setPageLight(1);
    page.setInk(1, true);
    page.releaseSpread();
    editor.hideCaret();

    if (world.get(Stone)!.present) stone.releaseStone(0, 0);
    else stone.dropStone(STONE_REST[0], STONE_REST[1]);

    camera.driveDive(0, 1.5);
    camera.blendTo('free', 1.6);
  }

  return {
    initializeScene: () => {
      cameraActions(world).initializeCamera();
      directorActions(world).beginAttract();
    },
    /** Start the attract loop from the caret: everything the last pass changed is put back first. */
    beginAttract: () => {
      // The loop's cut is the one moment the canvas may be rebuilt for another tier without it showing.
      qualityActions(world).grantPendingTier();
      world.set(Mode, { kind: 'attract', pathSince: -1 });
      world.set(Grip, { kind: 'none' });
      editor.eraseTyped();
      stone.rewindStone(true);
      stone.dismissStone();
      page.settleLetters();
      page.setBodyMode('detached');
      page.holdColumns(COLUMN_RANGE.initial);
      page.holdWidth(BODY_WIDTH);
      page.releaseSpread();
      page.setPageLight(0, true);
      page.setInk(0, true);
      title.clearHeadline();
      camera.resetDive();
      camera.blendTo('caret', 0);
      sequenceActions(world).loadSequence(script());
    },
    /** Drop the stone at the head of its path and lead it along. */
    walkStone: () => {
      detachBody();
      world.set(Mode, { pathSince: world.get(Time)!.elapsed });
    },
    /**
     * A press on the page, in page units. It takes hold of the stone if it lands on it, of the page's edge or a
     * gutter if it lands on one, and otherwise waits to see whether it is a click.
     */
    pressPage: (x: number, y: number) => {
      takeOver();
      const spread = world.get(Spread)!;
      const hole = world.get(Stone)!;
      const { elapsed } = world.get(Time)!;
      const grip = { x, y, travelled: 0, vx: 0, vy: 0, at: elapsed };
      const localX = x - BODY_ORIGIN.x;
      const within = y > BODY_ORIGIN.y - 0.4 && y < BODY_ORIGIN.y + BODY_HEIGHT + 0.4;

      if (hole.present && Math.hypot(x - hole.x, y - hole.y) < hole.horizon * 2.6) {
        detachBody();
        stone.leadStone(x, y);
        world.set(Grip, { ...grip, kind: 'stone' });

        return;
      }

      if (within && Math.abs(localX - spread.width) < 0.55) {
        detachBody();
        world.set(Grip, { ...grip, kind: 'edge' });

        return;
      }

      const count = within ? columnBoxes(boxes, spread.columns, spread.width, BODY_HEIGHT) : 0;

      for (let index = 0; index + 1 < count; index++) {
        if (localX > boxes[index]!.right - 0.25 && localX < boxes[index + 1]!.left + 0.25) {
          detachBody();
          world.set(Grip, { ...grip, kind: 'gutter', gutter: index + 1 });

          return;
        }
      }

      world.set(Grip, { ...grip, kind: 'page' });
    },
    /** The pointer moved while pressed. */
    dragPage: (x: number, y: number) => {
      const grip = world.get(Grip)!;

      if (grip.kind === 'none') return;

      const { elapsed } = world.get(Time)!;
      const spread = world.get(Spread)!;
      const seconds = Math.max(elapsed - grip.at, 1 / 240);
      const blend = Math.min(1, seconds * 14);
      world.set(Grip, {
        x,
        y,
        travelled: grip.travelled + Math.hypot(x - grip.x, y - grip.y),
        vx: grip.vx + ((x - grip.x) / seconds - grip.vx) * blend,
        vy: grip.vy + ((y - grip.y) / seconds - grip.vy) * blend,
        at: elapsed,
      });
      world.set(Mode, { touchedAt: elapsed });

      if (grip.kind === 'stone') stone.leadStone(x, y);
      else if (grip.kind === 'edge') page.holdWidth(x - BODY_ORIGIN.x);
      else if (grip.kind === 'gutter') {
        // The count that puts this gutter under the pointer: the gutter after n columns sits at n measures and gutters.
        const reach = Math.max(x - BODY_ORIGIN.x + GUTTER / 2, 1);
        page.holdColumns(((spread.width + GUTTER) * grip.gutter) / reach);
      }
    },
    /** The press ended. A press that hardly moved was a click, and a click puts the caret into the text. */
    releasePage: () => {
      const grip = world.get(Grip)!;
      world.set(Grip, { kind: 'none' });

      if (grip.kind === 'stone') stone.releaseStone(grip.vx, grip.vy);
      else if (grip.kind === 'edge' || grip.kind === 'gutter') page.releaseSpread();
      else if (grip.kind === 'page' && grip.travelled < 0.3) {
        const spread = world.get(Spread)!;
        const inBody =
          grip.x > BODY_ORIGIN.x - 0.3 &&
          grip.x < BODY_ORIGIN.x + spread.width + 0.3 &&
          grip.y > BODY_ORIGIN.y &&
          grip.y < BODY_ORIGIN.y + BODY_HEIGHT;

        if (inBody) attachBody();

        editor.clickPage(grip.x, grip.y);
      }
    },
    /** The wheel dives: down toward the drop cap and through it, up back out. Returns whether it was used. */
    scrollPage: (amount: number) => {
      if (amount <= 0 && world.get(Shot)!.diveTarget === 0) return false;

      takeOver();
      const shot = world.get(Shot)!;
      const target = Math.min(1, Math.max(0, shot.diveTarget + amount * 0.0011));

      if (target > 0 && shot.name !== 'dive') camera.blendTo('dive', 1.4);
      else if (target === 0 && shot.name === 'dive') camera.blendTo('free', 1.6);

      camera.driveDive(target, 1.6);

      return true;
    },
    /**
     * The page for a visitor who asked for less motion: the finished spread, held still. Nothing plays by itself,
     * and whatever the visitor moves answers without springs or camera moves.
     */
    standStill: () => {
      takeOver();
      stone.rewindStone(true);
      stone.dismissStone();
      camera.resetDive();
      camera.blendTo('free', 0);
    },
    /** A key, while the caret is in a text. Returns whether it was used. */
    pressKey: (key: string) => {
      if (world.get(Mode)!.kind === 'attract') {
        if (key !== ' ' && key !== 'Enter' && key !== 'Escape') return false;

        takeOver();

        return true;
      }

      world.set(Mode, { touchedAt: world.get(Time)!.elapsed });

      if (world.get(Caret)!.field < 0) return false;

      if (key === 'Backspace') editor.deleteBackward();
      else if (key === 'Escape') editor.hideCaret();
      else if (key === 'ArrowLeft') editor.moveCaret('left');
      else if (key === 'ArrowRight') editor.moveCaret('right');
      else if (key === 'ArrowUp') editor.moveCaret('up');
      else if (key === 'ArrowDown') editor.moveCaret('down');
      else if ([...key].length === 1) editor.insertText(key);
      else return false;

      return true;
    },
  };
});
