import { Text } from '@pmndrs/glyph/react';
import type { Glyphs, Text as ThreeText } from '@pmndrs/glyph/three';
import { useFrame } from '@react-three/fiber/webgpu';
import { useWorld } from 'koota/react';
import { useEffect, useMemo, useRef } from 'react';
import { Box3, Matrix4, Vector3 } from 'three/webgpu';
import { editorActions } from '../editor/actions';
import { BODY_FIELD } from '../editor/traits';
import type { Fonts } from '../loading/fonts';
import { usePreparation } from '../loading/prepare';
import { pageActions } from './actions';
import {
  ACCENT,
  BODY,
  BODY_BOX,
  BODY_TYPE,
  INK,
  INK_DIM,
  KICKER,
  KICKER_AT,
  PAGE,
  PULL_QUOTE,
  PULL_TYPE,
  SIDEBAR_BOX,
  SIDEBAR_TITLE,
  SPECIMENS,
  SPECIMEN_AT,
  STANDFIRST,
  STANDFIRST_AT,
} from './content';
import { bodyMaterial, createPaperMaterial, inkMaterial, pageUniforms } from './materials';
import { BodyView, Script, Spread } from './traits';
import { BODY_HEIGHT, BODY_WIDTH, createLetters, pageToWorldX, pageToWorldY } from './utils';

const ink = new Box3();
const center = new Vector3();
/** The drop cap spans this many body lines. */
const CAP_LINES = 4;

/**
 * The spread: the sheet, the essay flowing through its columns, the pull quote, the standfirst, and the sidebar of
 * scripts. The body is one paragraph. Once it is laid out it is also split into letters, each drawn as its own
 * glyph, so the layout can keep deciding where they belong while springs and bodies decide where they are.
 */
