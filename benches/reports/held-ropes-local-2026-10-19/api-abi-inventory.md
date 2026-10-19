# Packed API, ABI, and size inventory

Generated with Node v24.18.0 (darwin/arm64), zlib 1.3.1-e00f703; pnpm 11.15.1. pnpm-injected user agent: `pnpm/11.15.1 npm/? node/v26.0.0 darwin arm64`.

Archives were read without installing, building, testing, benchmarking, or initializing fonts/renderers. Wasm arities below are JavaScript function `.length` values from import-free modules that instantiated; return types were not checked and no export was called.

| archive         | SHA-256                                                          | auth match | dist JS raw/gzip bytes | dist d.ts raw/gzip bytes | dist Wasm raw/gzip bytes | text-shaper.wasm raw/gzip bytes |
| --------------- | ---------------------------------------------------------------- | ---------- | ---------------------: | -----------------------: | -----------------------: | ------------------------------: |
| candidate       | 2e4342243c55edb56d3a1a32cbd730185c8d172fa5634da9c1f8fc3b0edd9558 | true       |        875875 / 298972 |          494232 / 160334 |        4299758 / 1615935 |                1601557 / 596277 |
| main-4e25a96a   | bbb3375c08fb3db8186ec10e4b766b7170632f7601eb1ec0e90be0197f22eb20 | true       |        864183 / 295743 |          497005 / 161416 |        4160059 / 1560914 |                1462005 / 541363 |
| published-0.1.0 | 6e2bf7bdef50ec528a4e4799b8f067e81335388265fbb4950cbbcf08f840581b | true       |        837472 / 289977 |          474185 / 153004 |        4052612 / 1517196 |                1362353 / 500993 |
| prior328        | e453db3ed8e32bbdf8f8a46f2a7a1bfab6dba02c484933062b30ea842cd57dcd | true       |        875875 / 298972 |          494232 / 160334 |        4298676 / 1615443 |                1600609 / 595884 |

Generated ABI output paths: 5; clean vs HEAD: true. The tracked generator script is listed separately.

- `packages/glyph/src/font-baker/generated/font-baker-abi.ts`
- `packages/glyph/src/generated/bitmap-baker-abi.ts`
- `packages/glyph/src/generated/mtsdf-baker-abi.ts`
- `packages/glyph/src/generated/slug-baker-abi.ts`
- `packages/glyph/src/generated/text-shaper-abi.ts`
- generator: `packages/glyph/scripts/support/generated-typescript-abi.mjs`

## Package metadata

### candidate

```json
{
  "name": "@pmndrs/glyph",
  "version": "0.1.0",
  "exports": {
    ".": {
      "types": {
        "source": "./src/index.ts",
        "default": "./dist/index.d.ts"
      },
      "source": "./src/index.ts",
      "import": "./dist/index.js"
    },
    "./shaders/tsl": {
      "types": {
        "source": "./src/shaders/tsl/index.ts",
        "default": "./dist/shaders/tsl/index.d.ts"
      },
      "source": "./src/shaders/tsl/index.ts",
      "import": "./dist/shaders/tsl/index.js"
    },
    "./shaders/tsl/internal/*": null,
    "./shaders/tsl/slug/internal/*": null,
    "./shaders/typegpu": {
      "types": {
        "source": "./src/shaders/typegpu/index.ts",
        "default": "./dist/shaders/typegpu/index.d.ts"
      },
      "source": "./src/shaders/typegpu/index.ts",
      "import": "./dist/shaders/typegpu/index.js"
    },
    "./shaders/typegpu/internal/*": null,
    "./shaders/typegpu/slug/internal/*": null,
    "./three": {
      "types": {
        "source": "./src/three.ts",
        "default": "./dist/three.d.ts"
      },
      "source": "./src/three.ts",
      "import": "./dist/three.js"
    },
    "./three/internal/*": null,
    "./three/handle": null,
    "./three/schema": null,
    "./three/plan-program-registry": null,
    "./three/codec": null,
    "./three/command-buffer-renderer": null,
    "./three/decorations": null,
    "./three/detached-object": null,
    "./three/engine-plan-target": null,
    "./three/frame-error": null,
    "./three/glyph-measurement": null,
    "./three/glyphs": null,
    "./three/font-loader": null,
    "./three/loader": null,
    "./three/renderer-resources": null,
    "./three/text": null,
    "./three/transform-synchronizer": null,
    "./react": {
      "types": {
        "source": "./src/react/index.ts",
        "default": "./dist/react/index.d.ts"
      },
      "source": "./src/react/index.ts",
      "import": "./dist/react/index.js"
    },
    "./vue": {
      "types": {
        "source": "./src/vue.ts",
        "default": "./dist/vue.d.ts"
      },
      "source": "./src/vue.ts",
      "import": "./dist/vue.js"
    },
    "./vue/internal/*": null,
    "./vue/*": {
      "types": {
        "source": "./src/vue/*.ts",
        "default": "./dist/vue/*.d.ts"
      },
      "source": "./src/vue/*.ts",
      "import": "./dist/vue/*.js"
    },
    "./raster/internal/*": null,
    "./config/font-library": null,
    "./config/raster-host": null,
    "./config/text-property": null,
    "./bakers/bitmap": {
      "types": {
        "source": "./src/bakers/bitmap.ts",
        "default": "./dist/bakers/bitmap.d.ts"
      },
      "source": "./src/bakers/bitmap.ts",
      "import": "./dist/bakers/bitmap.js"
    },
    "./bakers/msdf": {
      "types": {
        "source": "./src/bakers/msdf.ts",
        "default": "./dist/bakers/msdf.d.ts"
      },
      "source": "./src/bakers/msdf.ts",
      "import": "./dist/bakers/msdf.js"
    },
    "./bakers/slug": {
      "types": {
        "source": "./src/bakers/slug.ts",
        "default": "./dist/bakers/slug.d.ts"
      },
      "source": "./src/bakers/slug.ts",
      "import": "./dist/bakers/slug.js"
    },
    "./baker": {
      "types": {
        "source": "./src/bake.ts",
        "default": "./dist/bake.d.ts"
      },
      "source": "./src/bake.ts",
      "import": "./dist/bake.js"
    },
    "./bake": {
      "types": {
        "source": "./src/node/bake.ts",
        "default": "./dist/node/bake.d.ts"
      },
      "source": "./src/node/bake.ts",
      "import": "./dist/node/bake.js"
    },
    "./runtime-bake": {
      "types": {
        "source": "./src/runtime-bake.ts",
        "default": "./dist/runtime-bake.d.ts"
      },
      "source": "./src/runtime-bake.ts",
      "import": "./dist/runtime-bake.js"
    },
    "./loader": null,
    "./internal/*": null,
    "./generated/*": null,
    "./font-baker/*": null,
    "./text-shaper.wasm": "./dist/text-shaper.wasm",
    "./bitmap-baker.wasm": "./dist/bitmap-baker.wasm",
    "./mtsdf-baker.wasm": "./dist/mtsdf-baker.wasm",
    "./slug-baker.wasm": "./dist/slug-baker.wasm",
    "./font-baker.wasm": "./dist/font-baker.wasm",
    "./package.json": "./package.json",
    "./typegpu": {
      "types": {
        "source": "./src/typegpu.ts",
        "default": "./dist/typegpu.d.ts"
      },
      "source": "./src/typegpu.ts",
      "import": "./dist/typegpu.js"
    },
    "./three/typegpu": {
      "types": {
        "source": "./src/three/typegpu.ts",
        "default": "./dist/three/typegpu.d.ts"
      },
      "source": "./src/three/typegpu.ts",
      "import": "./dist/three/typegpu.js"
    },
    "./three/typegpu/internal/*": null,
    "./core": {
      "types": {
        "source": "./src/core.ts",
        "default": "./dist/core.d.ts"
      },
      "source": "./src/core.ts",
      "import": "./dist/core.js"
    }
  },
  "peerDependencies": {
    "@react-three/fiber": ">=9.7.0 <10 || >=10.0.0-alpha.4 <11",
    "@tresjs/core": ">=5.8.3 <6",
    "@typegpu/gl": ">=0.12.4 <0.13",
    "@typegpu/three": ">=0.12.1 <0.13",
    "react": ">=19.0.0 <19.3",
    "three": ">=0.185.0",
    "typegpu": ">=0.12.5 <0.13",
    "vue": ">=3.5 <4"
  },
  "peerDependenciesMeta": {
    "@react-three/fiber": {
      "optional": true
    },
    "@tresjs/core": {
      "optional": true
    },
    "@typegpu/gl": {
      "optional": true
    },
    "@typegpu/three": {
      "optional": true
    },
    "react": {
      "optional": true
    },
    "three": {
      "optional": true
    },
    "typegpu": {
      "optional": true
    },
    "vue": {
      "optional": true
    }
  },
  "dependencies": {
    "ajv": "6.15.0",
    "gltf-validator": "2.0.0-dev.3.10",
    "oxc-parser": "0.150.0",
    "oxc-resolver": "11.24.2",
    "oxc-walker": "1.1.1",
    "suspend-react": "0.1.3"
  }
}
```

