import { Text } from '@pmndrs/glyph/three';
import * as THREE from 'three/webgpu';

import type { ComparisonWorkloadConfiguration, ComparisonWorkloadDefinition } from '../comparison/contracts';
import { LIVE_TEXT_COLOR, LIVE_TEXT_LINE_HEIGHT } from '../shared/text-style';
import {
  committedTextMetrics,
  paintColor,
  type ComparisonWorkloadEntry,
  type WorkloadTextFactoryContext,
} from '../shared/scene-entry';

export const ZOOM_TEXT_BASE_CSS_PX = 8 * (96 / 72);
export const ZOOM_TEXT_INSET_CSS_PX = 24;
const ZOOM_TEXT_CYCLES_PER_MS = 1 / 3_500;

export const ZOOM_TEXT_CORPUS = [
  { language: 'en', text: 'Shape' },
  { language: 'fr', text: 'Forme' },
  { language: 'es', text: 'Figura' },
  { language: 'de', text: 'Form' },
  { language: 'pt', text: 'Formato' },
  { language: 'pl', text: 'Kształt' },
  { language: 'tr', text: 'Şekil' },
  { language: 'el', text: 'Σχήμα' },
  { language: 'ru', text: 'Форма' },
  { language: 'uk', text: 'Обрис' },
  { language: 'vi', text: 'Hình dạng' },
  { language: 'is', text: 'Lögun' },
  { language: 'ro', text: 'Formă' },
  { language: 'cy', text: 'Siâp' },
  { language: 'sr', text: 'Облик' },
  { language: 'kk', text: 'Пішін' },
] as const;

export type ZoomTextPhrase = (typeof ZOOM_TEXT_CORPUS)[number];

export interface ZoomTextAnimationState {
  phraseIndex: number;
  phraseRevision: number;
  progress: number;
}

export const zoomTextWorkload = {
  animate(entries, configuration, elapsedMs, _viewportWidth, _viewportHeight, _scene, scratch) {
    animateZoomTextEntries(entries, configuration, elapsedMs, scratch.zoomText);
  },
  applyRetainedConfiguration() {},
  batching: 'group',
  cameraKind: 'orthographic',
  contentWidth: 'none',
  create(context) {
    return createZoomTextEntries({ dpr: context.dpr, font: context.font });
  },
  id: 'zoom-text',
  layout(entries, context) {
    layoutZoomTextEntries(entries, context.viewportWidth, context.viewportHeight);
  },
  suspendsIconWindow: false,
  updateKind: () => 'retained',
} satisfies ComparisonWorkloadDefinition;

export function shuffleZoomTextPhrases(
  phrases: readonly ZoomTextPhrase[],
  random: () => number = Math.random,
): readonly ZoomTextPhrase[] {
  const shuffled = [...phrases];
  if (shuffled.length < 3) return shuffled;
  for (let index = shuffled.length - 1; index > 1; index -= 1) {
    const sample = random();
    if (!Number.isFinite(sample) || sample < 0 || sample >= 1) {
      throw new RangeError('zoom text shuffle source must return a value in [0, 1)');
    }
    const swapIndex = 1 + Math.floor(sample * index);
    const current = shuffled[index];
    shuffled[index] = shuffled[swapIndex] as ZoomTextPhrase;
    shuffled[swapIndex] = current as ZoomTextPhrase;
  }
  if (shuffled.every((phrase, index) => phrase === phrases[index])) {
    [shuffled[1], shuffled[2]] = [shuffled[2] as ZoomTextPhrase, shuffled[1] as ZoomTextPhrase];
  }
  return shuffled;
}

export const ZOOM_TEXT_PHRASES = shuffleZoomTextPhrases(ZOOM_TEXT_CORPUS);

export function createZoomTextEntries(context: WorkloadTextFactoryContext): readonly ComparisonWorkloadEntry[] {
  return ZOOM_TEXT_PHRASES.map((phrase, zoomPhraseIndex) => {
    const opacity = zoomPhraseIndex === 0 ? 1 : 0;
    const text = new Text({
      font: context.font,
      rasterPixelRatio: context.dpr,
      text: phrase.text,
      style: {
        fontSize: ZOOM_TEXT_BASE_CSS_PX,
        lineHeight: LIVE_TEXT_LINE_HEIGHT,
        language: phrase.language,
        direction: 'ltr',
        color: paintColor(LIVE_TEXT_COLOR),
        opacity,
      },
    });
    const node = new THREE.Group();
    node.add(text);
    node.visible = zoomPhraseIndex === 0;
    return {
      node,
      role: 'primary',
      sourceText: phrase.text,
      text,
      zoomOpacity: opacity,
      zoomLanguage: phrase.language,
      zoomMaximumScale: 1,
      zoomPhraseIndex,
    };
  });
}

