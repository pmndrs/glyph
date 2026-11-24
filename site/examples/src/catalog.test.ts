import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { EXAMPLES, EXAMPLE_SLUGS, SECTION_NAMES, SECTIONS } from './catalog';

describe('examples catalog', () => {
  it('gives every scene one section and one slug', () => {
    const owned = SECTION_NAMES.flatMap((section) => Object.keys(SECTIONS[section]));
    expect(new Set(owned).size).toBe(owned.length);
    expect([...owned].sort()).toEqual([...EXAMPLE_SLUGS].sort());
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