### main-4e25a96a

```json
{
  "name": "@pmndrs/glyph",
  "version": "0.1.0",
  "exports": {
    ".": {
      "types": {
        "source": "./src/index.ts",
        "default": "./dist/index.d.ts"
      },
      "source": "./src/index.ts",
      "import": "./dist/index.js"
    },
    "./shaders/tsl": {
      "types": {
        "source": "./src/shaders/tsl/index.ts",
        "default": "./dist/shaders/tsl/index.d.ts"
      },
      "source": "./src/shaders/tsl/index.ts",
      "import": "./dist/shaders/tsl/index.js"
    },
    "./shaders/tsl/internal/*": null,
    "./shaders/tsl/slug/internal/*": null,
    "./shaders/typegpu": {
      "types": {
        "source": "./src/shaders/typegpu/index.ts",
        "default": "./dist/shaders/typegpu/index.d.ts"
      },
      "source": "./src/shaders/typegpu/index.ts",
      "import": "./dist/shaders/typegpu/index.js"
    },
    "./shaders/typegpu/internal/*": null,
    "./shaders/typegpu/slug/internal/*": null,
    "./three": {
      "types": {
        "source": "./src/three.ts",
        "default": "./dist/three.d.ts"
      },
      "source": "./src/three.ts",
      "import": "./dist/three.js"
    },
    "./three/internal/*": null,
    "./three/handle": null,
    "./three/schema": null,
    "./three/plan-program-registry": null,
    "./three/codec": null,
    "./three/command-buffer-renderer": null,
    "./three/decorations": null,
    "./three/detached-object": null,
    "./three/engine-plan-target": null,
    "./three/frame-error": null,
    "./three/glyph-measurement": null,
    "./three/glyphs": null,
    "./three/font-loader": null,
    "./three/loader": null,
    "./three/renderer-resources": null,
    "./three/text": null,
    "./three/transform-synchronizer": null,
    "./react": {
      "types": {
        "source": "./src/react/index.ts",
        "default": "./dist/react/index.d.ts"
      },
      "source": "./src/react/index.ts",
      "import": "./dist/react/index.js"
    },
    "./vue": {
      "types": {
        "source": "./src/vue.ts",
        "default": "./dist/vue.d.ts"
      },
      "source": "./src/vue.ts",
      "import": "./dist/vue.js"
    },
    "./vue/internal/*": null,
    "./vue/*": {
      "types": {
        "source": "./src/vue/*.ts",
        "default": "./dist/vue/*.d.ts"
      },
      "source": "./src/vue/*.ts",
      "import": "./dist/vue/*.js"
    },
    "./raster/internal/*": null,
    "./config/font-library": null,
    "./config/raster-host": null,
    "./config/text-property": null,
    "./bakers/bitmap": {
      "types": {
        "source": "./src/bakers/bitmap.ts",
        "default": "./dist/bakers/bitmap.d.ts"
      },
      "source": "./src/bakers/bitmap.ts",
      "import": "./dist/bakers/bitmap.js"
    },
    "./bakers/msdf": {
      "types": {
        "source": "./src/bakers/msdf.ts",
        "default": "./dist/bakers/msdf.d.ts"
      },
      "source": "./src/bakers/msdf.ts",
      "import": "./dist/bakers/msdf.js"
    },
    "./bakers/slug": {
      "types": {
        "source": "./src/bakers/slug.ts",
        "default": "./dist/bakers/slug.d.ts"
      },
      "source": "./src/bakers/slug.ts",
      "import": "./dist/bakers/slug.js"
    },
    "./baker": {
      "types": {
        "source": "./src/bake.ts",
        "default": "./dist/bake.d.ts"
      },
      "source": "./src/bake.ts",
      "import": "./dist/bake.js"
    },
    "./bake": {
      "types": {
        "source": "./src/node/bake.ts",
        "default": "./dist/node/bake.d.ts"
      },
      "source": "./src/node/bake.ts",
      "import": "./dist/node/bake.js"
    },
    "./runtime-bake": {
      "types": {
        "source": "./src/runtime-bake.ts",
        "default": "./dist/runtime-bake.d.ts"
      },
      "source": "./src/runtime-bake.ts",
      "import": "./dist/runtime-bake.js"
    },
    "./loader": null,
    "./internal/*": null,
    "./generated/*": null,
    "./font-baker/*": null,
    "./text-shaper.wasm": "./dist/text-shaper.wasm",
    "./bitmap-baker.wasm": "./dist/bitmap-baker.wasm",
    "./mtsdf-baker.wasm": "./dist/mtsdf-baker.wasm",
    "./slug-baker.wasm": "./dist/slug-baker.wasm",
    "./font-baker.wasm": "./dist/font-baker.wasm",
    "./package.json": "./package.json",
    "./typegpu": {
      "types": {
        "source": "./src/typegpu.ts",
        "default": "./dist/typegpu.d.ts"
      },
      "source": "./src/typegpu.ts",
      "import": "./dist/typegpu.js"
    },
    "./three/typegpu": {
      "types": {
        "source": "./src/three/typegpu.ts",
        "default": "./dist/three/typegpu.d.ts"
      },
      "source": "./src/three/typegpu.ts",
      "import": "./dist/three/typegpu.js"
    },
    "./three/typegpu/internal/*": null,
    "./core": {
      "types": {
        "source": "./src/core.ts",
        "default": "./dist/core.d.ts"
      },
      "source": "./src/core.ts",
      "import": "./dist/core.js"
    }
  },
  "peerDependencies": {
    "@react-three/fiber": ">=9.7.0 <10 || >=10.0.0-alpha.4 <11",
    "@tresjs/core": ">=5.8.3 <6",
    "@typegpu/gl": ">=0.12.4 <0.13",
    "@typegpu/three": ">=0.12.1 <0.13",
    "react": ">=19.0.0 <19.3",
    "three": ">=0.185.0",
    "typegpu": ">=0.12.5 <0.13",
    "vue": ">=3.5 <4"
  },
  "peerDependenciesMeta": {
    "@react-three/fiber": {
      "optional": true
    },
    "@tresjs/core": {
      "optional": true
    },
    "@typegpu/gl": {
      "optional": true
    },
    "@typegpu/three": {
      "optional": true
    },
    "react": {
      "optional": true
    },
    "three": {
      "optional": true
    },
    "typegpu": {
      "optional": true
    },
    "vue": {
      "optional": true
    }
  },
  "dependencies": {
    "ajv": "6.15.0",
    "gltf-validator": "2.0.0-dev.3.10",
    "oxc-parser": "0.150.0",
    "oxc-resolver": "11.24.2",
    "oxc-walker": "1.1.1",
    "suspend-react": "0.1.3",
    "unicode-segmenter": "0.15.0"
  }
}
```

### published-0.1.0