export function zoomTextMaximumScale(
  layoutWidth: number,
  layoutHeight: number,
  viewportWidth: number,
  viewportHeight: number,
): number {
  positive(layoutWidth, 'zoom text layout width');
  positive(layoutHeight, 'zoom text layout height');
  positive(viewportWidth, 'zoom text viewport width');
  positive(viewportHeight, 'zoom text viewport height');
  const availableWidth = Math.max(1, viewportWidth - ZOOM_TEXT_INSET_CSS_PX * 2);
  const availableHeight = Math.max(1, viewportHeight - ZOOM_TEXT_INSET_CSS_PX * 2);
  return Math.max(1, Math.min(availableWidth / layoutWidth, availableHeight / layoutHeight));
}

export function zoomTextAnimationState(
  elapsedMs: number,
  animationSpeed: number,
  phraseCount: number = ZOOM_TEXT_PHRASES.length,
): Readonly<ZoomTextAnimationState> {
  const state: ZoomTextAnimationState = { phraseIndex: 0, phraseRevision: 0, progress: 0 };
  updateZoomTextAnimationState(state, elapsedMs, animationSpeed, phraseCount);
  return state;
}

export function updateZoomTextAnimationState(
  state: ZoomTextAnimationState,
  elapsedMs: number,
  animationSpeed: number,
  phraseCount: number,
): void {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) throw new RangeError('zoom text elapsed time must be nonnegative');
  if (!Number.isSafeInteger(phraseCount) || phraseCount <= 0) {
    throw new RangeError('zoom text phrase count must be a positive safe integer');
  }
  if (!Number.isFinite(animationSpeed) || animationSpeed < 0 || animationSpeed > 100) {
    throw new RangeError('zoom text animation speed must be in [0, 100]');
  }
  const cycle = elapsedMs * ZOOM_TEXT_CYCLES_PER_MS * animationRate(animationSpeed);
  const phraseRevision = Math.floor(cycle);
  const phase = cycle - phraseRevision;
  state.phraseIndex = phraseRevision % phraseCount;
  state.phraseRevision = phraseRevision;
  state.progress = phase;
}

export function layoutZoomTextEntries(
  entries: readonly ComparisonWorkloadEntry[],
  viewportWidth: number,
  viewportHeight: number,
): void {
  for (const entry of entries) layoutZoomTextEntry(entry, viewportWidth, viewportHeight);
}

export function animateZoomTextEntries(
  entries: readonly ComparisonWorkloadEntry[],
  configuration: Pick<ComparisonWorkloadConfiguration, 'animationEnabled' | 'animationSpeed'>,
  timestamp: number,
  state: ZoomTextAnimationState,
): void {
  if (!configuration.animationEnabled) return;
  if (entries.length !== ZOOM_TEXT_PHRASES.length) {
    throw new Error(
      `zoom text requires one retained Text per phrase; received ${String(entries.length)} for ${String(ZOOM_TEXT_PHRASES.length)} phrases`,
    );
  }
  updateZoomTextAnimationState(state, timestamp, configuration.animationSpeed, ZOOM_TEXT_PHRASES.length);
  const current = entries[state.phraseIndex]!;
  const incoming = entries[(state.phraseIndex + 1) % entries.length]!;
  const previous = entries[(state.phraseIndex + entries.length - 1) % entries.length]!;
  const fadeProgress = smoothstep(Math.max(0, Math.min(1, (state.progress - 0.82) / 0.18)));
  const zoomProgress = state.progress ** 3;
  previous.node.visible = false;
  current.node.visible = true;
  incoming.node.visible = fadeProgress > 0;
  current.node.scale.setScalar(1 + ((current.zoomMaximumScale ?? 1) - 1) * zoomProgress);
  incoming.node.scale.setScalar(1);
  setZoomTextOpacity(current, 1 - fadeProgress);
  setZoomTextOpacity(incoming, fadeProgress);
}

function layoutZoomTextEntry(entry: ComparisonWorkloadEntry, viewportWidth: number, viewportHeight: number): void {
  const layout = committedTextMetrics(entry.text);
  entry.text.position.set(-layout.width / 2, layout.height / 2, 0);
  entry.node.position.set(viewportWidth / 2, -viewportHeight / 2, 0);
  entry.node.scale.setScalar(1);
  entry.zoomMaximumScale = zoomTextMaximumScale(layout.width, layout.height, viewportWidth, viewportHeight);
}

function setZoomTextOpacity(entry: ComparisonWorkloadEntry, opacity: number): void {
  if (Math.abs((entry.zoomOpacity ?? -1) - opacity) < 0.002) return;
  entry.zoomOpacity = opacity;
  // `set` replaces a property group wholesale, so the retained colour has to travel with the new opacity.
  entry.text.set({ style: { ...entry.text.style, opacity } });
}

function animationRate(animationSpeed: number): number {
  return 0.25 + animationSpeed * 0.0175;
}

function smoothstep(value: number): number {
  return value * value * (3 - 2 * value);
}

function positive(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${label} must be positive`);
  return value;
}
