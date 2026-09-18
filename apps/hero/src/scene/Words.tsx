import { Text, type R3fTextChild } from '@pmndrs/glyph/react';
import type { slug } from '@pmndrs/glyph';
import type { Text as ThreeText, ThreeTextMaterial } from '@pmndrs/glyph/three';
import type { RefObject } from 'react';
import type { Group } from 'three/webgpu';

import { BACKGROUND_WORDS, HEADLINE, ICON_CODE_POINTS, TITLE, type IconName, type Vec3 } from '../content';
import type { Faces, SlugFont } from '../fonts';
import { glass, ink, silhouette } from '../materials/ink';

export interface RegisteredText {
  readonly text: ThreeText<typeof slug>;
  /** Contact with these glyphs starts the slow-motion impact. */
  readonly impactTarget: boolean;
  /** What the Text currently draws; a prepared break-apart copy is valid only while this is unchanged. '' = nothing. */
  readonly signature: string;
}
export type TextRegistry = Map<string, RegisteredText>;

/** The headline is always laid out in full; `revealed` characters show and the next one blinks as the cursor. */
export interface HeadlineView {
  readonly text: string;
  readonly revealed: number;
  readonly blink: boolean;
}

/** Wide exact box so `align: 'center'` centres every paragraph on its group origin. */
const LAYOUT_WIDTH = 40;
// Restrained: cool greys and ice blues, with one magenta accent so the glass title stays the subject.
const PALETTE = ['#8ea3c8', '#6f86ad', '#a9bcdd', '#7f93bb', '#c76fb0', '#98a9c9'] as const;

interface WordsProps {
  readonly faces: Faces;
  readonly headline: HeadlineView;
  /** The rim twin is hidden while the glass is shattering, when a whole-title silhouette would be wrong. */
  readonly rimVisible: boolean;
  readonly registry: TextRegistry;
  readonly titleGroup: RefObject<Group | null>;
}

export function Words({ faces, headline, registry, rimVisible, titleGroup }: WordsProps) {
  return (
    <>
      <group ref={titleGroup} position={TITLE.position}>
        <Paragraph
          id="title"
          signature={TITLE.text}
          registry={registry}
          impactTarget
          material={glass}
          font={faces[TITLE.face]}
          fontSize={TITLE.fontSize}
          color="#f4f7ff"
        >
          {TITLE.text}
        </Paragraph>
        <group visible={rimVisible}>
          <Paragraph
            id="title-rim"
            signature={TITLE.text}
            registry={registry}
            register={false}
            impactTarget={false}
            material={silhouette}
            font={faces[TITLE.face]}
            fontSize={TITLE.fontSize}
            color="#000000"
          >
            {TITLE.text}
          </Paragraph>
        </group>
      </group>
      <group position={HEADLINE.position}>
        <Paragraph
          id="headline"
          signature={headlineSignature(headline)}
          registry={registry}
          impactTarget
          font={faces[HEADLINE.face]}
          fontSize={HEADLINE.fontSize}
          color="#cfd8ff"
        >
          {headlineChildren(headline)}
        </Paragraph>
      </group>
      {BACKGROUND_WORDS.map((word, index) => {
        const signature = `${word.text ?? ''}:${word.icon ?? ''}`;
        return (
          <group key={signature} position={word.position} rotation-z={word.roll}>
            <Paragraph
              id={`word-${signature}`}
              signature={signature}
              registry={registry}
              impactTarget={false}
              font={word.face === undefined ? faces.icons : faces[word.face]}
              fontSize={word.fontSize}
              color={PALETTE[index % PALETTE.length] ?? '#ffffff'}
            >
              {word.text === undefined
                ? iconCharacter(word.icon)
                : word.icon === undefined
                  ? word.text
                  : [
                      `${word.text} `,
                      <Text font={faces.icons} key="icon">
                        {iconCharacter(word.icon)}
                      </Text>,
                    ]}
            </Paragraph>
          </group>
        );
      })}
    </>
  );
}

function headlineSignature({ text, revealed, blink }: HeadlineView): string {
  return revealed >= text.length ? text : `${text}|${String(revealed)}|${String(blink)}`;
}

/** Hidden characters keep their advance (opacity only), so the centred line never shifts while it is typed. */
function headlineChildren({ text, revealed, blink }: HeadlineView): R3fTextChild<typeof slug> {
  if (revealed >= text.length) return text;
  const shown = text.slice(0, revealed);
  const cursor = text.slice(revealed, revealed + 1);
  const rest = text.slice(revealed + 1);
  return [
    shown === '' ? null : shown,
    <Text key="cursor" style={{ opacity: blink ? 1 : 0 }}>
      {cursor}
    </Text>,
    rest === '' ? null : (
      <Text key="rest" style={{ opacity: 0 }}>
        {rest}
      </Text>
    ),
  ];
}

interface ParagraphProps {
  readonly id: string;
  readonly signature: string;
  readonly registry: TextRegistry;
  readonly impactTarget: boolean;
  /** The rim twin is drawn only in the rim pass, so it takes no part in the break. */
  readonly register?: boolean;
  readonly material?: ThreeTextMaterial;
  readonly font: SlugFont;
  readonly fontSize: number;
  readonly color: string;
  readonly children: R3fTextChild<typeof slug>;
}

function Paragraph({
  id,
  signature,
  registry,
  impactTarget,
  register = true,
  material = ink,
  font,
  fontSize,
  color,
  children,
}: ParagraphProps) {
  const origin: Vec3 = [-LAYOUT_WIDTH / 2, fontSize / 2, 0];
  return (
    <Text
      ref={(text: ThreeText<typeof slug> | null) => {
        if (text === null || !register) return;
        registry.set(id, { text, impactTarget, signature });
        return () => {
          registry.delete(id);
        };
      }}
      constraints={{ width: { mode: 'exact', size: LAYOUT_WIDTH } }}
      font={font}
      layout={{ align: 'center', wrap: 'none' }}
      material={material}
      position={origin}
      style={{ color, fontSize, lineHeight: 1 }}
    >
      {children}
    </Text>
  );
}

function iconCharacter(icon: IconName | undefined): string {
  return icon === undefined ? '' : String.fromCodePoint(ICON_CODE_POINTS[icon]);
}
