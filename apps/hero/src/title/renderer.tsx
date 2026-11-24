import { Text } from '@pmndrs/glyph/react';
import type { Text as ThreeText } from '@pmndrs/glyph/three';
import { useFrame } from '@react-three/fiber/webgpu';
import { useWorld } from 'koota/react';
import { useEffect, useRef } from 'react';
import type { SlugFont } from '../loading/fonts';
import { textPrepared, usePreparation } from '../loading/prepare';
import { HEADLINE, HEADLINE_AT, INK } from '../page/content';
import { pageToWorldX, pageToWorldY } from '../page/utils';
import { titleActions } from './actions';
import { glassHeadline, inkHeadline, titleUniforms } from './materials';

/** The headline: laid out whole and drawn as it is typed, in glass where the tier affords transmission. */
export function HeadlineRenderer({ font, glass }: { readonly font: SlugFont; readonly glass: boolean }) {
  const world = useWorld();
  const text = useRef<ThreeText<never> | null>(null);

  const mounted = useRef(false);
  usePreparation('headline', () => mounted.current && textPrepared(text.current?.parent ?? null));

  useEffect(
    () => () => {
      titleActions(world).unmountHeadlineView();
      mounted.current = false;
    },
    [world],
  );

  useFrame(
    () => {
      // The caret stops are measured from the laid-out line, so the view mounts once that exists.
      if (mounted.current || text.current === null || text.current.commitState().status !== 'committed') return;

      mounted.current = true;
      titleActions(world).mountHeadlineView({
        text: text.current,
        originX: HEADLINE_AT.x,
        originY: HEADLINE_AT.y,
        uniforms: titleUniforms,
      });
    },
    { id: 'hero-headline-prepare', fps: 60 },
  );

  return (
    <group name="headline">
      <Text
        font={font}
        layout={{ wrap: 'none' }}
        material={glass ? glassHeadline : inkHeadline}
        position={[pageToWorldX(HEADLINE_AT.x), pageToWorldY(HEADLINE_AT.y), 0.35]}
        ref={text}
        style={{ color: INK, fontSize: HEADLINE_AT.fontSize, letterSpacing: -0.06, lineHeight: 1 }}
      >
        {HEADLINE}
      </Text>
    </group>
  );
}
