import { type Font, type RasterFormatInput } from '@pmndrs/glyph';
import { bitmap } from '@pmndrs/glyph/raster/bitmap';
import { loadBenchmarkFont as loadFont } from '../../../workloads/font-assets/library';
import type { Text, TextStyle } from '@pmndrs/glyph/three';
import * as THREE from 'three/webgpu';

import amiriBitmapFontUrl from '../../../../fixtures/rendering/amiri-bitmap-16.font.glb?url';
import notoCjkShowcaseBitmapFontUrl from '../../../../fixtures/rendering/noto-sans-cjk-showcase-bitmap-16.font.glb?url';
import interBitmapFontUrl from '../../../../fixtures/rendering/inter-bitmap-16.font.glb?url';
import devanagariBitmapFontUrl from '../../../../fixtures/rendering/noto-sans-devanagari-bitmap-16.font.glb?url';
import {
  ADVANCED_SHAPING_CASES,
  advancedShapingFrames,
  type AdvancedShapingFontFixture,
} from '../../../workloads/advanced-shaping/scene';
import type { BenchmarkTarget } from '../../contracts';
import { hashParagraphLayout, paragraphLayoutBytes } from '../../paragraph-layout-digest';
import { createBenchmarkThreeRoot, disposeBenchmarkThreeRoot } from '../../../three-root';

type BitmapTechnique = typeof bitmap;

const VIEWPORT_WIDTH = 800;
const FONT_SIZE = 16;
const UTF8_ENCODER = new TextEncoder();
const bitmapRaster: RasterFormatInput<BitmapTechnique> = {
  raster: bitmap,
  options: { strikes: [16] },
};
const fontUrlByFixture: Readonly<Record<AdvancedShapingFontFixture, string>> = {
  inter: interBitmapFontUrl,
  amiri: amiriBitmapFontUrl,
  'noto-sans-devanagari': devanagariBitmapFontUrl,
  'noto-sans-cjk-showcase': notoCjkShowcaseBitmapFontUrl,
};

type AdvancedShapingConformanceState =
  | { readonly kind: 'empty' }
  | {
      readonly kind: 'ready';
      readonly fonts: ReadonlyMap<AdvancedShapingFontFixture, Font<BitmapTechnique>>;
    };

