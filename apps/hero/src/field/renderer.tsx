import { Text } from '@pmndrs/glyph/react';
import type { Glyphs, Text as ThreeText } from '@pmndrs/glyph/three';
import { useFrame } from '@react-three/fiber/webgpu';
import { useEffect, useMemo, useRef } from 'react';
import { Matrix4, type Group } from 'three/webgpu';
import type { Faces } from '../fonts';
import { pattern } from '../materials/ink';
import { usePreparation } from '../startup';
import { PATTERN_ANGLE, GLYPHS, cellMatrix } from './lattice';
import { Field } from './traits';
import { Frame } from '../sequence/traits';
import { useQuery, useWorld } from 'koota/react';
import type { Entity } from 'koota';

export function FieldRenderer({ faces }: { readonly faces: Faces }) {
  return useQuery(Field).map((entity) => <IconPattern key={entity} entity={entity} faces={faces} />);
}

/**
 * One monogram layer: icons on a lattice, the sheet rotated and scrolled so it runs forever, and the lattice itself a
 * mass–spring net that an impact — or the pointer — pushes around. Cells carry a motif, so a change sweeps every icon
 * of that type, each taking its new glyph as it turns edge-on.
 */
function IconPattern({ entity, faces }: { readonly entity: Entity; readonly faces: Faces }) {
  const world = useWorld();
  const field = entity.get(Field)!;
  const {
    options: { iconSize, depth, opacity },
    layout,
  } = field;
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
      pool.current?.removeFromParent();
      pool.current?.dispose();
      pool.current = undefined;
    },
    [],
  );
  const sheet = useRef<Group>(null);
  useFrame(() => {
    const current = entity.get(Field)!;
    const state = current.lattice;
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
    }
    const copies = pool.current;
    group.position.x = -current.offset;
    const now = world.get(Frame)!.now;
    for (let index = 0; index < count; index++) {
      const selected = state.selected[index]!;
      const previous = state.previous[index]!;
      if (selected !== previous) {
        copies.setMatrixAt(index * GLYPHS.length + previous, hidden.current);
        state.previous[index] = selected;
      }
      const record = index * GLYPHS.length + selected;
      if (state.swallowed[index] === 1) copies.setMatrixAt(record, hidden.current);
      else {
        cellMatrix(state.matrix, state, layout, index, baselines.current[record]!, iconSize, now);
        copies.setMatrixAt(record, matrix.current.fromArray(state.matrix));
      }
    }
  });

  return (
    <group position={[0, 0, depth]} rotation-z={PATTERN_ANGLE}>
      <group ref={sheet}>
        <Text
          ref={source}
          font={faces.icons}
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