```json
{
  "name": "@pmndrs/glyph",
  "version": "0.1.0",
  "exports": {
    ".": {
      "types": {
        "source": "./src/index.ts",
        "default": "./dist/index.d.ts"
      },
      "source": "./src/index.ts",
      "import": "./dist/index.js"
    },
    "./shaders/tsl": {
      "types": {
        "source": "./src/shaders/tsl/index.ts",
        "default": "./dist/shaders/tsl/index.d.ts"
      },
      "source": "./src/shaders/tsl/index.ts",
      "import": "./dist/shaders/tsl/index.js"
    },
    "./shaders/tsl/internal/*": null,
    "./shaders/tsl/slug/internal/*": null,
    "./shaders/typegpu": {
      "types": {
        "source": "./src/shaders/typegpu/index.ts",
        "default": "./dist/shaders/typegpu/index.d.ts"
      },
      "source": "./src/shaders/typegpu/index.ts",
      "import": "./dist/shaders/typegpu/index.js"
    },
    "./shaders/typegpu/internal/*": null,
    "./shaders/typegpu/slug/internal/*": null,
    "./three": {
      "types": {
        "source": "./src/three.ts",
        "default": "./dist/three.d.ts"
      },
      "source": "./src/three.ts",
      "import": "./dist/three.js"
    },
    "./three/internal/*": null,
    "./three/handle": null,
    "./three/schema": null,
    "./three/plan-program-registry": null,
    "./three/codec": null,
    "./three/command-buffer-renderer": null,
    "./three/decorations": null,
    "./three/detached-object": null,
    "./three/engine-plan-target": null,
    "./three/frame-error": null,
    "./three/glyph-measurement": null,
    "./three/glyphs": null,
    "./three/font-loader": null,
    "./three/loader": null,
    "./three/renderer-resources": null,
    "./three/text": null,
    "./three/transform-synchronizer": null,
    "./react": {
      "types": {
        "source": "./src/react/index.ts",
        "default": "./dist/react/index.d.ts"
      },
      "source": "./src/react/index.ts",
      "import": "./dist/react/index.js"
    },
    "./vue": {
      "types": {
        "source": "./src/vue.ts",
        "default": "./dist/vue.d.ts"
      },
      "source": "./src/vue.ts",
      "import": "./dist/vue.js"
    },
    "./vue/internal/*": null,
    "./vue/*": {
      "types": {
        "source": "./src/vue/*.ts",
        "default": "./dist/vue/*.d.ts"
      },
      "source": "./src/vue/*.ts",
      "import": "./dist/vue/*.js"
    },
    "./raster/internal/*": null,
    "./config/font-library": null,
    "./config/raster-host": null,
    "./config/text-property": null,
    "./bakers/bitmap": {
      "types": {
        "source": "./src/bakers/bitmap.ts",
        "default": "./dist/bakers/bitmap.d.ts"
      },
      "source": "./src/bakers/bitmap.ts",
      "import": "./dist/bakers/bitmap.js"
    },
    "./bakers/msdf": {
      "types": {
        "source": "./src/bakers/msdf.ts",
        "default": "./dist/bakers/msdf.d.ts"
      },
      "source": "./src/bakers/msdf.ts",
      "import": "./dist/bakers/msdf.js"
    },
    "./bakers/slug": {
      "types": {
        "source": "./src/bakers/slug.ts",
        "default": "./dist/bakers/slug.d.ts"
      },
      "source": "./src/bakers/slug.ts",
      "import": "./dist/bakers/slug.js"
    },
    "./baker": {
      "types": {
        "source": "./src/bake.ts",
        "default": "./dist/bake.d.ts"
      },
      "source": "./src/bake.ts",
      "import": "./dist/bake.js"
    },
    "./bake": {
      "types": {
        "source": "./src/node/bake.ts",
        "default": "./dist/node/bake.d.ts"
      },
      "source": "./src/node/bake.ts",
      "import": "./dist/node/bake.js"
    },
    "./runtime-bake": {
      "types": {
        "source": "./src/runtime-bake.ts",
        "default": "./dist/runtime-bake.d.ts"
      },
      "source": "./src/runtime-bake.ts",
      "import": "./dist/runtime-bake.js"
    },
    "./loader": null,
    "./internal/*": null,
    "./generated/*": null,
    "./font-baker/*": null,
    "./text-shaper.wasm": "./dist/text-shaper.wasm",
    "./bitmap-baker.wasm": "./dist/bitmap-baker.wasm",
    "./mtsdf-baker.wasm": "./dist/mtsdf-baker.wasm",
    "./slug-baker.wasm": "./dist/slug-baker.wasm",
    "./font-baker.wasm": "./dist/font-baker.wasm",
    "./package.json": "./package.json",
    "./typegpu": {
      "types": {
        "source": "./src/typegpu.ts",
        "default": "./dist/typegpu.d.ts"
      },
      "source": "./src/typegpu.ts",
      "import": "./dist/typegpu.js"
    },
    "./three/typegpu": {
      "types": {
        "source": "./src/three/typegpu.ts",
        "default": "./dist/three/typegpu.d.ts"
      },
      "source": "./src/three/typegpu.ts",
      "import": "./dist/three/typegpu.js"
    },
    "./three/typegpu/internal/*": null,
    "./core": {
      "types": {
        "source": "./src/core.ts",
        "default": "./dist/core.d.ts"
      },
      "source": "./src/core.ts",
      "import": "./dist/core.js"
    }
  },
  "peerDependencies": {
    "@react-three/fiber": ">=9.7.0 <10 || >=10.0.0-alpha.4 <11",
    "@tresjs/core": ">=5.8.3 <6",
    "@typegpu/gl": ">=0.12.4 <0.13",
    "@typegpu/three": ">=0.12.1 <0.13",
    "react": ">=19.0.0 <19.3",
    "three": ">=0.185.0",
    "typegpu": ">=0.12.5 <0.13",
    "vue": ">=3.5 <4"
  },
  "peerDependenciesMeta": {
    "@react-three/fiber": {
      "optional": true
    },
    "@tresjs/core": {
      "optional": true
    },
    "@typegpu/gl": {
      "optional": true
    },
    "@typegpu/three": {
      "optional": true
    },
    "react": {
      "optional": true
    },
    "three": {
      "optional": true
    },
    "typegpu": {
      "optional": true
    },
    "vue": {
      "optional": true
    }
  },
  "dependencies": {
    "ajv": "6.15.0",
    "gltf-validator": "2.0.0-dev.3.10",
    "ktx-parse": "1.1.0",
    "oxc-parser": "0.150.0",
    "oxc-resolver": "11.24.2",
    "oxc-walker": "1.1.1",
    "suspend-react": "0.1.3",
    "unicode-segmenter": "0.15.0"
  }
}
```

### prior328

```json
{
  "name": "@pmndrs/glyph",
  "version": "0.1.0",
  "exports": {
    ".": {
      "types": {
        "source": "./src/index.ts",
        "default": "./dist/index.d.ts"
      },
      "source": "./src/index.ts",
      "import": "./dist/index.js"
    },
    "./shaders/tsl": {
      "types": {
        "source": "./src/shaders/tsl/index.ts",
        "default": "./dist/shaders/tsl/index.d.ts"
      },
      "source": "./src/shaders/tsl/index.ts",
      "import": "./dist/shaders/tsl/index.js"
    },
    "./shaders/tsl/internal/*": null,
    "./shaders/tsl/slug/internal/*": null,
    "./shaders/typegpu": {
      "types": {
        "source": "./src/shaders/typegpu/index.ts",
        "default": "./dist/shaders/typegpu/index.d.ts"
      },
      "source": "./src/shaders/typegpu/index.ts",
      "import": "./dist/shaders/typegpu/index.js"
    },
    "./shaders/typegpu/internal/*": null,
    "./shaders/typegpu/slug/internal/*": null,
    "./three": {
      "types": {
        "source": "./src/three.ts",
        "default": "./dist/three.d.ts"
      },
      "source": "./src/three.ts",
      "import": "./dist/three.js"
    },
    "./three/internal/*": null,
    "./three/handle": null,
    "./three/schema": null,
    "./three/plan-program-registry": null,
    "./three/codec": null,
    "./three/command-buffer-renderer": null,
    "./three/decorations": null,
    "./three/detached-object": null,
    "./three/engine-plan-target": null,
    "./three/frame-error": null,
    "./three/glyph-measurement": null,
    "./three/glyphs": null,
    "./three/font-loader": null,
    "./three/loader": null,
    "./three/renderer-resources": null,
    "./three/text": null,
    "./three/transform-synchronizer": null,
    "./react": {
      "types": {
        "source": "./src/react/index.ts",
        "default": "./dist/react/index.d.ts"
      },
      "source": "./src/react/index.ts",
      "import": "./dist/react/index.js"
    },
    "./vue": {
      "types": {
        "source": "./src/vue.ts",
        "default": "./dist/vue.d.ts"
      },
      "source": "./src/vue.ts",
      "import": "./dist/vue.js"
    },
    "./vue/internal/*": null,
    "./vue/*": {
      "types": {
        "source": "./src/vue/*.ts",
        "default": "./dist/vue/*.d.ts"
      },
      "source": "./src/vue/*.ts",
      "import": "./dist/vue/*.js"
    },
    "./raster/internal/*": null,
    "./config/font-library": null,
    "./config/raster-host": null,
    "./config/text-property": null,
    "./bakers/bitmap": {
      "types": {
        "source": "./src/bakers/bitmap.ts",
        "default": "./dist/bakers/bitmap.d.ts"
      },
      "source": "./src/bakers/bitmap.ts",
      "import": "./dist/bakers/bitmap.js"
    },
    "./bakers/msdf": {
      "types": {
        "source": "./src/bakers/msdf.ts",
        "default": "./dist/bakers/msdf.d.ts"
      },
      "source": "./src/bakers/msdf.ts",
      "import": "./dist/bakers/msdf.js"
    },
    "./bakers/slug": {
      "types": {
        "source": "./src/bakers/slug.ts",
        "default": "./dist/bakers/slug.d.ts"
      },
      "source": "./src/bakers/slug.ts",
      "import": "./dist/bakers/slug.js"
    },
    "./baker": {
      "types": {
        "source": "./src/bake.ts",
        "default": "./dist/bake.d.ts"
      },
      "source": "./src/bake.ts",
      "import": "./dist/bake.js"
    },
    "./bake": {
      "types": {
        "source": "./src/node/bake.ts",
        "default": "./dist/node/bake.d.ts"
      },
      "source": "./src/node/bake.ts",
      "import": "./dist/node/bake.js"
    },
    "./runtime-bake": {
      "types": {
        "source": "./src/runtime-bake.ts",
        "default": "./dist/runtime-bake.d.ts"
      },
      "source": "./src/runtime-bake.ts",
      "import": "./dist/runtime-bake.js"
    },
    "./loader": null,
    "./internal/*": null,
    "./generated/*": null,
    "./font-baker/*": null,
    "./text-shaper.wasm": "./dist/text-shaper.wasm",
    "./bitmap-baker.wasm": "./dist/bitmap-baker.wasm",
    "./mtsdf-baker.wasm": "./dist/mtsdf-baker.wasm",
    "./slug-baker.wasm": "./dist/slug-baker.wasm",
    "./font-baker.wasm": "./dist/font-baker.wasm",
    "./package.json": "./package.json",
    "./typegpu": {
      "types": {
        "source": "./src/typegpu.ts",
        "default": "./dist/typegpu.d.ts"
      },
      "source": "./src/typegpu.ts",
      "import": "./dist/typegpu.js"
    },
    "./three/typegpu": {
      "types": {
        "source": "./src/three/typegpu.ts",
        "default": "./dist/three/typegpu.d.ts"
      },
      "source": "./src/three/typegpu.ts",
      "import": "./dist/three/typegpu.js"
    },
    "./three/typegpu/internal/*": null,
    "./core": {
      "types": {
        "source": "./src/core.ts",
        "default": "./dist/core.d.ts"
      },
      "source": "./src/core.ts",
      "import": "./dist/core.js"
    }
  },
  "peerDependencies": {
    "@react-three/fiber": ">=9.7.0 <10 || >=10.0.0-alpha.4 <11",
    "@tresjs/core": ">=5.8.3 <6",
    "@typegpu/gl": ">=0.12.4 <0.13",
    "@typegpu/three": ">=0.12.1 <0.13",
    "react": ">=19.0.0 <19.3",
    "three": ">=0.185.0",
    "typegpu": ">=0.12.5 <0.13",
    "vue": ">=3.5 <4"
  },
  "peerDependenciesMeta": {
    "@react-three/fiber": {
      "optional": true
    },
    "@tresjs/core": {
      "optional": true
    },
    "@typegpu/gl": {
      "optional": true
    },
    "@typegpu/three": {
      "optional": true
    },
    "react": {
      "optional": true
    },
    "three": {
      "optional": true
    },
    "typegpu": {
      "optional": true
    },
    "vue": {
      "optional": true
    }
  },
  "dependencies": {
    "ajv": "6.15.0",
    "gltf-validator": "2.0.0-dev.3.10",
    "oxc-parser": "0.150.0",
    "oxc-resolver": "11.24.2",
    "oxc-walker": "1.1.1",
    "suspend-react": "0.1.3"
  }
}
```

