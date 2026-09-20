import { Text, TextGroup, useMsdf } from '@pmndrs/glyph/react';
import type { Text as ThreeText } from '@pmndrs/glyph/three';
import { useFrame, useThree } from '@react-three/fiber/webgpu';
import { useQuery, useTrait, useWorld } from 'koota/react';
import { useEffect, useRef, useState } from 'react';
import { InstancedMesh, PlaneGeometry, type Group } from 'three/webgpu';
import type { Entity } from 'koota';
import { FONT_SIZE } from '../juggler/utils';
import { letterActions } from './actions';
import {
  debrisData,
  debrisMaterial,
  emberMaterial,
  encodeLetterStyle,
  flameData,
  flameMaterial,
  FLAME_CAPACITY,
  STEEL,
} from './materials';
import { paragraphWidth } from './systems';
import { DEBRIS_CAPACITY, Letter, Sentence } from './traits';

type Font = ReturnType<typeof useMsdf>;

/** The sentence's shaped paragraph is kept far below the view; only its layout is read. */
const OFFSCREEN_Y = -100_000;

export function Letters({ font }: { readonly font: Font }) {
  const entities = useQuery(Letter);

  return (
    <>
      <SentenceOracle font={font} />
      <Flames />
      <Shards />
      <TextGroup name="letters">
        {entities.map((entity) => (
          <LetterGlyph entity={entity} font={font} key={entity} />
        ))}
      </TextGroup>
    </>
  );
}

/**
 * The typed text as one uniformly styled paragraph, so kerning and word spacing are the engine's. Each committed
 * layout places every letter on its glyph's ink centre; nothing of this paragraph is ever drawn.
 */
function SentenceOracle({ font }: { readonly font: Font }) {
  const world = useWorld();
  const sentence = useTrait(world, Sentence);
  const viewportWidth = useThree((state) => state.viewport.width);
  const source = useRef<ThreeText<never> | null>(null);
  const revision = useRef(-1);
  const width = paragraphWidth(viewportWidth);

  useFrame(() => {
    const text = source.current;

    if (text === null) return;

    const state = text.commitState();

    if (state.status !== 'committed' || state.revision === revision.current) return;

    revision.current = state.revision;
    const layout = text.glyphs();
    const { placeLetter, setBaselines } = letterActions(world);
    setBaselines(Array.from(layout.lineBaselines));

    for (let line = 0; line < layout.lineCount; line += 1) {
      const start = layout.lineGlyphStarts[line] ?? 0;
      const end = start + (layout.lineGlyphCounts[line] ?? 0);

      for (let glyph = start; glyph < end; glyph += 1) {
        if ((layout.glyphInkWidths[glyph] ?? 0) === 0) continue;

        // Paragraph space runs +Y down; the view runs +Y up.
        placeLetter(
          layout.clusters[glyph]!,
          layout.glyphInkX[glyph]! + layout.glyphInkWidths[glyph]! / 2,
          -(layout.glyphInkY[glyph]! + layout.glyphInkHeights[glyph]! / 2),
          line,
        );
      }
    }
  });

  return (
    <Text
      constraints={{ width: { mode: 'exact', size: width } }}
      font={font}
      layout={{ align: 'center', wrap: 'word' }}
      position={[-width / 2, OFFSCREEN_Y, 0]}
      ref={source}
      style={{ color: STEEL, fontSize: FONT_SIZE, lineHeight: 1.25 }}
    >
      {sentence?.text ?? ''}
    </Text>
  );
}

/** One glyph that follows its letter. Its style colour encodes heat and tint for the shared forge material. */
function LetterGlyph({ entity, font }: { readonly entity: Entity; readonly font: Font }) {
  const world = useWorld();
  const parts = useRef<{ group: Group | null; text: ThreeText<never> | null; mounted: boolean }>({
    group: null,
    text: null,
    mounted: false,
  });
  // Read once: the entity may be exploded and gone before React unmounts this glyph.
  const [{ char, style }] = useState(() => {
    const letter = entity.get(Letter);

    return { char: letter?.char ?? '', style: encodeLetterStyle(1, 0, letter?.index ?? 0) };
  });

  // The text object arrives after the group, so the view mounts from whichever ref settles last.
  const attach = () => {
    const { group, text, mounted } = parts.current;

    if (mounted || group === null || text === null || !entity.isAlive()) return;

    parts.current.mounted = true;
    letterActions(world).mountLetterView(entity, { group, text, centered: false, heat: -1, blend: -1 });
  };

  useEffect(
    () => () => {
      parts.current.mounted = false;
      letterActions(world).unmountLetterView(entity);
    },
    [entity, world],
  );

  return (
    <group
      ref={(group) => {
        parts.current.group = group;
        attach();
      }}
      visible={false}
    >
      <Text
        font={font}
        material={emberMaterial}
        ref={(text) => {
          parts.current.text = text as ThreeText<never> | null;
          attach();
        }}
        style={style}
      >
        {char}
      </Text>
    </group>
  );
}

/** One instanced quad per shard of an exploded letter. */
function Shards() {
  const world = useWorld();
  const [mesh] = useState(() => {
    const instanced = new InstancedMesh(new PlaneGeometry(1, 1), debrisMaterial, DEBRIS_CAPACITY);
    instanced.frustumCulled = false;
    instanced.count = 0;

    return instanced;
  });

  useEffect(() => {
    letterActions(world).mountDebrisView({ mesh, data: debrisData });

    return () => letterActions(world).unmountDebrisView();
  }, [mesh, world]);

  return <primitive object={mesh} />;
}

/** One instanced quad of flames per hot letter. */
function Flames() {
  const world = useWorld();
  const [mesh] = useState(() => {
    const instanced = new InstancedMesh(new PlaneGeometry(1, 1), flameMaterial, FLAME_CAPACITY);
    instanced.frustumCulled = false;
    instanced.count = 0;

    return instanced;
  });

  useEffect(() => {
    letterActions(world).mountFlameView({ mesh, data: flameData });

    return () => letterActions(world).unmountFlameView();
  }, [mesh, world]);

  return <primitive object={mesh} />;
}
