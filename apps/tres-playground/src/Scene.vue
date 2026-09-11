<script setup lang="ts">
import { Text, TextGroup, type VueTextInstance } from '@pmndrs/glyph/vue';
import { useBitmap } from '@pmndrs/glyph/vue/bitmap';
import { useMsdf } from '@pmndrs/glyph/vue/msdf';
import { useSlug } from '@pmndrs/glyph/vue/slug';
import type { RasterFormatMetadata } from '@pmndrs/glyph';
import { useTres } from '@tresjs/core';
import { Vector3 } from 'three/webgpu';
import { computed, shallowRef } from 'vue';

import iconFontUrl from '../../r3f-hello-world/assets/font-awesome-world.font.glb?url';
import latinFontUrl from '../../r3f-hello-world/assets/inter-latin.font.glb?url';
import { COLORS, RASTER_FORMATS, WORLD_ICON, playground, type RasterFormatName } from './inspect.js';

const props = defineProps<{ format: RasterFormatName; message: string }>();
const emit = defineEmits<{ error: [error: unknown] }>();

const { sizes, scene } = useTres();
playground.scene = scene.value;

// Each composable owns one declaration and its mounted Font lease for this component's lifetime. The three
// formats load in parallel so switching never waits.
const bitmapOptions = { strikes: [32] } as const;
const latin = {
  bitmap: useBitmap(latinFontUrl, bitmapOptions),
  msdf: useMsdf(latinFontUrl),
  slug: useSlug(latinFontUrl),
} as const;
const icons = {
  bitmap: useBitmap(iconFontUrl, bitmapOptions),
  msdf: useMsdf(iconFontUrl),
  slug: useSlug(iconFontUrl),
} as const;
for (const loader of [...Object.values(latin), ...Object.values(icons)]) {
  loader.ready.catch((error: unknown) => emit('error', error));
}

const activeFont = computed(() => latin[props.format].font.value);
const activeIcon = computed(() => icons[props.format].font.value);
const labelFont = computed(() => latin.slug.font.value);
const width = computed(() => sizes.width.value);
const height = computed(() => sizes.height.value);

// The layout speaks in CSS pixels. A perspective camera at this distance shows exactly `height` world units across
// the viewport at z = 0, so one unit there is one pixel. Tres updates the aspect on resize; the distance follows here.
const CAMERA_FOV = 45;
const cameraDistance = computed(() => height.value / 2 / Math.tan((CAMERA_FOV / 2) * (Math.PI / 180)));
const cameraPosition = computed(() => new Vector3(0, 0, cameraDistance.value));

// Template refs through `useTemplateRef` are deep-readonly proxies; Three objects and the adapter's `instance`
// carry private fields and must stay raw, so a plain shallow ref receives it instead.
const hello = shallowRef<VueTextInstance<RasterFormatMetadata> | null>(null);
playground.hello = () => hello.value?.instance;

const labelGap = 128;
const labelWidth = 112;
</script>

<template>
  <!-- Tres aims a camera at the origin when it has no `look-at`; a position must be passed or Tres moves it to (3, 3, 3). -->
  <TresPerspectiveCamera :fov="CAMERA_FOV" :near="1" :far="cameraDistance * 2" :position="cameraPosition" />
  <!-- One retained paragraph per raster format: the key remounts the Three object when the technique changes. -->
  <Text
    v-if="activeFont !== undefined && activeIcon !== undefined"
    ref="hello"
    :key="format"
    :name="`font-${format}`"
    :font="activeFont"
    :constraints="{ width: { mode: 'exact', size: width } }"
    :layout="{ align: 'center', wrap: 'none' }"
    :position="[-width / 2, 32, 0]"
    :style="{ color: '#f4f7ff', fontSize: 64, lineHeight: 1 }"
    @error="(error: unknown) => emit('error', error)"
  >
    {{ message }} <Text :font="activeIcon" :style="{ color: COLORS[format] }">{{ WORLD_ICON }}</Text>
  </Text>
  <!-- A TextGroup lets the planner batch the three labels into one draw. -->
  <TextGroup v-if="labelFont !== undefined" name="format-labels" :position="[0, height / 2 - 48, 0]">
    <Text
      v-for="(candidate, index) in RASTER_FORMATS"
      :key="candidate"
      :font="labelFont"
      :constraints="{ width: { mode: 'exact', size: labelWidth } }"
      :layout="{ align: 'center', wrap: 'none' }"
      :position="[(index - (RASTER_FORMATS.length - 1) / 2) * labelGap - labelWidth / 2, 22, 0]"
      :style="{ color: candidate === format ? COLORS[candidate] : '#aeb9cf', fontSize: 16, letterSpacing: 0.8 }"
    >
      {{ candidate.toUpperCase() }}
    </Text>
  </TextGroup>
</template>