## Wasm modules

### candidate: `package/dist/bitmap-baker.wasm`

Imports: 1; exports: 5; import-free instantiation: false.

| direction  | name                           | kind     |
| ---------- | ------------------------------ | -------- |
| import:env | pmndrs_glyph_bake_progress     | function |
| export     | memory                         | memory   |
| export     | pmndrs_bitmap_baker_alloc      | function |
| export     | pmndrs_bitmap_baker_bake       | function |
| export     | pmndrs_bitmap_baker_dealloc    | function |
| export     | pmndrs_bitmap_baker_result_len | function |

Exported function parameter arities (when safely available; return types unchecked):

No arities collected (imports present or module did not instantiate).

### candidate: `package/dist/font-baker.wasm`

Imports: 0; exports: 7; import-free instantiation: true.

| direction | name                         | kind     |
| --------- | ---------------------------- | -------- |
| export    | memory                       | memory   |
| export    | pmndrs_font_baker_alloc      | function |
| export    | pmndrs_font_baker_bake       | function |
| export    | pmndrs_font_baker_dealloc    | function |
| export    | pmndrs_font_baker_inspect    | function |
| export    | pmndrs_font_baker_prepare    | function |
| export    | pmndrs_font_baker_result_len | function |

Exported function parameter arities (when safely available; return types unchecked):

| function                     | parameter arity | return types checked |
| ---------------------------- | --------------: | -------------------- |
| pmndrs_font_baker_alloc      |               1 | false                |
| pmndrs_font_baker_bake       |               4 | false                |
| pmndrs_font_baker_dealloc    |               2 | false                |
| pmndrs_font_baker_inspect    |               4 | false                |
| pmndrs_font_baker_prepare    |               4 | false                |
| pmndrs_font_baker_result_len |               0 | false                |

### candidate: `package/dist/mtsdf-baker.wasm`

Imports: 1; exports: 16; import-free instantiation: false.

| direction  | name                                        | kind     |
| ---------- | ------------------------------------------- | -------- |
| import:env | pmndrs_glyph_bake_progress                  | function |
| export     | memory                                      | memory   |
| export     | pmndrs_glyph_mtsdf_alloc                    | function |
| export     | pmndrs_glyph_mtsdf_bake                     | function |
| export     | pmndrs_glyph_mtsdf_bake_result_len          | function |
| export     | pmndrs_glyph_mtsdf_dealloc                  | function |
| export     | pmndrs_glyph_mtsdf_generate                 | function |
| export     | pmndrs_glyph_mtsdf_result_len               | function |
| export     | pmndrs_glyph_mtsdf_result_ptr               | function |
| export     | pmndrs_glyph_mtsdf_segmented_artifact_count | function |
| export     | pmndrs_glyph_mtsdf_segmented_artifact_len   | function |
| export     | pmndrs_glyph_mtsdf_segmented_chunk_len      | function |
| export     | pmndrs_glyph_mtsdf_segmented_chunk_ptr      | function |
| export     | pmndrs_glyph_mtsdf_segmented_metadata_len   | function |
| export     | pmndrs_glyph_mtsdf_segmented_metadata_ptr   | function |
| export     | pmndrs_glyph_mtsdf_segmented_release        | function |
| export     | pmndrs_glyph_mtsdf_segmented_status         | function |

Exported function parameter arities (when safely available; return types unchecked):

No arities collected (imports present or module did not instantiate).

### candidate: `package/dist/slug-baker.wasm`

Imports: 1; exports: 13; import-free instantiation: false.

| direction  | name                                       | kind     |
| ---------- | ------------------------------------------ | -------- |
| import:env | pmndrs_glyph_bake_progress                 | function |
| export     | memory                                     | memory   |
| export     | pmndrs_glyph_slug_alloc                    | function |
| export     | pmndrs_glyph_slug_bake                     | function |
| export     | pmndrs_glyph_slug_bake_result_len          | function |
| export     | pmndrs_glyph_slug_dealloc                  | function |
| export     | pmndrs_glyph_slug_segmented_artifact_count | function |
| export     | pmndrs_glyph_slug_segmented_artifact_len   | function |
| export     | pmndrs_glyph_slug_segmented_chunk_len      | function |
| export     | pmndrs_glyph_slug_segmented_chunk_ptr      | function |
| export     | pmndrs_glyph_slug_segmented_metadata_len   | function |
| export     | pmndrs_glyph_slug_segmented_metadata_ptr   | function |
| export     | pmndrs_glyph_slug_segmented_release        | function |
| export     | pmndrs_glyph_slug_segmented_status         | function |

Exported function parameter arities (when safely available; return types unchecked):

No arities collected (imports present or module did not instantiate).

### candidate: `package/dist/text-shaper.wasm`

Imports: 0; exports: 39; import-free instantiation: true.

| direction | name                                        | kind     |
| --------- | ------------------------------------------- | -------- |
| export    | memory                                      | memory   |
| export    | pmndrs_glyph_engine_borrow_paragraph_glyphs | function |
| export    | pmndrs_glyph_engine_borrow_paragraph_layout | function |
| export    | pmndrs_glyph_engine_codec_count             | function |
| export    | pmndrs_glyph_engine_copy_decorations        | function |
| export    | pmndrs_glyph_engine_copy_glyphs             | function |
| export    | pmndrs_glyph_engine_create_root             | function |
| export    | pmndrs_glyph_engine_dispose_codec           | function |
| export    | pmndrs_glyph_engine_dispose_font_binding    | function |
| export    | pmndrs_glyph_engine_dispose_font_stack      | function |
| export    | pmndrs_glyph_engine_dispose_root            | function |
| export    | pmndrs_glyph_engine_font_binding_count      | function |
| export    | pmndrs_glyph_engine_font_stack_count        | function |
| export    | pmndrs_glyph_engine_measure_paragraph       | function |
| export    | pmndrs_glyph_engine_register_codec          | function |
| export    | pmndrs_glyph_engine_register_font_binding   | function |
| export    | pmndrs_glyph_engine_register_font_stack     | function |
| export    | pmndrs_glyph_engine_request_capacity        | function |
| export    | pmndrs_glyph_engine_request_ptr             | function |
| export    | pmndrs_glyph_engine_reserve_root            | function |
| export    | pmndrs_glyph_engine_reserve_update_batch    | function |
| export    | pmndrs_glyph_engine_reset_root              | function |
| export    | pmndrs_glyph_engine_root_count              | function |
| export    | pmndrs_glyph_engine_update                  | function |
| export    | pmndrs_glyph_engine_update_batch            | function |
| export    | pmndrs_glyph_engine_update_batch_capacity   | function |
| export    | pmndrs_glyph_engine_update_batch_ptr        | function |
| export    | pmndrs_glyph_shaper_abi_version             | function |
| export    | pmndrs_glyph_shaper_alloc                   | function |
| export    | pmndrs_glyph_shaper_dealloc                 | function |
| export    | pmndrs_glyph_shaper_dispose_font            | function |
| export    | pmndrs_glyph_shaper_font_count              | function |
| export    | pmndrs_glyph_shaper_glyph_outline           | function |
| export    | pmndrs_glyph_shaper_glyph_outline_len       | function |
| export    | pmndrs_glyph_shaper_glyph_outline_ptr       | function |
| export    | pmndrs_glyph_shaper_initialize              | function |
| export    | pmndrs_glyph_shaper_register_font           | function |
| export    | pmndrs_glyph_shaper_retained_font_bytes     | function |
| export    | pmndrs_glyph_shaper_shape_plan_count        | function |