export function PageRenderer({ fonts }: { readonly fonts: Fonts }) {
  const world = useWorld();
  const body = useRef<ThreeText<never> | null>(null);
  const quote = useRef<ThreeText<never> | null>(null);
  const specimens = useRef<(ThreeText<never> | null)[]>([]);
  const letters = useRef<Glyphs | undefined>(undefined);
  const paper = useMemo(() => createPaperMaterial(), []);
  usePreparation('page', () => letters.current !== undefined);

  useEffect(
    () => () => {
      pageActions(world).unmountBodyView();
      letters.current?.dispose();
      letters.current = undefined;
      paper.dispose();
    },
    [world, paper],
  );

  useFrame(
    () => {
      const text = body.current;

      if (text === null || quote.current === null) return;

      let view = world.get(BodyView);

      if (view === undefined) {
        if (text.commitState().status !== 'committed') return;

        view = {
          text,
          quote: quote.current,
          quoteMeasure: -1,
          quoteHeight: 0,
          glyphs: undefined,
          matrix: new Matrix4(),
          boxes: [],
          boxCount: 0,
          statedGeometry: -1,
          statedStone: -1,
          layoutDirty: true,
          originals: new Uint32Array(0),
          originalsRevision: -1,
          byCluster: new Int32Array(0),
          uniforms: pageUniforms,
        };
        pageActions(world).mountBodyView(view);
        const { registerField } = editorActions(world);
        registerField(BODY_FIELD, {
          text,
          originX: BODY_BOX.left,
          originY: BODY_BOX.top,
          width: BODY_WIDTH,
          height: BODY_HEIGHT,
        });

        for (const [index, specimen] of specimens.current.entries()) {
          if (specimen === null) continue;

          registerField(index + 1, {
            text: specimen,
            originX: SIDEBAR_BOX.left,
            originY: SPECIMEN_AT.top + index * SPECIMEN_AT.pitch + 0.5,
            width: SIDEBAR_BOX.right - SIDEBAR_BOX.left,
            height: SPECIMEN_AT.pitch - 0.6,
          });
        }

        return;
      }

      // The flow must have been stated and drawn once before the paragraph can be split as it stands.
      if (view.statedGeometry < 0 || text.commitState().status !== 'committed') return;

      const stale = world.get(Script)!.stale;

      if (world.get(Spread)!.mode !== 'detached' || (view.glyphs !== undefined && !stale)) return;

      // Split the paragraph: from here its letters are drawn one by one, and the paragraph itself only lays out.
      view.glyphs?.dispose();
      const [glyphs, decorations] = text.split();
      decorations?.dispose();
      text.parent?.add(glyphs);
      const source = text.text;
      const next = createLetters(glyphs.count);
      const byCluster = new Int32Array(source.length).fill(-1);

      for (const measurement of glyphs.measurements) {
        const { index } = measurement;
        const glyph = glyphs.glyphAt(index);
        ink.copy(measurement.localInkBounds).getCenter(center);
        next.cluster[index] = glyph.cluster;
        next.fontSize[index] = glyph.fontSize;
        next.shape[index] = glyph.fontHandle * 65_536 + glyph.glyphId;
        // Body-local runs y down. The glyphs' own space runs y up.
        next.x[index] = measurement.drawnOrigin.x;
        next.y[index] = -measurement.drawnOrigin.y;
        next.pivotX[index] = center.x - measurement.drawnOrigin.x;
        next.pivotY[index] = -(center.y - measurement.drawnOrigin.y);

        if (byCluster[glyph.cluster] === -1) byCluster[glyph.cluster] = index;
      }

      next.outlineAt = (index) => glyphs.outlineAt(index);
      const cap = glyphs.measurements[0]!.localInkBounds;
      pageActions(world).adoptLetters(source, next, cap.max.y - cap.min.y);
      view.glyphs = glyphs;
      view.byCluster = byCluster;
      view.originals = new Uint32Array(source.length);
      view.originalsRevision = -1;
      view.layoutDirty = true;
      letters.current = glyphs;
    },
    { id: 'hero-body-prepare', fps: 60 },
  );

  const sidebarWidth = SIDEBAR_BOX.right - SIDEBAR_BOX.left;
  const faces = {
    latin: fonts.mixed,
    arabic: fonts.arabic,
    devanagari: fonts.devanagari,
    thai: fonts.thai,
    japanese: fonts.japanese,
  } as const;

  return (
    <group name="page">
      <mesh material={paper} position={[0, 0, -0.02]}>
        <planeGeometry args={[PAGE.width * 6, PAGE.height * 6]} />
      </mesh>
      <Text
        font={fonts.mono}
        layout={{ wrap: 'none' }}
        material={inkMaterial}
        position={[pageToWorldX(KICKER_AT.x), pageToWorldY(KICKER_AT.y), 0.01]}
        style={{ color: ACCENT, fontSize: KICKER_AT.fontSize, letterSpacing: 0.05, lineHeight: 1 }}
      >
        {KICKER}
      </Text>
      <Text
        constraints={{ width: { mode: 'exact', size: STANDFIRST_AT.width } }}
        font={fonts.serif}
        layout={{ wrap: 'word' }}
        material={inkMaterial}
        position={[pageToWorldX(STANDFIRST_AT.x), pageToWorldY(STANDFIRST_AT.y), 0.01]}
        style={{ color: INK, fontSize: STANDFIRST_AT.fontSize, lineHeight: 1.34 }}
      >
        {STANDFIRST}
      </Text>
      <Text
        constraints={{
          width: { mode: 'exact', size: BODY_WIDTH },
          height: { mode: 'exact', size: BODY_HEIGHT },
        }}
        font={fonts.serif}
        layout={{
          align: 'justify',
          wrap: 'word',
          overflow: 'clip',
          dropCap: { lines: CAP_LINES, marginInline: 0.1 },
          justify: { minWordSpaceRatio: 0.78, maxWordSpaceRatio: 1.7 },
        }}
        material={bodyMaterial}
        name="body"
        position={[pageToWorldX(BODY_BOX.left), pageToWorldY(BODY_BOX.top), 0.01]}
        ref={body}
        style={{ color: INK, fontSize: BODY_TYPE.fontSize, lineHeight: BODY_TYPE.lineHeight }}
      >
        <Text style={{ fontSize: BODY_TYPE.fontSize * BODY_TYPE.lineHeight * CAP_LINES * 1.1 }}>
          {BODY.slice(0, 1)}
        </Text>
        {BODY.slice(1)}
      </Text>
      <Text
        constraints={{ width: { mode: 'exact', size: 8 } }}
        font={fonts.serif}
        layout={{ align: 'center', wrap: 'word' }}
        material={inkMaterial}
        ref={quote}
        style={{ color: ACCENT, fontSize: PULL_TYPE.fontSize, lineHeight: PULL_TYPE.lineHeight }}
      >
        {PULL_QUOTE}
      </Text>
      <Text
        font={fonts.mono}
        layout={{ wrap: 'none' }}
        material={inkMaterial}
        position={[pageToWorldX(SIDEBAR_BOX.left), pageToWorldY(SIDEBAR_BOX.top + 0.1), 0.01]}
        style={{ color: ACCENT, fontSize: 0.25, letterSpacing: 0.05, lineHeight: 1 }}
      >
        {SIDEBAR_TITLE}
      </Text>
      {SPECIMENS.map((specimen, index) => {
        const top = SPECIMEN_AT.top + index * SPECIMEN_AT.pitch;

        return (
          <group key={specimen.label}>
            <Text
              font={fonts.mono}
              layout={{ wrap: 'none' }}
              material={inkMaterial}
              position={[pageToWorldX(SIDEBAR_BOX.left), pageToWorldY(top), 0.01]}
              style={{ color: INK_DIM, fontSize: SPECIMEN_AT.label, letterSpacing: 0.04, lineHeight: 1 }}
            >
              {specimen.label}
            </Text>
            <Text
              constraints={{ width: { mode: 'exact', size: sidebarWidth } }}
              font={faces[specimen.script]}
              layout={{ wrap: 'word' }}
              material={inkMaterial}
              position={[pageToWorldX(SIDEBAR_BOX.left), pageToWorldY(top + 0.5), 0.01]}
              ref={(text: ThreeText<never> | null) => {
                specimens.current[index] = text;
              }}
              style={{
                color: INK,
                direction: specimen.direction,
                fontSize: SPECIMEN_AT.fontSize,
                language: specimen.language,
                lineHeight: specimen.script === 'latin' ? 1.3 : 1.5,
              }}
            >
              {specimen.text}
            </Text>
          </group>
        );
      })}
    </group>
  );
}
