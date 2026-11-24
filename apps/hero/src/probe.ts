import { _roots, getScheduler } from '@react-three/fiber/webgpu';
import { WebGPURenderer } from 'three/webgpu';
import { actions } from './actions';
import { Shot } from './camera/traits';
import { Mode } from './director/traits';
import { Caret } from './editor/traits';
import { BodyView, Letterpress, Script, Spread } from './page/traits';
import { currentText } from './page/utils';
import { Physics } from './physics/traits';
import { Quality } from './quality/traits';
import { Stone } from './stone/traits';
import { Time } from './time/traits';
import { Headline } from './title/traits';
import { world } from './world';

/**
 * A handle for the capture and profile scripts, installed only on a `?probe` page. It takes the frame loop off the
 * display's clock, so a script steps the hero a sixtieth of a second at a time, reads the GPU's own time for each
 * frame, and drives the director's commands, which are what the pointer and the keyboard call.
 */
export function installProbe(): void {
  let clock = performance.now();
  const root = () => {
    const state = _roots.values().next().value!.store.getState();

    if (!(state.renderer instanceof WebGPURenderer)) throw new Error('The probe needs the WebGPU renderer');

    return { ...state, renderer: state.renderer };
  };

  Object.assign(window, {
    heroProbe: {
      actions: actions(world),
      /** Stop following the display. From here only `step` advances the hero. */
      hold: () => {
        root().setFrameloop('never');
        clock = performance.now();
      },
      /** Advance `frames` sixtieths of a second, simulating and drawing each, and return the last one's GPU milliseconds. */
      step: async (frames: number) => {
        const { renderer } = root();

        for (let frame = 0; frame < frames; frame++) {
          clock += 1000 / 60;
          getScheduler().step(clock);
        }

        await renderer.resolveTimestampsAsync('render');

        return renderer.info.render.timestamp;
      },
      /** What a script needs to know about where the piece is. */
      read: () => {
        const view = world.get(BodyView);
        const letters = world.get(Letterpress)!;
        const script = world.get(Script)!;
        const stone = world.get(Stone)!;
        const { renderer } = root();

        return {
          elapsed: world.get(Time)!.elapsed,
          mode: world.get(Mode)!.kind,
          shot: world.get(Shot)!.name,
          dive: world.get(Shot)!.dive,
          tier: world.get(Quality)!.tier,
          columns: world.get(Spread)!.columns,
          reflowMs: world.get(Spread)!.reflowMs,
          lines: world.get(Spread)!.lines,
          bodyMode: world.get(Spread)!.mode,
          letters: letters.count,
          moving: letters.moving,
          bodies: world.get(Physics)?.bodies.size ?? 0,
          removed: script.removedCount,
          swallowed: stone.swallowed,
          stone: stone.present,
          headline: world.get(Headline)!.shown,
          caretField: world.get(Caret)!.field,
          caretOffset: world.get(Caret)!.offset,
          caretSplit: !Number.isNaN(world.get(Caret)!.secondX),
          // The engine's text against the script's own account of it: they agree or identity is lost.
          textAgrees: view === undefined || script.stale || view.text.text === currentText(script),
          textLength: view?.text.text.length ?? 0,
          // Whether the essay runs past its last column, and how far down the page its last line sits.
          overflowed: view?.text.measure().overflowed ?? false,
          lastBaseline: view?.text.measure().lastBaseline ?? 0,
          drawCalls: renderer.info.render.drawCalls,
          passes: renderer.info.render.calls,
        };
      },
    },
  });
}
