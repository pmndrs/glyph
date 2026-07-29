import type { BenchmarkFontFixture } from '../benchmark/font-fixtures';

export type SlugRoleSceneKind = 'large-size' | 'extreme-zoom' | 'complex-outline' | 'clipping';

export interface SlugRoleSceneDefinition {
  readonly id: string;
  readonly kind: SlugRoleSceneKind;
  readonly fontFixture: BenchmarkFontFixture;
  readonly text: string;
  readonly language: string;
  readonly direction: 'ltr' | 'rtl';
  readonly physicalWidth: number;
  readonly physicalHeight: number;
  readonly physicalPpem: number;
  readonly physicalLayoutWidth: number;
  readonly physicalOriginX: number;
  readonly physicalOriginY: number;
  readonly expectsViewportClipping: boolean;
}

export interface SlugAffineRoleSceneDefinition {
  readonly id: 'affine-37deg-3x05';
  readonly kind: 'transform';
  readonly fontFixture: 'inter';
  readonly text: string;
  readonly language: 'en';
  readonly direction: 'ltr';
  readonly physicalWidth: number;
  readonly physicalHeight: number;
  readonly physicalPpem: number;
  readonly physicalLayoutWidth: number;
  readonly physicalPositionX: number;
  readonly physicalPositionY: number;
  readonly rotationRadians: number;
  readonly scaleX: number;
  readonly scaleY: number;
}

export interface SlugProjectionZoomSceneDefinition {
  readonly id: 'camera-zoom-1x-8x';
  readonly kind: 'projection-zoom';
  readonly fontFixture: 'inter';
  readonly text: 'I';
  readonly physicalWidth: number;
  readonly physicalHeight: number;
  readonly physicalPpem: number;
  readonly zooms: readonly [1, 8];
}

/**
 * Focused physical-pixel scenes for Slug's release role. Keeping dimensions,
 * ppem, and origins physical makes the same scene comparable at DPR 1 and 2.
 */
export const SLUG_ROLE_SCENES: readonly SlugRoleSceneDefinition[] = [
  {
    id: 'large-source-serif',
    kind: 'large-size',
    fontFixture: 'source-serif-4',
    text: 'Qgj&',
    language: 'en',
    direction: 'ltr',
    physicalWidth: 768,
    physicalHeight: 384,
    physicalPpem: 192,
    physicalLayoutWidth: 732,
    physicalOriginX: 18,
    physicalOriginY: -18,
    expectsViewportClipping: false,
  },
  {
    id: 'extreme-zoom-inter',
    kind: 'extreme-zoom',
    fontFixture: 'inter',
    text: 'Sg',
    language: 'en',
    direction: 'ltr',
    physicalWidth: 768,
    physicalHeight: 768,
    physicalPpem: 1_024,
    physicalLayoutWidth: 1_500,
    physicalOriginX: -96,
    physicalOriginY: 96,
    expectsViewportClipping: true,
  },
  {
    id: 'complex-arabic',
    kind: 'complex-outline',
    fontFixture: 'amiri',
    text: 'العَرَبِيَّةُ',
    language: 'ar',
    direction: 'rtl',
    physicalWidth: 1_200,
    physicalHeight: 640,
    physicalPpem: 256,
    physicalLayoutWidth: 1_164,
    physicalOriginX: 18,
    physicalOriginY: -64,
    expectsViewportClipping: false,
  },
  {
    id: 'complex-devanagari',
    kind: 'complex-outline',
    fontFixture: 'noto-sans-devanagari',
    text: 'क्षेत्र प्रगति',
    language: 'hi',
    direction: 'ltr',
    physicalWidth: 1_200,
    physicalHeight: 640,
    physicalPpem: 256,
    physicalLayoutWidth: 1_164,
    physicalOriginX: 18,
    physicalOriginY: -64,
    expectsViewportClipping: false,
  },
  {
    id: 'complex-cjk',
    kind: 'complex-outline',
    fontFixture: 'noto-sans-cjk-showcase',
    text: '文字組版',
    language: 'ja',
    direction: 'ltr',
    physicalWidth: 1_200,
    physicalHeight: 640,
    physicalPpem: 256,
    physicalLayoutWidth: 1_164,
    physicalOriginX: 18,
    physicalOriginY: -64,
    expectsViewportClipping: false,
  },
  {
    id: 'clipped-source-serif',
    kind: 'clipping',
    fontFixture: 'source-serif-4',
    text: 'Qgj',
    language: 'en',
    direction: 'ltr',
    physicalWidth: 512,
    physicalHeight: 320,
    physicalPpem: 384,
    physicalLayoutWidth: 720,
    physicalOriginX: -72,
    physicalOriginY: 72,
    expectsViewportClipping: true,
  },
] as const;

/** Copied from the older S3 transform gate, adapted to public Text and source Canvas2D. */
export const SLUG_AFFINE_ROLE_SCENE: SlugAffineRoleSceneDefinition = {
  id: 'affine-37deg-3x05',
  kind: 'transform',
  fontFixture: 'inter',
  text: 'Slug',
  language: 'en',
  direction: 'ltr',
  physicalWidth: 640,
  physicalHeight: 640,
  physicalPpem: 64,
  physicalLayoutWidth: 420,
  physicalPositionX: 180,
  physicalPositionY: -280,
  rotationRadians: (37 * Math.PI) / 180,
  scaleX: 3,
  scaleY: 0.5,
};

/** Copied from the older U2 projection gate: identical geometry at camera zoom 1× and 8×. */
export const SLUG_PROJECTION_ZOOM_SCENE: SlugProjectionZoomSceneDefinition = {
  id: 'camera-zoom-1x-8x',
  kind: 'projection-zoom',
  fontFixture: 'inter',
  text: 'I',
  physicalWidth: 384,
  physicalHeight: 384,
  physicalPpem: 20,
  zooms: [1, 8],
};
