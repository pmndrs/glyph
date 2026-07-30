import { FontRegistry, Text, type RegisteredFont } from '@pmndrs/text';
import { bitmap } from '@pmndrs/text/raster/bitmap';
import * as THREE from 'three/webgpu';

import amiriBitmapFontUrl from '../../fixtures/rendering/amiri-bitmap-16.font.glb?url';
import notoCjkShowcaseBitmapFontUrl from '../../fixtures/rendering/noto-sans-cjk-showcase-bitmap-16.font.glb?url';
import interBitmapFontUrl from '../../fixtures/rendering/inter-bitmap-16.font.glb?url';
import devanagariBitmapFontUrl from '../../fixtures/rendering/noto-sans-devanagari-bitmap-16.font.glb?url';
import {
  ADVANCED_SHAPING_CASES,
  advancedShapingFrames,
  type AdvancedShapingFontFixture,
} from '../benchmark/advanced-shaping';
import type { BenchmarkTarget } from '../benchmark/contracts';
import { hashParagraphLayout, paragraphLayoutBytes } from '../benchmark/paragraph-layout-digest';

const VIEWPORT_WIDTH = 800;
const FONT_SIZE = 16;
const UTF8_ENCODER = new TextEncoder();
const bitmapRequest = bitmap({ strikes: [16] as const });
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
      readonly fonts: ReadonlyMap<AdvancedShapingFontFixture, RegisteredFont>;
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
    load: async () => {
      if (state.kind === 'ready') return;
      const registry = new FontRegistry();
      const fonts = new Map<AdvancedShapingFontFixture, RegisteredFont>();
      try {
        const fixtures = [...new Set(ADVANCED_SHAPING_CASES.map((definition) => definition.fontFixture))];
        const results = await Promise.allSettled(
          fixtures.map(async (fixture) => {
            const response = await fetch(fontUrlByFixture[fixture]);
            if (!response.ok) {
              throw new Error(`Unable to load ${fixture} bitmap fixture (${response.status})`);
            }
            const font = await registry.registerAsset(new Uint8Array(await response.arrayBuffer()));
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
    run: async () => {
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

      for (const definition of ADVANCED_SHAPING_CASES) {
        const font = state.fonts.get(definition.fontFixture);
        if (font === undefined) throw new Error(`Missing ${definition.fontFixture} fixture`);
        const caseFrames = frames.filter((frame) => frame.caseDefinition.id === definition.id);
        let text: Text | undefined;
        try {
          for (const frame of caseFrames) {
            const properties = {
              text: frame.text,
              width: Math.max(120, (VIEWPORT_WIDTH * frame.widthPermille) / 1000),
              fontSize: FONT_SIZE,
              language: definition.language,
              direction: definition.direction,
              features: definition.features,
            } as const;
            if (text === undefined) {
              text = new Text({
                ...properties,
                font,
                raster: bitmapRequest,
              });
            } else {
              text.setProperties(properties);
            }
            await text.ready;
            const layout = text.layout;
            if (layout === undefined) throw new Error(`${definition.id}:${frame.tick} has no layout`);
            const rendered = renderedGlyphs(text);
            const draws = bitmapDraws(text);
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
        },
      };
    },
    dispose: async () => {
      if (state.kind !== 'ready') return;
      for (const font of state.fonts.values()) font.dispose();
      state = { kind: 'empty' };
    },
  };
}

function renderedGlyphs(object: THREE.Object3D): number {
  let count = 0;
  object.traverse((child) => {
    if (child instanceof THREE.Mesh && child.geometry instanceof THREE.InstancedBufferGeometry) {
      count += child.geometry.instanceCount;
    }
  });
  return count;
}

function bitmapDraws(object: THREE.Object3D): number {
  let count = 0;
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) count += 1;
  });
  return count;
}

function hashText(value: string): string {
  let hash = 2_166_136_261;
  for (const byte of UTF8_ENCODER.encode(value)) {
    hash = Math.imul(hash ^ byte, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
