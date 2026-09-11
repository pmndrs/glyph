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

// At this distance the camera shows exactly `height` world units at z = 0, so one unit is one CSS pixel.
const CAMERA_FOV = 45;
const cameraDistance = computed(() => height.value / 2 / Math.tan((CAMERA_FOV / 2) * (Math.PI / 180)));
const cameraPosition = computed(() => new Vector3(0, 0, cameraDistance.value));

// `useTemplateRef` returns a deep-readonly proxy; Three objects carry private fields and must stay raw.
const hello = shallowRef<VueTextInstance<RasterFormatMetadata> | null>(null);
playground.hello = () => hello.value?.instance;

const labelGap = 128;
const labelWidth = 112;
</script>

<template>
  <!-- Without a position Tres moves the camera to (3, 3, 3). -->
  <TresPerspectiveCamera :fov="CAMERA_FOV" :near="1" :far="cameraDistance * 2" :position="cameraPosition" />
  <Text
    v-if="activeFont !== undefined && activeIcon !== undefined"
    ref="hello"
    :key="format"
    :name="`font-${format}`"
    :font="activeFont"
    :constraints="{ width: { mode: 'exact', size: width } }"
    :layout="{ align: 'center', wrap: 'none' }"
    :position="[-width / 2, 32, 0]"
    :text-style="{ color: '#f4f7ff', fontSize: 64, lineHeight: 1 }"
    @error="(error: unknown) => emit('error', error)"
  >
    {{ message }} <Text :font="activeIcon" :text-style="{ color: COLORS[format] }">{{ WORLD_ICON }}</Text>
  </Text>
  <TextGroup v-if="labelFont !== undefined" name="format-labels" :position="[0, height / 2 - 48, 0]">
    <Text
      v-for="(candidate, index) in RASTER_FORMATS"
      :key="candidate"
      :font="labelFont"
      :constraints="{ width: { mode: 'exact', size: labelWidth } }"
      :layout="{ align: 'center', wrap: 'none' }"
      :position="[(index - (RASTER_FORMATS.length - 1) / 2) * labelGap - labelWidth / 2, 22, 0]"
      :text-style="{ color: candidate === format ? COLORS[candidate] : '#aeb9cf', fontSize: 16, letterSpacing: 0.8 }"
    >
      {{ candidate.toUpperCase() }}
    </Text>
  </TextGroup>
</template>
