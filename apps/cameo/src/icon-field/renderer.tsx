import { Text } from '@pmndrs/glyph/react';
import { defineTextMaterial, type Glyphs, type Text as ThreeText } from '@pmndrs/glyph/three';
import { useFrame } from '@react-three/fiber/webgpu';
import type { Entity } from 'koota';
import { useQuery, useWorld } from 'koota/react';
import { useEffect, useMemo, useRef } from 'react';
import { DoubleSide, type Group, Matrix4, MeshStandardNodeMaterial } from 'three/webgpu';
import type { SlugFont } from '../cameo/fonts';
import { usePreparation } from '../cameo/prepare';
import { iconFieldActions } from './actions';
import { GLYPHS, PATTERN_ANGLE, PATTERN_CENTRE } from './content';
import { IconField } from './traits';

/**
 * Flat ink printed on the floor. It is lit only enough to take the robot's shadow, with a normal straight up
 * rather than the quad's own, so hundreds of cells cost one constant term each and the sheet still darkens when
 * the robot rolls over it.
 */
const printed = defineTextMaterial((context) => {
  if (context.kind !== 'glyph' || context.format !== 'pmndrs.slug') return context.createDefaultMaterial();

  const material = new MeshStandardNodeMaterial({ side: DoubleSide, roughness: 1, metalness: 0 });
  material.name = 'cameo-icon-field';
  material.positionNode = context.position;
  material.colorNode = context.shader.color;
  material.opacityNode = context.shader.coverage;
  material.alphaToCoverage = true;

  return material;
});

export function IconFieldRenderer({ font }: { readonly font: SlugFont }) {
  return useQuery(IconField).map((entity) => <IconSheet key={entity} entity={entity} font={font} />);
}

/**
 * One scrolling sheet. Every cell carries all eleven glyph choices, and only the selected record has a nonzero
 * transform, so a motif flip never reshapes text, rebuilds a batch, or creates a draw mesh while the film runs.
 */
function IconSheet({ entity, font }: { readonly entity: Entity; readonly font: SlugFont }) {
  const world = useWorld();
  const field = entity.get(IconField)!;
  const { iconSize, height, opacity } = field.options!;
  const layout = field.layout!;
  const count = layout.cells.length;

  const source = useRef<ThreeText<never> | null>(null);
  const pool = useRef<Glyphs | undefined>(undefined);
  const baselines = useRef(useMemo(() => new Float64Array(count * GLYPHS.length), [count]));
  const hidden = useRef(new Matrix4().makeScale(0, 0, 0));
  const matrix = useRef(new Matrix4());
  usePreparation(`icons:${height}`, () => pool.current !== undefined);

  useEffect(
    () => () => {
      iconFieldActions(world).unmountIconView(entity);
      pool.current?.removeFromParent();
      pool.current?.dispose();
      pool.current = undefined;
    },
    [world, entity],
  );

  const sheet = useRef<Group>(null);

  useFrame(() => {
    const group = sheet.current;

    if (group === null || pool.current !== undefined) return;

    const text = source.current;

    if (text === null || text.commitState().status !== 'committed') return;

    const [copies, decorations] = text.breakApart();
    decorations?.dispose();
    text.parent?.add(copies);
    text.visible = false;
    copies.name = `cameo-icon-sheet-${height}`;
    copies.receiveShadow = true;
    pool.current = copies;

    for (let index = 0; index < copies.count; index++) {
      copies.setMatrixAt(index, hidden.current);
      baselines.current[index] = -copies.glyphAt(index)!.advance / 2;
    }

    iconFieldActions(world).mountIconView(entity, {
      group,
      glyphs: copies,
      baselines: baselines.current,
      hidden: hidden.current,
      matrix: matrix.current,
      written: new Float64Array(count * 16).fill(Number.NaN),
    });
  });

  return (
    <group position={[PATTERN_CENTRE[0], PATTERN_CENTRE[1], height]} rotation-z={PATTERN_ANGLE}>
      <group ref={sheet}>
        <Text
          font={font}
          layout={{ wrap: 'none' }}
          material={printed}
          ref={source}
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