export function createAdvancedShapingConformanceTarget(): BenchmarkTarget {
  let state: AdvancedShapingConformanceState = { kind: 'empty' };
  return {
    id: 'advanced-shaping-conformance',
    label: 'Advanced shaping conformance',
    detail: 'five scripts · every authored frame · public Text bitmap batches',
    color: 'violet',
    capabilities: new Set(['deterministic', 'font-bytes', 'wasm', 'shaping', 'paragraph', 'raster']),
    status: () => 'ready',
    load: async (_controls, context) => {
      if (state.kind === 'ready') return;
      const fonts = new Map<AdvancedShapingFontFixture, Font<BitmapTechnique>>();
      try {
        const fixtures = [...new Set(ADVANCED_SHAPING_CASES.map((definition) => definition.fontFixture))];
        const results = await Promise.allSettled(
          fixtures.map(async (fixture) => {
            const font = await loadFont(
              { baked: fontUrlByFixture[fixture] },
              bitmapRaster,
              context?.signal === undefined ? {} : { signal: context.signal },
            );
            return [fixture, font] as const;
          }),
        );
        for (const result of results) {
          if (result.status === 'fulfilled') fonts.set(...result.value);
        }
        const failure = results.find((result) => result.status === 'rejected');
        if (failure !== undefined) throw failure.reason;
        state = { kind: 'ready', fonts };
      } catch (error) {
        for (const font of fonts.values()) font.dispose();
        throw error;
      }
    },
    run: async (_input, _sampleIndex, _controls, context) => {
      context?.signal?.throwIfAborted();
      if (state.kind !== 'ready') {
        throw new Error('advanced-shaping conformance target was not loaded');
      }
      const frames = advancedShapingFrames();
      const frameHashes: string[] = [];
      let layoutByteCount = 0;
      let glyphCount = 0;
      let missingGlyphCount = 0;
      let renderedGlyphCount = 0;
      let drawCount = 0;
      let coldReadyObservationCount = 0;
      let warmLifecyclePublicationCount = 0;

      // A standalone Text only binds a paragraph batch while it has a parent, so every case shapes inside a scene.
      const scene = new THREE.Scene();
      const root = createBenchmarkThreeRoot('advanced-shaping-conformance');
      try {
        for (const definition of ADVANCED_SHAPING_CASES) {
          const font = state.fonts.get(definition.fontFixture);
          if (font === undefined) throw new Error(`Missing ${definition.fontFixture} fixture`);
          const caseFrames = frames.filter((frame) => frame.caseDefinition.id === definition.id);
          let text: Text<BitmapTechnique> | undefined;
          try {
            for (const frame of caseFrames) {
              const style: TextStyle = {
                fontSize: FONT_SIZE,
                language: definition.language,
                direction: definition.direction,
                // Target v1 validates an unbounded feature as a non-empty UTF-16 range over the paragraph, so the empty
                // opening frame of each timeline states no features instead of an unsatisfiable whole-paragraph range.
                ...(frame.text.length === 0 ? {} : { features: definition.features }),
              };
              const properties = {
                text: frame.text,
                constraints: {
                  width: {
                    mode: 'exact',
                    size: Math.max(120, (VIEWPORT_WIDTH * frame.widthPermille) / 1000),
                  },
                },
                style,
              } as const;
              if (text === undefined) {
                text = root.createText({ font, ...properties });
                scene.add(text);
                coldReadyObservationCount += 1;
              } else {
                text.set(properties);
                warmLifecyclePublicationCount += 1;
              }
              // The host Scene traversal reaches the root draw object after retained Text transforms. That one root
              // boundary publishes every dirty paragraph and synchronizes its renderer-owned batches.
              scene.updateMatrixWorld(true);
              // Headless runs read this across a page boundary that cannot transfer a cause, so the frame that failed
              // and the underlying reason both belong in the message.
              if (text.error !== undefined) {
                throw new Error(`${definition.id}:${frame.tick} failed to publish: ${String(text.error)}`, {
                  cause: text.error,
                });
              }
              const layout = text.glyphs();
              if (layout === undefined) throw new Error(`${definition.id}:${frame.tick} has no layout`);
              const rendered = renderedGlyphs(scene, root.name);
              const draws = bitmapDraws(scene, root.name);
              const missing = layout.glyphIds.reduce((count, glyphId) => count + (glyphId === 0 ? 1 : 0), 0);
              if (missing !== 0) {
                throw new Error(`${definition.id}:${frame.tick} contains missing glyphs`);
              }
              if (frame.text.length > 0 && rendered === 0) {
                throw new Error(`${definition.id}:${frame.tick} produced no bitmap instances`);
              }
              layoutByteCount += paragraphLayoutBytes(layout);
              glyphCount += layout.glyphIds.length;
              missingGlyphCount += missing;
              renderedGlyphCount += rendered;
              drawCount += draws;
              frameHashes.push(
                [
                  definition.id,
                  frame.tick,
                  frame.widthPermille,
                  hashText(frame.text),
                  hashParagraphLayout(layout),
                  rendered,
                  draws,
                ].join(':'),
              );
            }
          } finally {
            text?.removeFromParent();
            text?.dispose();
          }
        }

        return {
          bytes: layoutByteCount,
          hash: hashText(frameHashes.join('|')),
          metrics: {
            caseCount: ADVANCED_SHAPING_CASES.length,
            frameCount: frames.length,
            finalFrameCount: ADVANCED_SHAPING_CASES.length,
            layoutBytes: layoutByteCount,
            glyphCount,
            missingGlyphCount,
            renderedGlyphCount,
            drawCount,
            coldReadyObservationCount,
            warmLifecyclePublicationCount,
            warmReadyWaitCount: 0,
          },
        };
      } finally {
        disposeBenchmarkThreeRoot(root);
      }
    },
    dispose: async () => {
      if (state.kind !== 'ready') return;
      const { fonts } = state;
      state = { kind: 'empty' };
      for (const font of fonts.values()) font.dispose();
    },
  };
}

function renderedGlyphs(scene: THREE.Scene, rootName: string | undefined): number {
  let count = 0;
  drawRoot(scene, rootName)?.traverse((child) => {
    if (child instanceof THREE.Mesh && child.geometry instanceof THREE.InstancedBufferGeometry) {
      count += child.geometry.instanceCount;
    }
  });
  return count;
}

function bitmapDraws(scene: THREE.Scene, rootName: string | undefined): number {
  let count = 0;
  drawRoot(scene, rootName)?.traverse((child) => {
    if (child instanceof THREE.Mesh) count += 1;
  });
  return count;
}

function drawRoot(scene: THREE.Scene, rootName: string | undefined): THREE.Object3D | undefined {
  return scene.getObjectByName(rootName === undefined ? '@pmndrs/glyph:anonymous' : `@pmndrs/glyph:${rootName}`);
}

function hashText(value: string): string {
  let hash = 2_166_136_261;
  for (const byte of UTF8_ENCODER.encode(value)) {
    hash = Math.imul(hash ^ byte, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