Exported function parameter arities (when safely available; return types unchecked):

| function                                    | parameter arity | return types checked |
| ------------------------------------------- | --------------: | -------------------- |
| pmndrs_glyph_engine_borrow_paragraph_glyphs |               5 | false                |
| pmndrs_glyph_engine_borrow_paragraph_layout |               2 | false                |
| pmndrs_glyph_engine_codec_count             |               0 | false                |
| pmndrs_glyph_engine_copy_decorations        |               5 | false                |
| pmndrs_glyph_engine_copy_glyphs             |               7 | false                |
| pmndrs_glyph_engine_create_root             |               4 | false                |
| pmndrs_glyph_engine_dispose_codec           |               1 | false                |
| pmndrs_glyph_engine_dispose_font_binding    |               1 | false                |
| pmndrs_glyph_engine_dispose_font_stack      |               1 | false                |
| pmndrs_glyph_engine_dispose_root            |               1 | false                |
| pmndrs_glyph_engine_font_binding_count      |               0 | false                |
| pmndrs_glyph_engine_font_stack_count        |               0 | false                |
| pmndrs_glyph_engine_measure_paragraph       |               4 | false                |
| pmndrs_glyph_engine_register_codec          |               3 | false                |
| pmndrs_glyph_engine_register_font_binding   |               4 | false                |
| pmndrs_glyph_engine_register_font_stack     |               3 | false                |
| pmndrs_glyph_engine_request_capacity        |               1 | false                |
| pmndrs_glyph_engine_request_ptr             |               1 | false                |
| pmndrs_glyph_engine_reserve_root            |               4 | false                |
| pmndrs_glyph_engine_reserve_update_batch    |               1 | false                |
| pmndrs_glyph_engine_reset_root              |               1 | false                |
| pmndrs_glyph_engine_root_count              |               0 | false                |
| pmndrs_glyph_engine_update                  |               3 | false                |
| pmndrs_glyph_engine_update_batch            |               2 | false                |
| pmndrs_glyph_engine_update_batch_capacity   |               0 | false                |
| pmndrs_glyph_engine_update_batch_ptr        |               0 | false                |
| pmndrs_glyph_shaper_abi_version             |               0 | false                |
| pmndrs_glyph_shaper_alloc                   |               1 | false                |
| pmndrs_glyph_shaper_dealloc                 |               2 | false                |
| pmndrs_glyph_shaper_dispose_font            |               1 | false                |
| pmndrs_glyph_shaper_font_count              |               0 | false                |
| pmndrs_glyph_shaper_glyph_outline           |               3 | false                |
| pmndrs_glyph_shaper_glyph_outline_len       |               0 | false                |
| pmndrs_glyph_shaper_glyph_outline_ptr       |               0 | false                |
| pmndrs_glyph_shaper_initialize              |               0 | false                |
| pmndrs_glyph_shaper_register_font           |               9 | false                |
| pmndrs_glyph_shaper_retained_font_bytes     |               0 | false                |
| pmndrs_glyph_shaper_shape_plan_count        |               0 | false                |

### main-4e25a96a: `package/dist/bitmap-baker.wasm`

Imports: 1; exports: 5; import-free instantiation: false.

| direction  | name                           | kind     |
| ---------- | ------------------------------ | -------- |
| import:env | pmndrs_glyph_bake_progress     | function |
| export     | memory                         | memory   |
| export     | pmndrs_bitmap_baker_alloc      | function |
| export     | pmndrs_bitmap_baker_bake       | function |
| export     | pmndrs_bitmap_baker_dealloc    | function |
| export     | pmndrs_bitmap_baker_result_len | function |

Exported function parameter arities (when safely available; return types unchecked):

No arities collected (imports present or module did not instantiate).

### main-4e25a96a: `package/dist/font-baker.wasm`

Imports: 0; exports: 7; import-free instantiation: true.

| direction | name                         | kind     |
| --------- | ---------------------------- | -------- |
| export    | memory                       | memory   |
| export    | pmndrs_font_baker_alloc      | function |
| export    | pmndrs_font_baker_bake       | function |
| export    | pmndrs_font_baker_dealloc    | function |
| export    | pmndrs_font_baker_inspect    | function |
| export    | pmndrs_font_baker_prepare    | function |
| export    | pmndrs_font_baker_result_len | function |

Exported function parameter arities (when safely available; return types unchecked):

| function                     | parameter arity | return types checked |
| ---------------------------- | --------------: | -------------------- |
| pmndrs_font_baker_alloc      |               1 | false                |
| pmndrs_font_baker_bake       |               4 | false                |
| pmndrs_font_baker_dealloc    |               2 | false                |
| pmndrs_font_baker_inspect    |               4 | false                |
| pmndrs_font_baker_prepare    |               4 | false                |
| pmndrs_font_baker_result_len |               0 | false                |

### main-4e25a96a: `package/dist/mtsdf-baker.wasm`

Imports: 1; exports: 16; import-free instantiation: false.

| direction  | name                                        | kind     |
| ---------- | ------------------------------------------- | -------- |
| import:env | pmndrs_glyph_bake_progress                  | function |
| export     | memory                                      | memory   |
| export     | pmndrs_glyph_mtsdf_alloc                    | function |
| export     | pmndrs_glyph_mtsdf_bake                     | function |
| export     | pmndrs_glyph_mtsdf_bake_result_len          | function |
| export     | pmndrs_glyph_mtsdf_dealloc                  | function |
| export     | pmndrs_glyph_mtsdf_generate                 | function |
| export     | pmndrs_glyph_mtsdf_result_len               | function |
| export     | pmndrs_glyph_mtsdf_result_ptr               | function |
| export     | pmndrs_glyph_mtsdf_segmented_artifact_count | function |
| export     | pmndrs_glyph_mtsdf_segmented_artifact_len   | function |
| export     | pmndrs_glyph_mtsdf_segmented_chunk_len      | function |
| export     | pmndrs_glyph_mtsdf_segmented_chunk_ptr      | function |
| export     | pmndrs_glyph_mtsdf_segmented_metadata_len   | function |
| export     | pmndrs_glyph_mtsdf_segmented_metadata_ptr   | function |
| export     | pmndrs_glyph_mtsdf_segmented_release        | function |
| export     | pmndrs_glyph_mtsdf_segmented_status         | function |

Exported function parameter arities (when safely available; return types unchecked):

No arities collected (imports present or module did not instantiate).

### main-4e25a96a: `package/dist/slug-baker.wasm`

Imports: 1; exports: 13; import-free instantiation: false.

| direction  | name                                       | kind     |
| ---------- | ------------------------------------------ | -------- |
| import:env | pmndrs_glyph_bake_progress                 | function |
| export     | memory                                     | memory   |
| export     | pmndrs_glyph_slug_alloc                    | function |
| export     | pmndrs_glyph_slug_bake                     | function |
| export     | pmndrs_glyph_slug_bake_result_len          | function |
| export     | pmndrs_glyph_slug_dealloc                  | function |
| export     | pmndrs_glyph_slug_segmented_artifact_count | function |
| export     | pmndrs_glyph_slug_segmented_artifact_len   | function |
| export     | pmndrs_glyph_slug_segmented_chunk_len      | function |
| export     | pmndrs_glyph_slug_segmented_chunk_ptr      | function |
| export     | pmndrs_glyph_slug_segmented_metadata_len   | function |
| export     | pmndrs_glyph_slug_segmented_metadata_ptr   | function |
| export     | pmndrs_glyph_slug_segmented_release        | function |
| export     | pmndrs_glyph_slug_segmented_status         | function |

Exported function parameter arities (when safely available; return types unchecked):

No arities collected (imports present or module did not instantiate).

### main-4e25a96a: `package/dist/text-shaper.wasm`

Imports: 0; exports: 38; import-free instantiation: true.

