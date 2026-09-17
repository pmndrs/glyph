import type { GlyphSceneProps } from '../../../explainer';
import { useFrame } from '@react-three/fiber/webgpu';
import { useCallback, useMemo, useRef, useState } from 'react';
import { InstancedMesh, SRGBColorSpace } from 'three';
import { useSceneReady } from '../use-scene-ready';
import { ShowcaseCameraRig } from './camera-rig';
import { ArchvizEnvironment } from './environment';
import { createDenseShowcaseObjects, nextVisibleShowcaseCount } from './dense-showcase';
import { advanceDenseExitScale } from './dense-exit-motion';
import { ShowcaseInfoPanel, type ShowcaseControl } from './info-panel';
import {
  closeShowcasePanel,
  finishShowcaseClose,
  finishShowcaseFocus,
  focusShowcaseObject,
  ORBITING,
  selectedShowcaseIndex,
  type ShowcaseInteraction,
} from './interaction-state';
import { ObjectField } from './object-field';
import { DenseModeExit } from './mode-exit';
import { showcaseModeState, type ShowcaseMode } from './mode-state';
import { SHOWCASE_OBJECTS, type ShowcaseObject } from './showcase-objects';
import { useShowcaseSelectionMotion } from './use-selection-motion';
import { WorldLabels } from './world-labels';

export function ObjectShowcaseScene({ inputs, onReady }: GlyphSceneProps) {
  const [objects, setObjects] = useState<InstancedMesh | null>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number>();
  const [hoveredControl, setHoveredControl] = useState<ShowcaseControl>();
  const [pressedControl, setPressedControl] = useState<ShowcaseControl>();
  const [interaction, setInteraction] = useState<ShowcaseInteraction>(ORBITING);
  const [generated, setGenerated] = useState<readonly ShowcaseObject[]>([]);
  const [mode, setMode] = useState<ShowcaseMode>('standard');
  const [denseAccent, setDenseAccent] = useState('#38bdf8');
  const visibleCount = useRef(SHOWCASE_OBJECTS.length);
  const denseScale = useRef(1);
  const denseCollapseComplete = useRef(false);
  const denseCameraComplete = useRef(false);
  const items = useMemo(() => [...SHOWCASE_OBJECTS, ...generated], [generated]);
  const selectionMotion = useShowcaseSelectionMotion(interaction);
  const selectedIndex = selectedShowcaseIndex(interaction);
  const select = useCallback((index: number) => {
    setInteraction(focusShowcaseObject(index));
  }, []);
  const focused = useCallback(() => setInteraction(finishShowcaseFocus), []);
  const close = useCallback(() => setInteraction(closeShowcasePanel), []);
  const closed = useCallback(() => {
    setInteraction(finishShowcaseClose);
  }, []);
  const launch = useCallback(() => {
    if (selectedIndex === undefined) return;
    const selected = items[selectedIndex]!;
    const nextGenerated =
      generated[0]?.category === selected.category ? generated : createDenseShowcaseObjects(selected);
    setDenseAccent(`#${selected.color.getHexString(SRGBColorSpace)}`);
    visibleCount.current = SHOWCASE_OBJECTS.length;
    denseScale.current = 1;
    denseCollapseComplete.current = false;
    denseCameraComplete.current = false;
    if (nextGenerated !== generated) setGenerated(nextGenerated);
    setMode('dense');
    setInteraction(closeShowcasePanel);
  }, [generated, items, selectedIndex]);
  const exitDense = useCallback(() => {
    denseCollapseComplete.current = false;
    denseCameraComplete.current = false;
    setMode('exiting');
    setInteraction(ORBITING);
  }, []);
  const orbitDistanceSettled = useCallback(() => {
    setMode((current) => {
      if (current !== 'exiting') return current;
      denseCameraComplete.current = true;
      return denseCollapseComplete.current ? 'standard' : current;
    });
  }, []);
  useFrame((_state, delta) => {
    if (mode === 'dense') {
      visibleCount.current = nextVisibleShowcaseCount(visibleCount.current, items.length);
      return;
    }
    if (mode !== 'exiting' || denseCollapseComplete.current) return;
    denseScale.current = advanceDenseExitScale(denseScale.current, delta);
    if (denseScale.current !== 0) return;
    denseCollapseComplete.current = true;
    visibleCount.current = SHOWCASE_OBJECTS.length;
    if (denseCameraComplete.current) setMode('standard');
  }, -2);
  const modeState = showcaseModeState(mode);
  useSceneReady(onReady);
  return (
    <>
      <ShowcaseCameraRig
        denseMode={modeState.denseInteraction}
        inputs={inputs}
        interaction={interaction}
        items={items}
        objects={objects}
        orbitDistance={modeState.orbitDistance}
        onClose={close}
        onClosed={closed}
        onControlHover={setHoveredControl}
        onControlPress={setPressedControl}
        onExitDense={exitDense}
        onFocused={focused}
        onHover={setHoveredIndex}
        onLaunch={launch}
        onOrbitDistanceSettled={orbitDistanceSettled}
        onSelect={select}
      >
        <ShowcaseInfoPanel
          hoveredControl={hoveredControl}
          interaction={interaction}
          pressedControl={pressedControl}
          selected={selectedIndex === undefined ? undefined : items[selectedIndex]}
        />
        <DenseModeExit
          accent={denseAccent}
          hovered={hoveredControl === 'dense-exit'}
          pressed={pressedControl === 'dense-exit'}
          visible={modeState.exitVisible}
        />
      </ShowcaseCameraRig>
      <ArchvizEnvironment />
      <ObjectField
        denseScale={denseScale}
        items={items}
        motion={selectionMotion}
        onMount={setObjects}
        visibleCount={visibleCount}
      />
      <WorldLabels
        denseScale={denseScale}
        denseMode={mode === 'dense'}
        hoveredIndex={hoveredIndex}
        interaction={interaction}
        items={items}
        motion={selectionMotion}
        visibleCount={visibleCount}
      />
    </>
  );
}
