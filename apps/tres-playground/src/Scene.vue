<script setup lang="ts">
import { Text, TextGroup, type VueTextInstance } from '@pmndrs/glyph/vue';
import { useBitmap } from '@pmndrs/glyph/vue/bitmap';
import { useMsdf } from '@pmndrs/glyph/vue/msdf';
import { useSlug } from '@pmndrs/glyph/vue/slug';
import type { RasterFormatMetadata } from '@pmndrs/glyph';
import { useTres } from '@tresjs/core';
import type { OrthographicCamera } from 'three/webgpu';
import { computed, shallowRef, watchEffect } from 'vue';

import iconFontUrl from '../../r3f-hello-world/assets/font-awesome-world.font.glb?url';
import latinFontUrl from '../../r3f-hello-world/assets/inter-latin.font.glb?url';
import { COLORS, RASTER_FORMATS, WORLD_ICON, playground, type RasterFormatName } from './inspect.js';

const props = defineProps<{ format: RasterFormatName; message: string }>();
const emit = defineEmits<{ error: [error: unknown] }>();

const { sizes, scene, invalidate } = useTres();
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

// Template refs through `useTemplateRef` are deep-readonly proxies; Three objects and the adapter's `instance`
// carry private fields and must stay raw, so plain shallow refs receive them instead.
const camera = shallowRef<OrthographicCamera | null>(null);
watchEffect(() => {
  const current = camera.value;
  if (current === null) return;
  current.left = -width.value / 2;
  current.right = width.value / 2;
  current.top = height.value / 2;
  current.bottom = -height.value / 2;
  current.updateProjectionMatrix();
  invalidate();
});

const hello = shallowRef<VueTextInstance<RasterFormatMetadata> | null>(null);
playground.hello = () => hello.value?.instance;

const labelGap = 128;
const labelWidth = 112;
</script>

<template>
  <!-- The camera stays at the origin: an orthographic frustum from -1000 to 1000 already contains the z=0 text. -->
  <TresOrthographicCamera ref="camera" :near="-1000" :far="1000" />
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