| direction | name                                        | kind     |
| --------- | ------------------------------------------- | -------- |
| export    | memory                                      | memory   |
| export    | pmndrs_glyph_engine_borrow_paragraph_glyph  | function |
| export    | pmndrs_glyph_engine_borrow_paragraph_layout | function |
| export    | pmndrs_glyph_engine_codec_count             | function |
| export    | pmndrs_glyph_engine_copy_decorations        | function |
| export    | pmndrs_glyph_engine_copy_glyphs             | function |
| export    | pmndrs_glyph_engine_create_root             | function |
| export    | pmndrs_glyph_engine_dispose_codec           | function |
| export    | pmndrs_glyph_engine_dispose_font_binding    | function |
| export    | pmndrs_glyph_engine_dispose_font_stack      | function |
| export    | pmndrs_glyph_engine_dispose_root            | function |
| export    | pmndrs_glyph_engine_font_binding_count      | function |
| export    | pmndrs_glyph_engine_font_stack_count        | function |
| export    | pmndrs_glyph_engine_measure_paragraph       | function |
| export    | pmndrs_glyph_engine_register_codec          | function |
| export    | pmndrs_glyph_engine_register_font_binding   | function |
| export    | pmndrs_glyph_engine_register_font_stack     | function |
| export    | pmndrs_glyph_engine_request_capacity        | function |
| export    | pmndrs_glyph_engine_request_ptr             | function |
| export    | pmndrs_glyph_engine_reserve_root            | function |
| export    | pmndrs_glyph_engine_reserve_update_batch    | function |
| export    | pmndrs_glyph_engine_root_count              | function |
| export    | pmndrs_glyph_engine_update                  | function |
| export    | pmndrs_glyph_engine_update_batch            | function |
| export    | pmndrs_glyph_engine_update_batch_capacity   | function |
| export    | pmndrs_glyph_engine_update_batch_ptr        | function |
| export    | pmndrs_glyph_shaper_abi_version             | function |
| export    | pmndrs_glyph_shaper_alloc                   | function |
| export    | pmndrs_glyph_shaper_dealloc                 | function |
| export    | pmndrs_glyph_shaper_dispose_font            | function |
| export    | pmndrs_glyph_shaper_font_count              | function |
| export    | pmndrs_glyph_shaper_glyph_outline           | function |
| export    | pmndrs_glyph_shaper_glyph_outline_len       | function |
| export    | pmndrs_glyph_shaper_glyph_outline_ptr       | function |
| export    | pmndrs_glyph_shaper_initialize              | function |
| export    | pmndrs_glyph_shaper_register_font           | function |
| export    | pmndrs_glyph_shaper_retained_font_bytes     | function |
| export    | pmndrs_glyph_shaper_shape_plan_count        | function |

Exported function parameter arities (when safely available; return types unchecked):

| function                                    | parameter arity | return types checked |
| ------------------------------------------- | --------------: | -------------------- |
| pmndrs_glyph_engine_borrow_paragraph_glyph  |               4 | false                |
| pmndrs_glyph_engine_borrow_paragraph_layout |               2 | false                |
| pmndrs_glyph_engine_codec_count             |               0 | false                |
| pmndrs_glyph_engine_copy_decorations        |               5 | false                |
| pmndrs_glyph_engine_copy_glyphs             |               7 | false                |
| pmndrs_glyph_engine_create_root             |               4 | false                |
| pmndrs_glyph_engine_dispose_codec           |               1 | false                |
| pmndrs_glyph_engine_dispose_font_binding    |               1 | false                |
| pmndrs_glyph_engine_dispose_font_stack      |               1 | false                |
| pmndrs_glyph_engine_dispose_root            |               1 | false                |
| pmndrs_glyph_engine_font_binding_count      |               0 | false                |
| pmndrs_glyph_engine_font_stack_count        |               0 | false                |
| pmndrs_glyph_engine_measure_paragraph       |               4 | false                |
| pmndrs_glyph_engine_register_codec          |               3 | false                |
| pmndrs_glyph_engine_register_font_binding   |               4 | false                |
| pmndrs_glyph_engine_register_font_stack     |               3 | false                |
| pmndrs_glyph_engine_request_capacity        |               1 | false                |
| pmndrs_glyph_engine_request_ptr             |               1 | false                |
| pmndrs_glyph_engine_reserve_root            |               4 | false                |
| pmndrs_glyph_engine_reserve_update_batch    |               1 | false                |
| pmndrs_glyph_engine_root_count              |               0 | false                |
| pmndrs_glyph_engine_update                  |               3 | false                |
| pmndrs_glyph_engine_update_batch            |               2 | false                |
| pmndrs_glyph_engine_update_batch_capacity   |               0 | false                |
| pmndrs_glyph_engine_update_batch_ptr        |               0 | false                |
| pmndrs_glyph_shaper_abi_version             |               0 | false                |
| pmndrs_glyph_shaper_alloc                   |               1 | false                |
| pmndrs_glyph_shaper_dealloc                 |               2 | false                |
| pmndrs_glyph_shaper_dispose_font            |               1 | false                |
| pmndrs_glyph_shaper_font_count              |               0 | false                |
| pmndrs_glyph_shaper_glyph_outline           |               3 | false                |
| pmndrs_glyph_shaper_glyph_outline_len       |               0 | false                |
| pmndrs_glyph_shaper_glyph_outline_ptr       |               0 | false                |
| pmndrs_glyph_shaper_initialize              |               0 | false                |
| pmndrs_glyph_shaper_register_font           |               9 | false                |
| pmndrs_glyph_shaper_retained_font_bytes     |               0 | false                |
| pmndrs_glyph_shaper_shape_plan_count        |               0 | false                |

### published-0.1.0: `package/dist/bitmap-baker.wasm`

Imports: 1; exports: 5; import-free instantiation: false.

| direction  | name                           | kind     |
| ---------- | ------------------------------ | -------- |
| import:env | pmndrs_glyph_bake_progress     | function |
| export     | memory                         | memory   |
| export     | pmndrs_bitmap_baker_alloc      | function |
| export     | pmndrs_bitmap_baker_bake       | function |
| export     | pmndrs_bitmap_baker_dealloc    | function |
| export     | pmndrs_bitmap_baker_result_len | function |

Exported function parameter arities (when safely available; return types unchecked):

No arities collected (imports present or module did not instantiate).

### published-0.1.0: `package/dist/font-baker.wasm`

Imports: 0; exports: 7; import-free instantiation: true.

| direction | name                         | kind     |
| --------- | ---------------------------- | -------- |
| export    | memory                       | memory   |
| export    | pmndrs_font_baker_alloc      | function |
| export    | pmndrs_font_baker_bake       | function |
| export    | pmndrs_font_baker_dealloc    | function |
| export    | pmndrs_font_baker_inspect    | function |
| export    | pmndrs_font_baker_prepare    | function |
| export    | pmndrs_font_baker_result_len | function |

Exported function parameter arities (when safely available; return types unchecked):

| function                     | parameter arity | return types checked |
| ---------------------------- | --------------: | -------------------- |
| pmndrs_font_baker_alloc      |               1 | false                |
| pmndrs_font_baker_bake       |               4 | false                |
| pmndrs_font_baker_dealloc    |               2 | false                |
| pmndrs_font_baker_inspect    |               4 | false                |
| pmndrs_font_baker_prepare    |               4 | false                |
| pmndrs_font_baker_result_len |               0 | false                |

### published-0.1.0: `package/dist/mtsdf-baker.wasm`

Imports: 1; exports: 16; import-free instantiation: false.

| direction  | name                                        | kind     |
| ---------- | ------------------------------------------- | -------- |
| import:env | pmndrs_glyph_bake_progress                  | function |
| export     | memory                                      | memory   |
| export     | pmndrs_glyph_mtsdf_alloc                    | function |
| export     | pmndrs_glyph_mtsdf_bake                     | function |
| export     | pmndrs_glyph_mtsdf_bake_result_len          | function |
| export     | pmndrs_glyph_mtsdf_dealloc                  | function |
| export     | pmndrs_glyph_mtsdf_generate                 | function |
| export     | pmndrs_glyph_mtsdf_result_len               | function |
| export     | pmndrs_glyph_mtsdf_result_ptr               | function |
| export     | pmndrs_glyph_mtsdf_segmented_artifact_count | function |
| export     | pmndrs_glyph_mtsdf_segmented_artifact_len   | function |
| export     | pmndrs_glyph_mtsdf_segmented_chunk_len      | function |
| export     | pmndrs_glyph_mtsdf_segmented_chunk_ptr      | function |
| export     | pmndrs_glyph_mtsdf_segmented_metadata_len   | function |
| export     | pmndrs_glyph_mtsdf_segmented_metadata_ptr   | function |
| export     | pmndrs_glyph_mtsdf_segmented_release        | function |
| export     | pmndrs_glyph_mtsdf_segmented_status         | function |

Exported function parameter arities (when safely available; return types unchecked):

No arities collected (imports present or module did not instantiate).

### published-0.1.0: `package/dist/slug-baker.wasm`

Imports: 1; exports: 13; import-free instantiation: false.

| direction  | name                                       | kind     |
| ---------- | ------------------------------------------ | -------- |
| import:env | pmndrs_glyph_bake_progress                 | function |
| export     | memory                                     | memory   |
| export     | pmndrs_glyph_slug_alloc                    | function |
| export     | pmndrs_glyph_slug_bake                     | function |
| export     | pmndrs_glyph_slug_bake_result_len          | function |
| export     | pmndrs_glyph_slug_dealloc                  | function |
| export     | pmndrs_glyph_slug_segmented_artifact_count | function |
| export     | pmndrs_glyph_slug_segmented_artifact_len   | function |
| export     | pmndrs_glyph_slug_segmented_chunk_len      | function |
| export     | pmndrs_glyph_slug_segmented_chunk_ptr      | function |
| export     | pmndrs_glyph_slug_segmented_metadata_len   | function |
| export     | pmndrs_glyph_slug_segmented_metadata_ptr   | function |
| export     | pmndrs_glyph_slug_segmented_release        | function |
| export     | pmndrs_glyph_slug_segmented_status         | function |

