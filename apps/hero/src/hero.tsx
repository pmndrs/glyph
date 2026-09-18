import { useFrame, useThree } from '@react-three/fiber/webgpu';
import { useEffect } from 'react';

import { useFaces, useFeatureField, useTitleField } from './fonts';
import { Post } from './post/Post';
import { FeatureLine } from './scene/FeatureLine';
import { GlassTitle } from './scene/GlassTitle';
import { IconPattern, PATTERN_ANGLE } from './scene/IconPattern';
import { Lighting } from './scene/Lighting';
import { Paper } from './scene/Paper';
import { uPaperDrift, uTime } from './uniforms';

/** The paper sits deeper than the front sheet, so it drifts faster in world units to match it on screen. */
const PAPER_DRIFT = 3.2 * (30 / 22);

/** `?post=0` renders the plain scene: a clean capture pass, and a way to isolate post-processing. */
const POST_ENABLED = new URLSearchParams(location.search).get('post') !== '0';

export function Hero() {
  const faces = useFaces();
  const titleField = useTitleField();
  const featureField = useFeatureField();
  const scene = useThree((state) => state.scene);
  const renderer = useThree((state) => state.renderer);
  useEffect(() => {
    // Development-only handle for inspecting the scene from DevTools.
    if (!import.meta.env.DEV) return;
    Object.assign(globalThis, { heroScene: scene, heroRenderer: renderer });
    // Three's own WebGPU inspector, the panel the threejs.org examples carry. The renderer calls `init` on whatever
    // inspector it holds while it is starting up, which is before this can assign one, so it is called here instead;
    // and the inspector builds its own DOM but leaves attaching it to the host. D hides and shows it.
    let panel: HTMLElement | undefined;
    let shown = true;
    // StrictMode mounts effects twice, and this import resolves after the first cleanup. Without the guard that run
    // still appends a panel — an orphan whose key listener is already gone — and D then toggles the wrong one.
    let cancelled = false;
    const toggle = (event: KeyboardEvent) => {
      if (panel === undefined || (event.key !== 'd' && event.key !== 'D')) return;
      event.preventDefault();
      shown = !shown;
      // Not the inspector's own `hide`, which only collapses the readout inside the panel. Recording needs the whole
      // thing gone from the frame.
      panel.style.display = shown ? '' : 'none';
    };
    window.addEventListener('keydown', toggle);
    void import('three/addons/inspector/Inspector.js').then((module) => {
      if (cancelled) return;
      const created = new module.Inspector();
      renderer.inspector = created;
      created.init();
      panel = created.domElement;
      document.body.append(panel);
    });
    return () => {
      cancelled = true;
      window.removeEventListener('keydown', toggle);
      panel?.remove();
    };
  }, [renderer, scene]);

  useFrame(
    ({ elapsed }) => {
      uTime.value = elapsed;
      uPaperDrift.value.set(
        Math.cos(PATTERN_ANGLE) * PAPER_DRIFT * elapsed,
        Math.sin(PATTERN_ANGLE) * PAPER_DRIFT * elapsed,
      );
    },
    { phase: 'start' },
  );

  return (
    <>
      <Lighting />
      <Paper />
      {/* Deeper sheet: pitch AND scroll speed scaled by the depth ratio (25.5 / 22), so it matches the front on
          screen and stays in phase with it — different speeds would drift the interleave apart within a second.
          Offset half a cell across and down puts each small icon dead centre between four large ones. */}
      <IconPattern
        cell={2.202}
        colour="#a8adb6"
        gems
        columns={18}
        depth={-9.5}
        faces={faces}
        iconSize={0.42}
        motifs={7}
        offset={1.101}
        opacity={1}
        response={0.35}
        // Zero, not half a cell: in screen space the two sheets already sit half a pitch apart (16 rows against 13),
        // so any half-cell shift snaps the small icons back onto the large rows instead of between them.
        rowOffset={0}
        rows={13}
        seed={4201}
        speed={3.709}
        waveDelay={0.13}
        waveImpulse={87}
        waveSpeed={11}
      />
      <IconPattern
        cell={1.9}
        colour="#4e535b"
        columns={20}
        depth={-6}
        faces={faces}
        iconSize={0.78}
        motifs={8}
        offset={0}
        opacity={1}
        response={1}
        rowOffset={0}
        rows={16}
        seed={0}
        speed={3.2}
        waveDelay={0}
        waveImpulse={146}
        waveSpeed={15}
      />
      <GlassTitle faces={faces} field={titleField} />
      <FeatureLine field={featureField} />
      {POST_ENABLED ? <Post /> : null}
    </>
  );
}
