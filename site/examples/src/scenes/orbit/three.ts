import { glyph } from '@pmndrs/glyph';
import { ThreeConfig } from '@pmndrs/glyph/three';
import { slug } from '@pmndrs/glyph/raster/slug';
import {
  AmbientLight,
  DirectionalLight,
  Group,
  Matrix4,
  Mesh,
  SphereGeometry,
  type Renderer,
  type Scene,
} from 'three/webgpu';

import { INTER } from '../../fonts';
import { circle, placeOnPath } from '../../lib/paths';
import {
  LIGHTS,
  RINGS,
  RING_INK,
  RING_LETTER_SPACING,
  RING_WOBBLE,
  SPHERE_SPIN,
  ringFit,
  ringLine,
  ringPitch,
  ringSpaces,
  ringSpacing,
  SPHERE,
} from './config';
import { ringInk, sphereMaterial } from './materials';

/**
 * The imperative twin: two rings are shaped once, broken apart, and placed
 * by matrix on tumbling circles (the React scene writes them word by word
 * instead, one paragraph per word, the same placement). Shadows are the
 * host's: the renderer's shadow map is switched on, both lights cast, the
 * sphere receives, and the ring material masks the shadow pass with the
 * Slug coverage.
 */
export async function mount(scene: Scene, renderer: Renderer): Promise<() => void> {
  await glyph.init();
  const handle = glyph.handle('examples:orbit', ThreeConfig);
  const inter = glyph.fontFace(INTER, { format: [slug] });
  await inter.load();
  renderer.shadowMap.enabled = true;

  const fill = new AmbientLight('#dfe6f5', 0.5);
  const lights = LIGHTS.map((light) => {
    const source = new DirectionalLight(light.color, light.intensity);
    source.position.fromArray(light.position);
    source.castShadow = light.castShadow;
    if (light.castShadow) {
      source.shadow.mapSize.set(4096, 4096);
      source.shadow.camera.near = 1;
      source.shadow.camera.far = 30;
      source.shadow.camera.left = -5;
      source.shadow.camera.right = 5;
      source.shadow.camera.top = 5;
      source.shadow.camera.bottom = -5;
      source.shadow.bias = -0.0004;
    }
    return source;
  });

  const sphere = new Mesh(new SphereGeometry(SPHERE.radius, 64, 64), sphereMaterial());
  sphere.position.set(...SPHERE.position);
  sphere.receiveShadow = true;

  // Two rings on circles around the sphere, shaped once and copied out; their groups tumble every frame.
  const rings = RINGS.map((ring) => {
    const orbit = new Group();
    orbit.position.set(...SPHERE.position);
    const band = handle.createText({
      font: inter.slug,
      material: ringInk,
      text: ringLine(ring), // one copy for now; how many fit comes from measuring this one
      style: { fontSize: ring.size, color: RING_INK, letterSpacing: RING_LETTER_SPACING },
      layout: { wrap: 'none' },
      constraints: { width: { mode: 'exact', size: 80 } },
    });
    band.visible = false; // only ever measured and copied; it must never reach a frame
    orbit.add(band);
    return { ring, orbit, band, path: circle(ring.radius) };
  });
  scene.add(fill, ...lights, sphere, ...rings.map((entry) => entry.orbit));
  glyph.shape(); // one copy of each line commits here, so its pitch can be measured
  // `maxContentWidth` is intrinsic, so it reports what the copy wants rather than the box it was
  // measured in; it trims the trailing space, so it sizes the fit and the glyphs settle the rest.
  const fitted = rings.map((entry) => {
    const line = ringLine(entry.ring);
    const pitch = ringPitch(entry.band.measure().maxContentWidth, entry.ring.size);
    const fit = ringFit(entry.path.length, pitch, ringSpaces(line), entry.ring.size);
    const text = line.repeat(fit.repeats);
    if (fit.repeats > 1) entry.band.set({ text });
    return { ...entry, spacesBefore: ringSpacing(text), extra: fit.extra };
  });
  glyph.shape(); // the fitted bands commit here, so they can be copied
  const copies = fitted.map((entry) => {
    const [glyphs] = entry.band.breakApart();
    glyphs.traverse((object) => {
      object.castShadow = true;
      // Its bounding volume is from the pre-wrap straight line; setMatrixAt moves instances onto
      // the circle every frame without updating it, so frustum culling would judge the wrong box.
      object.frustumCulled = false;
    });
    entry.orbit.add(glyphs);
    return { ...entry, glyphs };
  });

  const m = new Matrix4();
  let frame = 0;
  let elapsed = 0;
  const tick = (): void => {
    elapsed += 1 / 60;
    // The markings are procedural on the body's own local position, so turning the body turns
    // them with it; the light and its shadows are world-space and stay put underneath.
    sphere.rotation.y = elapsed * SPHERE_SPIN;

    for (const { ring, orbit, glyphs, path, spacesBefore, extra } of copies) {
      const [rate, turn] = ring.spin;
      const wobble = 'wobble' in ring ? ring.wobble : RING_WOBBLE;
      orbit.rotation.set(
        ring.tilt + Math.sin(elapsed * rate + ring.phase) * wobble,
        elapsed * turn,
        Math.cos(elapsed * rate * 0.7 + ring.phase) * wobble * 0.7,
      );
      for (let i = 0; i < glyphs.count; i += 1) {
        const rest = glyphs.measurements[i];
        if (rest === undefined) continue;
        // One shaped unit of advance is one unit of arc, so every glyph keeps what the shaper gave
        // it; the circle is closed by growing the word spaces before it, never the letters.
        const advance = rest.originalMatrix.elements[12] ?? 0;
        const s = advance + (spacesBefore[rest.sourceIndex] ?? 0) * extra + elapsed * ring.speed;
        glyphs.setMatrixAt(i, placeOnPath(path, s, 0, 0, rest.originalMatrix, m));
      }
    }

    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);

  return () => {
    cancelAnimationFrame(frame);
    for (const { glyphs, band } of copies) {
      glyphs.dispose();
      band.dispose();
    }
    sphere.geometry.dispose();
    sphere.material.dispose();
    inter.dispose();
    handle.dispose();
  };
}