Exported function parameter arities (when safely available; return types unchecked):

No arities collected (imports present or module did not instantiate).

### published-0.1.0: `package/dist/text-shaper.wasm`

Imports: 0; exports: 34; import-free instantiation: true.

| direction | name                                        | kind     |
| --------- | ------------------------------------------- | -------- |
| export    | memory                                      | memory   |
| export    | pmndrs_glyph_engine_borrow_paragraph_glyph  | function |
| export    | pmndrs_glyph_engine_borrow_paragraph_layout | function |
| export    | pmndrs_glyph_engine_codec_count             | function |
| export    | pmndrs_glyph_engine_copy_decorations        | function |
| export    | pmndrs_glyph_engine_copy_glyphs             | function |
| export    | pmndrs_glyph_engine_create_root             | function |
| export    | pmndrs_glyph_engine_dispose_codec           | function |
| export    | pmndrs_glyph_engine_dispose_font_binding    | function |
| export    | pmndrs_glyph_engine_dispose_font_stack      | function |
| export    | pmndrs_glyph_engine_dispose_root            | function |
| export    | pmndrs_glyph_engine_font_binding_count      | function |
| export    | pmndrs_glyph_engine_font_stack_count        | function |
| export    | pmndrs_glyph_engine_measure_paragraph       | function |
| export    | pmndrs_glyph_engine_register_codec          | function |
| export    | pmndrs_glyph_engine_register_font_binding   | function |
| export    | pmndrs_glyph_engine_register_font_stack     | function |
| export    | pmndrs_glyph_engine_request_capacity        | function |
| export    | pmndrs_glyph_engine_request_ptr             | function |
| export    | pmndrs_glyph_engine_reserve_root            | function |
| export    | pmndrs_glyph_engine_reserve_update_batch    | function |
| export    | pmndrs_glyph_engine_root_count              | function |
| export    | pmndrs_glyph_engine_update                  | function |
| export    | pmndrs_glyph_engine_update_batch            | function |
| export    | pmndrs_glyph_engine_update_batch_capacity   | function |
| export    | pmndrs_glyph_engine_update_batch_ptr        | function |
| export    | pmndrs_glyph_shaper_alloc                   | function |
| export    | pmndrs_glyph_shaper_dealloc                 | function |
| export    | pmndrs_glyph_shaper_dispose_font            | function |
| export    | pmndrs_glyph_shaper_font_count              | function |
| export    | pmndrs_glyph_shaper_initialize              | function |
| export    | pmndrs_glyph_shaper_register_font           | function |
| export    | pmndrs_glyph_shaper_retained_font_bytes     | function |
| export    | pmndrs_glyph_shaper_shape_plan_count        | function |

Exported function parameter arities (when safely available; return types unchecked):

| function                                    | parameter arity | return types checked |
| ------------------------------------------- | --------------: | -------------------- |
| pmndrs_glyph_engine_borrow_paragraph_glyph  |               4 | false                |
| pmndrs_glyph_engine_borrow_paragraph_layout |               2 | false                |
| pmndrs_glyph_engine_codec_count             |               0 | false                |
| pmndrs_glyph_engine_copy_decorations        |               5 | false                |
| pmndrs_glyph_engine_copy_glyphs             |               7 | false                |
| pmndrs_glyph_engine_create_root             |               4 | false                |
| pmndrs_glyph_engine_dispose_codec           |               1 | false                |
| pmndrs_glyph_engine_dispose_font_binding    |               1 | false                |
| pmndrs_glyph_engine_dispose_font_stack      |               1 | false                |
| pmndrs_glyph_engine_dispose_root            |               1 | false                |
| pmndrs_glyph_engine_font_binding_count      |               0 | false                |
| pmndrs_glyph_engine_font_stack_count        |               0 | false                |
| pmndrs_glyph_engine_measure_paragraph       |               4 | false                |
| pmndrs_glyph_engine_register_codec          |               3 | false                |
| pmndrs_glyph_engine_register_font_binding   |               4 | false                |
| pmndrs_glyph_engine_register_font_stack     |               3 | false                |
| pmndrs_glyph_engine_request_capacity        |               1 | false                |
| pmndrs_glyph_engine_request_ptr             |               1 | false                |
| pmndrs_glyph_engine_reserve_root            |               4 | false                |
| pmndrs_glyph_engine_reserve_update_batch    |               1 | false                |
| pmndrs_glyph_engine_root_count              |               0 | false                |
| pmndrs_glyph_engine_update                  |               3 | false                |
| pmndrs_glyph_engine_update_batch            |               2 | false                |
| pmndrs_glyph_engine_update_batch_capacity   |               0 | false                |
| pmndrs_glyph_engine_update_batch_ptr        |               0 | false                |
| pmndrs_glyph_shaper_alloc                   |               1 | false                |
| pmndrs_glyph_shaper_dealloc                 |               2 | false                |
| pmndrs_glyph_shaper_dispose_font            |               1 | false                |
| pmndrs_glyph_shaper_font_count              |               0 | false                |
| pmndrs_glyph_shaper_initialize              |               0 | false                |
| pmndrs_glyph_shaper_register_font           |               9 | false                |
| pmndrs_glyph_shaper_retained_font_bytes     |               0 | false                |
| pmndrs_glyph_shaper_shape_plan_count        |               0 | false                |

### prior328: `package/dist/bitmap-baker.wasm`

Imports: 1; exports: 5; import-free instantiation: false.

| direction  | name                           | kind     |
| ---------- | ------------------------------ | -------- |
| import:env | pmndrs_glyph_bake_progress     | function |
| export     | memory                         | memory   |
| export     | pmndrs_bitmap_baker_alloc      | function |
| export     | pmndrs_bitmap_baker_bake       | function |
| export     | pmndrs_bitmap_baker_dealloc    | function |
| export     | pmndrs_bitmap_baker_result_len | function |

Exported function parameter arities (when safely available; return types unchecked):

No arities collected (imports present or module did not instantiate).

### prior328: `package/dist/font-baker.wasm`

Imports: 0; exports: 7; import-free instantiation: true.

| direction | name                         | kind     |
| --------- | ---------------------------- | -------- |
| export    | memory                       | memory   |
| export    | pmndrs_font_baker_alloc      | function |
| export    | pmndrs_font_baker_bake       | function |
| export    | pmndrs_font_baker_dealloc    | function |
| export    | pmndrs_font_baker_inspect    | function |
| export    | pmndrs_font_baker_prepare    | function |
| export    | pmndrs_font_baker_result_len | function |

Exported function parameter arities (when safely available; return types unchecked):

| function                     | parameter arity | return types checked |
| ---------------------------- | --------------: | -------------------- |
| pmndrs_font_baker_alloc      |               1 | false                |
| pmndrs_font_baker_bake       |               4 | false                |
| pmndrs_font_baker_dealloc    |               2 | false                |
| pmndrs_font_baker_inspect    |               4 | false                |
| pmndrs_font_baker_prepare    |               4 | false                |
| pmndrs_font_baker_result_len |               0 | false                |

### prior328: `package/dist/mtsdf-baker.wasm`

Imports: 1; exports: 16; import-free instantiation: false.

| direction  | name                                        | kind     |
| ---------- | ------------------------------------------- | -------- |
| import:env | pmndrs_glyph_bake_progress                  | function |
| export     | memory                                      | memory   |
| export     | pmndrs_glyph_mtsdf_alloc                    | function |
| export     | pmndrs_glyph_mtsdf_bake                     | function |
| export     | pmndrs_glyph_mtsdf_bake_result_len          | function |
| export     | pmndrs_glyph_mtsdf_dealloc                  | function |
| export     | pmndrs_glyph_mtsdf_generate                 | function |
| export     | pmndrs_glyph_mtsdf_result_len               | function |
| export     | pmndrs_glyph_mtsdf_result_ptr               | function |
| export     | pmndrs_glyph_mtsdf_segmented_artifact_count | function |
| export     | pmndrs_glyph_mtsdf_segmented_artifact_len   | function |
| export     | pmndrs_glyph_mtsdf_segmented_chunk_len      | function |
| export     | pmndrs_glyph_mtsdf_segmented_chunk_ptr      | function |
| export     | pmndrs_glyph_mtsdf_segmented_metadata_len   | function |
| export     | pmndrs_glyph_mtsdf_segmented_metadata_ptr   | function |
| export     | pmndrs_glyph_mtsdf_segmented_release        | function |
| export     | pmndrs_glyph_mtsdf_segmented_status         | function |

Exported function parameter arities (when safely available; return types unchecked):

No arities collected (imports present or module did not instantiate).

### prior328: `package/dist/slug-baker.wasm`

Imports: 1; exports: 13; import-free instantiation: false.

