import type * as THREE from 'three/webgpu';

import type { PortableResourceGroupPayload, PortableTextureArrayPayload } from '../../src/index.js';
import type { RetainedSlugPage, ThreeRendererResources } from '../../src/three/internal/renderer-resources.js';

declare const resources: ThreeRendererResources;
declare const textureKey: PortableTextureArrayPayload;
declare const slugKey: PortableResourceGroupPayload;
declare const texture: THREE.DataArrayTexture;
declare const slugPage: RetainedSlugPage;

resources.acquireTextureArrayResource(textureKey, () => texture).resource satisfies THREE.DataArrayTexture;
resources.acquireSlugPageResource(slugKey, () => slugPage).resource satisfies RetainedSlugPage;

// @ts-expect-error A texture-array identity cannot be acquired through an incompatible resource creator.
resources.acquireTextureArrayResource(textureKey, () => slugPage);
// @ts-expect-error A slug-page identity cannot be acquired through an incompatible resource creator.
resources.acquireSlugPageResource(slugKey, () => texture);
