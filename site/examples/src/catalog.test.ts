import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { EXAMPLES, EXAMPLE_SLUGS } from './catalog';

const expected = [
  'kinetic',
  'split-flap',
  'relief',
  'ripple',
  'slug-anatomy',
  'ribbon',
  'orbit',
  'first-text',
  'techniques',
  'text-ladder',
  'zoom',
  'groups',
  'styling',
  'paragraph-layout',
  'justify',
  'decorations',
  'rich-text',
  'editing',
  'caret',
  'measurement',
  'materials',
  'effects',
  'depth',
  'labels',
  'off-axis',
  'bloom',
  'break-apart',
  'arc',
  'batching',
  'shaping',
  'marble-type',
  'card-cycle',
] as const;

describe('examples catalog', () => {
  it('retains the complete reconciled scene inventory', () => {
    expect(EXAMPLE_SLUGS).toEqual(expected);
  });

  it('keeps every catalog entry paired with an R3F scene and imperative Three example', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    for (const slug of EXAMPLE_SLUGS) {
      expect(EXAMPLES[slug].title.length, `${slug} has a title`).toBeGreaterThan(0);
      expect(existsSync(resolve(here, 'scenes', slug, 'scene.tsx')), `${slug} has scene.tsx`).toBe(true);
      expect(existsSync(resolve(here, 'scenes', slug, 'three.ts')), `${slug} has three.ts`).toBe(true);
    }
  });
});