| direction  | name                                       | kind     |
| ---------- | ------------------------------------------ | -------- |
| import:env | pmndrs_glyph_bake_progress                 | function |
| export     | memory                                     | memory   |
| export     | pmndrs_glyph_slug_alloc                    | function |
| export     | pmndrs_glyph_slug_bake                     | function |
| export     | pmndrs_glyph_slug_bake_result_len          | function |
| export     | pmndrs_glyph_slug_dealloc                  | function |
| export     | pmndrs_glyph_slug_segmented_artifact_count | function |
| export     | pmndrs_glyph_slug_segmented_artifact_len   | function |
| export     | pmndrs_glyph_slug_segmented_chunk_len      | function |
| export     | pmndrs_glyph_slug_segmented_chunk_ptr      | function |
| export     | pmndrs_glyph_slug_segmented_metadata_len   | function |
| export     | pmndrs_glyph_slug_segmented_metadata_ptr   | function |
| export     | pmndrs_glyph_slug_segmented_release        | function |
| export     | pmndrs_glyph_slug_segmented_status         | function |

Exported function parameter arities (when safely available; return types unchecked):

No arities collected (imports present or module did not instantiate).

### prior328: `package/dist/text-shaper.wasm`

Imports: 0; exports: 39; import-free instantiation: true.

| direction | name                                        | kind     |
| --------- | ------------------------------------------- | -------- |
| export    | memory                                      | memory   |
| export    | pmndrs_glyph_engine_borrow_paragraph_glyphs | function |
| export    | pmndrs_glyph_engine_borrow_paragraph_layout | function |
| export    | pmndrs_glyph_engine_codec_count             | function |
| export    | pmndrs_glyph_engine_copy_decorations        | function |
| export    | pmndrs_glyph_engine_copy_glyphs             | function |
| export    | pmndrs_glyph_engine_create_root             | function |
| export    | pmndrs_glyph_engine_dispose_codec           | function |
| export    | pmndrs_glyph_engine_dispose_font_binding    | function |
| export    | pmndrs_glyph_engine_dispose_font_stack      | function |
| export    | pmndrs_glyph_engine_dispose_root            | function |
| export    | pmndrs_glyph_engine_font_binding_count      | function |
| export    | pmndrs_glyph_engine_font_stack_count        | function |
| export    | pmndrs_glyph_engine_measure_paragraph       | function |
| export    | pmndrs_glyph_engine_register_codec          | function |
| export    | pmndrs_glyph_engine_register_font_binding   | function |
| export    | pmndrs_glyph_engine_register_font_stack     | function |
| export    | pmndrs_glyph_engine_request_capacity        | function |
| export    | pmndrs_glyph_engine_request_ptr             | function |
| export    | pmndrs_glyph_engine_reserve_root            | function |
| export    | pmndrs_glyph_engine_reserve_update_batch    | function |
| export    | pmndrs_glyph_engine_reset_root              | function |
| export    | pmndrs_glyph_engine_root_count              | function |
| export    | pmndrs_glyph_engine_update                  | function |
| export    | pmndrs_glyph_engine_update_batch            | function |
| export    | pmndrs_glyph_engine_update_batch_capacity   | function |
| export    | pmndrs_glyph_engine_update_batch_ptr        | function |
| export    | pmndrs_glyph_shaper_abi_version             | function |
| export    | pmndrs_glyph_shaper_alloc                   | function |
| export    | pmndrs_glyph_shaper_dealloc                 | function |
| export    | pmndrs_glyph_shaper_dispose_font            | function |
| export    | pmndrs_glyph_shaper_font_count              | function |
| export    | pmndrs_glyph_shaper_glyph_outline           | function |
| export    | pmndrs_glyph_shaper_glyph_outline_len       | function |
| export    | pmndrs_glyph_shaper_glyph_outline_ptr       | function |
| export    | pmndrs_glyph_shaper_initialize              | function |
| export    | pmndrs_glyph_shaper_register_font           | function |
| export    | pmndrs_glyph_shaper_retained_font_bytes     | function |
| export    | pmndrs_glyph_shaper_shape_plan_count        | function |

Exported function parameter arities (when safely available; return types unchecked):

| function                                    | parameter arity | return types checked |
| ------------------------------------------- | --------------: | -------------------- |
| pmndrs_glyph_engine_borrow_paragraph_glyphs |               5 | false                |
| pmndrs_glyph_engine_borrow_paragraph_layout |               2 | false                |
| pmndrs_glyph_engine_codec_count             |               0 | false                |
| pmndrs_glyph_engine_copy_decorations        |               5 | false                |
| pmndrs_glyph_engine_copy_glyphs             |               7 | false                |
| pmndrs_glyph_engine_create_root             |               4 | false                |
| pmndrs_glyph_engine_dispose_codec           |               1 | false                |
| pmndrs_glyph_engine_dispose_font_binding    |               1 | false                |
| pmndrs_glyph_engine_dispose_font_stack      |               1 | false                |
| pmndrs_glyph_engine_dispose_root            |               1 | false                |
| pmndrs_glyph_engine_font_binding_count      |               0 | false                |
| pmndrs_glyph_engine_font_stack_count        |               0 | false                |
| pmndrs_glyph_engine_measure_paragraph       |               4 | false                |
| pmndrs_glyph_engine_register_codec          |               3 | false                |
| pmndrs_glyph_engine_register_font_binding   |               4 | false                |
| pmndrs_glyph_engine_register_font_stack     |               3 | false                |
| pmndrs_glyph_engine_request_capacity        |               1 | false                |
| pmndrs_glyph_engine_request_ptr             |               1 | false                |
| pmndrs_glyph_engine_reserve_root            |               4 | false                |
| pmndrs_glyph_engine_reserve_update_batch    |               1 | false                |
| pmndrs_glyph_engine_reset_root              |               1 | false                |
| pmndrs_glyph_engine_root_count              |               0 | false                |
| pmndrs_glyph_engine_update                  |               3 | false                |
| pmndrs_glyph_engine_update_batch            |               2 | false                |
| pmndrs_glyph_engine_update_batch_capacity   |               0 | false                |
| pmndrs_glyph_engine_update_batch_ptr        |               0 | false                |
| pmndrs_glyph_shaper_abi_version             |               0 | false                |
| pmndrs_glyph_shaper_alloc                   |               1 | false                |
| pmndrs_glyph_shaper_dealloc                 |               2 | false                |
| pmndrs_glyph_shaper_dispose_font            |               1 | false                |
| pmndrs_glyph_shaper_font_count              |               0 | false                |
| pmndrs_glyph_shaper_glyph_outline           |               3 | false                |
| pmndrs_glyph_shaper_glyph_outline_len       |               0 | false                |
| pmndrs_glyph_shaper_glyph_outline_ptr       |               0 | false                |
| pmndrs_glyph_shaper_initialize              |               0 | false                |
| pmndrs_glyph_shaper_register_font           |               9 | false                |
| pmndrs_glyph_shaper_retained_font_bytes     |               0 | false                |
| pmndrs_glyph_shaper_shape_plan_count        |               0 | false                |

## Source review context

Existing source review: `/Volumes/Depot/Developer/glyph/.cache/held-rerun-20261019/evidence/current-contract-review.md` — The existing bounded source review reported no concrete current API, ABI, peer dependency, or lifecycle defect confirmed; it is source evidence, not runtime proof.

## Main to current declaration identities

```json
{
  "addedFilePaths": [],
  "removedFilePaths": [],
  "changedMembersByFile": {}
}
```

## Expected generated shaper export changes

```json
{
  "actualMainToCurrentWasmExportDelta": {
    "added": ["pmndrs_glyph_engine_borrow_paragraph_glyphs", "pmndrs_glyph_engine_reset_root"],
    "removed": ["pmndrs_glyph_engine_borrow_paragraph_glyph"]
  },
  "sourceExpected": {
    "generatedTypescriptMap": "packages/glyph/src/generated/text-shaper-abi.ts:274 and :302 map borrowParagraphGlyphs → pmndrs_glyph_engine_borrow_paragraph_glyphs and resetRoot → pmndrs_glyph_engine_reset_root",
    "rustExports": "packages/glyph/rust/shaper/src/wasm.rs:391 and :1152 define pmndrs_glyph_engine_reset_root and pmndrs_glyph_engine_borrow_paragraph_glyphs"
  }
}
```

## Named shaper compression receipts

```json
{
  "node24": {
    "method": "zlib.gzipSync(text-shaper.wasm bytes, { level: 9, mtime: 0 })",
    "rawBytes": 1601557,
    "gzipBytes": 596277
  },
  "existingPythonInventory": {
    "path": "/Volumes/Depot/Developer/glyph/.cache/held-rerun-20261019/evidence/size-and-member-inventory.json",
    "method": "Python gzip.compress level9 mtime0; independent member compression sum, not bundled gzip or tarball",
    "python": "3.14.6",
    "zlib": "1.2.12",
    "rawBytes": 1601557,
    "gzipBytes": 591794
  },
  "note": "Separate runtime receipts; retain each method and result without averaging or combining their compressed sizes."
}
```

Shipping-module diagnostic-like exports found: 0.
