import { glyph } from '@pmndrs/glyph';
import { GlyphProvider, Text, TextGroup, useMsdf } from '@pmndrs/glyph/react';
import { ThreeConfig, defineTextMaterial } from '@pmndrs/glyph/three';
import { useFrame } from '@react-three/fiber/webgpu';
import { use, useRef, useState } from 'react';
import { vec3 } from 'three/tsl';
import { Frustum, Matrix4, type Camera, type Group, type Mesh, type Object3D } from 'three/webgpu';

import { INTER } from '../../fonts';
import { ACCENT, PAPER, PAPER_DIM } from '../../theme';

/**
 * Frustum culling, counted. Top: three labels, each its own draw, drift out
 * of the frame and back; the caption counts the draws three would submit,
 * with the test the renderer itself applies. Bottom: one word drawn by a
 * material that moves every vertex `SHIFT` units to the left, twice. Its
 * Text slides past the right edge of the frame while the displaced glyphs
 * stay inside it. The first material declares nothing, so its draw is culled
 * with its source and the word blinks out; the second declares
 * `boundsPadding: SHIFT`, which grows the culling bound to cover where the
 * vertices really are.
 */
const SHIFT = 4;

const shifted = (boundsPadding: number) =>
  defineTextMaterial(
    (context) => {
      const material = context.createDefaultMaterial();
      material.positionNode = context.position.add(vec3(-SHIFT, 0, 0));
      return material;
    },
    { boundsPadding },
  );
const undeclared = shifted(0);
const declared = shifted(SHIFT);

const LABELS = [
  { text: 'label one', y: 2.35, speed: 0.55, phase: 0 },
  { text: 'label two', y: 1.75, speed: 0.4, phase: 2.2 },
  { text: 'label three', y: 1.15, speed: 0.7, phase: 4.1 },
] as const;

const handleReady = glyph.init().then(() => glyph.handle('examples:scene-culling', ThreeConfig));

const frustum = new Frustum();
const projection = new Matrix4();

/** The draws of one named root, and how many of them pass the test three's renderer applies before submitting. */
function countDraws(scene: Object3D, camera: Camera, root: string): { submitted: number; total: number } {
  frustum.setFromProjectionMatrix(
    projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
    camera.coordinateSystem,
  );
  let submitted = 0;
  let total = 0;
  scene.getObjectByName(`@pmndrs/glyph:${root}`)?.traverse((object) => {
    const mesh = object as Mesh;
    if (mesh.isMesh !== true || mesh.userData['pmndrsGlyphPrimitiveKind'] === undefined) return;
    total += 1;
    if (!mesh.frustumCulled || frustum.intersectsObject(mesh)) submitted += 1;
  });
  return { submitted, total };
}

export default function Culling() {
  const handle = use(handleReady);
  const inter = useMsdf(INTER);
  const labels = useRef<(Group | null)[]>([]);
  const sources = useRef<(Group | null)[]>([]);
  const [counts, setCounts] = useState({ labels: 0, total: 0, undeclared: 0, declared: 0 });

  useFrame(({ scene, camera, elapsed }) => {
    for (const [index, label] of LABELS.entries()) {
      const node = labels.current[index];
      if (node) node.position.x = Math.sin(elapsed * label.speed + label.phase) * 8.5;
    }
    // The Text itself: its left edge crosses the frame's right edge at x = 5.5.
    const x = 4.6 + Math.sin(elapsed * 0.9) * 2.2;
    for (const node of sources.current) if (node) node.position.x = x;

    const drift = countDraws(scene, camera, 'drift');
    const next = {
      labels: drift.submitted,
      total: drift.total,
      undeclared: countDraws(scene, camera, 'undeclared').submitted,
      declared: countDraws(scene, camera, 'declared').submitted,
    };
    if (
      next.labels !== counts.labels ||
      next.total !== counts.total ||
      next.undeclared !== counts.undeclared ||
      next.declared !== counts.declared
    )
      setCounts(next);
  });

  const caption = { fontSize: 0.2, color: PAPER_DIM, letterSpacing: 0.02 } as const;

  return (
    <>
      <GlyphProvider handle={handle('drift')}>
        {LABELS.map((label, index) => (
          <group key={label.text} ref={(node) => void (labels.current[index] = node)} position={[0, label.y, 0]}>
            {/* `batching="group"` gives each label its own draw, so each is culled on its own. */}
            <TextGroup batching="group">
              <Text
                font={inter}
                style={{ fontSize: 0.42, color: PAPER }}
                layout={{ align: 'center', wrap: 'none' }}
                constraints={{ width: { mode: 'exact', size: 3 } }}
                position={[-1.5, 0, 0]}
              >
                {label.text}
              </Text>
            </TextGroup>
          </group>
        ))}
      </GlyphProvider>
      <Text
        font={inter}
        style={caption}
        layout={{ align: 'center', wrap: 'none' }}
        constraints={{ width: { mode: 'exact', size: 10 } }}
        position={[-5, 0.5, 0]}
      >
        {`draws submitted: ${counts.labels} of ${counts.total} (a label outside the frustum is culled)`}
      </Text>

      {(
        [
          ['undeclared', undeclared, 0, counts.undeclared, -0.75],
          ['declared', declared, SHIFT, counts.declared, -1.85],
        ] as const
      ).map(([root, material, padding, submitted, y], index) => (
        <group key={root} position={[0, y, 0]}>
          <Text
            font={inter}
            style={caption}
            layout={{ wrap: 'none' }}
            constraints={{ width: { mode: 'exact', size: 4 } }}
            position={[-5.1, 0.02, 0]}
          >
            {`boundsPadding: ${padding}   ${submitted === 0 ? 'culled while on screen' : 'drawn'}`}
          </Text>
          <GlyphProvider handle={handle(root)}>
            <group ref={(node) => void (sources.current[index] = node)}>
              <Text
                font={inter}
                material={material}
                style={{ fontSize: 0.6, color: ACCENT }}
                layout={{ wrap: 'none' }}
                position={[0, 0.3, 0]}
              >
                shifted
              </Text>
            </group>
          </GlyphProvider>
        </group>
      ))}
      <Text
        font={inter}
        style={caption}
        layout={{ align: 'center', wrap: 'none' }}
        constraints={{ width: { mode: 'exact', size: 10 } }}
        position={[-5, -2.55, 0]}
      >
        {`the material moves each vertex ${SHIFT} units left; the Text itself slides past the right edge`}
      </Text>
    </>
  );
}
