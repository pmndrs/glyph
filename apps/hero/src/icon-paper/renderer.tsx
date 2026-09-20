import { Text } from '@pmndrs/glyph/react';
import { defineTextMaterial, type Glyphs, type Text as ThreeText } from '@pmndrs/glyph/three';
import { useFrame } from '@react-three/fiber/webgpu';
import { useEffect, useMemo, useRef } from 'react';
import { DoubleSide, MeshBasicNodeMaterial, Matrix4, type Group } from 'three/webgpu';
import type { SlugFont } from '../hero/fonts';
import { holeWarp } from '../black-hole/materials';
import { usePreparation } from '../hero/prepare';
import { PATTERN_ANGLE, GLYPHS } from './content';
import { IconPaper } from './traits';
import { iconPaperActions } from './actions';
import { useQuery, useWorld } from 'koota/react';
import type { Entity } from 'koota';

/** Flat, unlit ink for the background pattern: crisp coverage, no lighting cost across hundreds of icons. */
const pattern = defineTextMaterial((context) => {
  if (context.kind !== 'glyph' || context.format !== 'pmndrs.slug') return context.createDefaultMaterial();

  // Opaque, with alpha-to-coverage edges: the icons must write depth, or the glass has nothing behind it to refract.
  // Depth in the paper is carried by colour, not by fading them out.
  const material = new MeshBasicNodeMaterial({ side: DoubleSide });
  material.positionNode = context.position;
  material.colorNode = context.shader.color;
  // Bent round the black hole: each icon curls into the spiral as the outline is integrated where its ink came from.
  const warp = holeWarp(context);
  material.opacityNode = warp.coverage.mul(warp.survive);
  material.alphaToCoverage = true;

  return material;
});

export function IconPaperRenderer({ font }: { readonly font: SlugFont }) {
  return useQuery(IconPaper).map((entity) => <IconPattern key={entity} entity={entity} font={font} />);
}

/**
 * Scrolling icon lattice with spring responses to impacts and the pointer. Each motif swaps glyphs while
 * edge-on.
 */
function IconPattern({ entity, font }: { readonly entity: Entity; readonly font: SlugFont }) {
  const world = useWorld();
  const paper = entity.get(IconPaper)!;
  const { iconSize, depth, opacity } = paper.options!;
  const layout = paper.layout!;
  const count = layout.cells.length;

  const source = useRef<ThreeText<never> | null>(null);
  // Eleven immutable glyph choices per cell. Only the selected record has a nonzero transform, so swaps never
  // reshape text, rebuild a batch, or create a draw mesh while the film is running.
  const pool = useRef<Glyphs | undefined>(undefined);
  const baselines = useRef(useMemo(() => new Float64Array(count * GLYPHS.length), [count]));
  const hidden = useRef(new Matrix4().makeScale(0, 0, 0));
  const matrix = useRef(new Matrix4());
  usePreparation(`icons:${depth}`, () => pool.current !== undefined);

  useEffect(
    () => () => {
      iconPaperActions(world).unmountIconView(entity);
      pool.current?.removeFromParent();
      pool.current?.dispose();
      pool.current = undefined;
    },
    [world, entity],
  );

  const sheet = useRef<Group>(null);

  useFrame(() => {
    const group = sheet.current;

    if (group === null) return;

    if (pool.current === undefined) {
      const text = source.current;

      if (text === null || text.commitState().status !== 'committed') return;

      const [copies, decorations] = text.breakApart();
      decorations?.dispose();
      text.parent?.add(copies);
      text.visible = false;
      copies.name = `icon-pattern-${depth}`;
      pool.current = copies;

      for (let index = 0; index < copies.count; index++) {
        copies.setMatrixAt(index, hidden.current);
        baselines.current[index] = -copies.glyphAt(index)!.advance / 2;
      }

      iconPaperActions(world).mountIconView(entity, {
        group,
        glyphs: copies,
        baselines: baselines.current,
        hidden: hidden.current,
        matrix: matrix.current,
      });
    }
  });

  return (
    <group position={[0, 0, depth]} rotation-z={PATTERN_ANGLE}>
      <group ref={sheet}>
        <Text
          ref={source}
          font={font}
          layout={{ wrap: 'none' }}
          material={pattern}
          style={{ fontSize: iconSize, lineHeight: 1, opacity }}
        >
          {layout.cells.map((entry) => (
            <Text key={entry.key} style={{ color: entry.colour }}>
              {GLYPHS.join('')}
            </Text>
          ))}
        </Text>
      </group>
    </group>
  );
}
