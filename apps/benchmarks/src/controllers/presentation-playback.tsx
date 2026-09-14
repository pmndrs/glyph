import { useEffect, useEffectEvent, useRef, type Dispatch, type SetStateAction } from 'react';

import {
  advancedShapingCase,
  initialAdvancedShapingState,
  type AdvancedShapingState,
} from '../workloads/advanced-shaping/scene';
import {
  adjacentPresentationWorkload,
  presentationFrame,
  type PresentationPreset,
  type PresentationWorkload,
} from '../benchmark/presentation-sequence';
import type { BenchmarkFontFixture } from '../benchmark/font-fixtures';
import type { HarnessLocation } from '../benchmark/url-state';

interface PresentationPlaybackState {
  preset: PresentationPreset | undefined;
  readonly startedAt: number;
  readonly startWorkload: PresentationWorkload;
  workload: PresentationWorkload;
}

export function PresentationPlayback({
  location,
  playing,
  requestedLocation,
  setAdvancedFontFixture,
  setLocation,
  onPlaying,
  setPreset,
  setShowcaseState,
}: {
  readonly location: HarnessLocation;
  readonly playing: boolean;
  readonly requestedLocation: { current: HarnessLocation };
  readonly setAdvancedFontFixture: Dispatch<SetStateAction<BenchmarkFontFixture>>;
  readonly setLocation: (next: Partial<HarnessLocation>) => void;
  readonly onPlaying: (playing: boolean) => void;
  readonly setPreset: Dispatch<SetStateAction<PresentationPreset | undefined>>;
  readonly setShowcaseState: Dispatch<SetStateAction<AdvancedShapingState>>;
}) {
  const playback = useRef<PresentationPlaybackState | undefined>(undefined);
  const stop = useEffectEvent(() => {
    playback.current = undefined;
    onPlaying(false);
  });
  const navigate = useEffectEvent((direction: -1 | 1) => {
    stop();
    setLocation({ view: 'scene', workload: adjacentPresentationWorkload(location.workload, direction) });
  });
  const toggle = useEffectEvent(() => {
    if (playback.current !== undefined) {
      stop();
      return;
    }
    const startFrame = presentationFrame(location.workload, 0);
    const startWorkload = startFrame.workload;
    playback.current = {
      preset: startFrame.preset,
      startedAt: performance.now(),
      startWorkload,
      workload: startWorkload,
    };
    if (startWorkload === 'advanced-shaping') {
      const initial = initialAdvancedShapingState('auto');
      setShowcaseState(initial);
      setAdvancedFontFixture(advancedShapingCase(initial.caseId).fontFixture);
    }
    setPreset(startFrame.preset);
    onPlaying(true);
    if (location.workload !== startWorkload) setLocation({ view: 'scene', workload: startWorkload });
  });
  const advance = useEffectEvent((timestamp: number) => {
    const state = playback.current;
    if (state === undefined) return;
    const frame = presentationFrame(state.startWorkload, timestamp - state.startedAt);
    if (frame.workload !== state.workload) {
      state.workload = frame.workload;
      if (frame.workload === 'advanced-shaping') {
        const initial = initialAdvancedShapingState('auto');
        setShowcaseState(initial);
        setAdvancedFontFixture(advancedShapingCase(initial.caseId).fontFixture);
      }
    }
    if (frame.preset !== state.preset) {
      state.preset = frame.preset;
      setPreset(frame.preset);
    }
    if (frame.workload !== requestedLocation.current.workload) {
      setLocation({ view: 'scene', workload: frame.workload });
    }
    if (frame.complete) stop();
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (requestedLocation.current.layout !== 'presentation') return;
      if (event.code === 'Space' && !isTextEntryTarget(event.target)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!event.repeat) toggle();
        return;
      }
      if (event.repeat || isShortcutTarget(event.target)) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        navigate(event.key === 'ArrowLeft' ? -1 : 1);
      }
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      if (
        requestedLocation.current.layout !== 'presentation' ||
        event.code !== 'Space' ||
        isTextEntryTarget(event.target)
      ) {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    globalThis.addEventListener?.('keydown', onKeyDown, true);
    globalThis.addEventListener?.('keyup', onKeyUp, true);
    return () => {
      globalThis.removeEventListener?.('keydown', onKeyDown, true);
      globalThis.removeEventListener?.('keyup', onKeyUp, true);
    };
  }, [requestedLocation]);

  useEffect(() => {
    if (!playing) return;
    let animationFrame = 0;
    const animate = (timestamp: number): void => {
      advance(timestamp);
      if (playback.current !== undefined) animationFrame = requestAnimationFrame(animate);
    };
    animationFrame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrame);
  }, [playback, playing]);

  return null;
}

function isShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return (
    target.closest('input, textarea, select, button, [contenteditable="true"], [role="slider"], [role="combobox"]') !==
    null
  );
}

function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return (
    target.closest(
      'textarea, [contenteditable="true"], input:not([type]), input[type="text"], input[type="search"], input[type="email"], input[type="url"], input[type="tel"], input[type="password"]',
    ) !== null
  );
}
