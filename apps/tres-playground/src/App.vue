<script setup lang="ts">
import { TresCanvas, type TresRendererSetupContext } from '@tresjs/core';
import { NoToneMapping, WebGPURenderer } from 'three/webgpu';
import { ref, toValue } from 'vue';

import Scene from './Scene.vue';
import { RASTER_FORMATS, playground, type RasterFormatName } from './inspect.js';

const format = ref<RasterFormatName>('msdf');
const message = ref('Hello world');
const failure = ref<string | undefined>();
playground.format = () => format.value;

function createRenderer(context: TresRendererSetupContext): WebGPURenderer {
  const renderer = new WebGPURenderer({ antialias: true, canvas: toValue(context.canvas) });
  renderer.toneMapping = NoToneMapping;
  return renderer;
}
</script>

<template>
  <div class="controls">
    <div class="format-switcher" role="group" aria-label="Raster format">
      <button
        v-for="candidate in RASTER_FORMATS"
        :key="candidate"
        type="button"
        :data-format="candidate"
        :aria-pressed="candidate === format"
        @click="format = candidate"
      >
        {{ candidate.toUpperCase() }}
      </button>
    </div>
    <input v-model="message" aria-label="Message" spellcheck="false" />
  </div>
  <p v-if="failure !== undefined" class="fallback">{{ failure }}</p>
  <TresCanvas
    v-else
    :renderer="createRenderer"
    clear-color="#07090f"
    render-mode="always"
    window-size
    @error="(error: unknown) => (failure = String(error))"
  >
    <Scene :format="format" :message="message" @error="(error: unknown) => (failure = String(error))" />
  </TresCanvas>
</template>
