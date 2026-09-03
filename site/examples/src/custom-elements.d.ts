import type { DetailedHTMLProps, HTMLAttributes } from 'react';

import type {
  GlyphOffscreenRootElement,
  GlyphProxyElement,
  GlyphSceneControlElement,
} from '../../docs/components/explainer';

type Attributes<T extends HTMLElement, Extra> = DetailedHTMLProps<HTMLAttributes<T>, T> & Extra;

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'glyph-explainer-root': Attributes<
        GlyphOffscreenRootElement,
        {
          'data-explainer-page': string;
          activation?: 'viewport' | 'pointer';
          'hover-delay'?: string;
          'max-slots'?: string;
          'idle-ttl'?: string;
          'max-dpr'?: string;
          opaque?: boolean;
          stats?: boolean;
        }
      >;
      'glyph-proxy': Attributes<GlyphProxyElement, { root: string; 'data-scene': string; aspect?: string }>;
      'glyph-scene-control': Attributes<
        GlyphSceneControlElement,
        { root: string; proxy?: string; 'data-scene'?: string; 'data-action'?: string }
      >;
    }
  }
}
