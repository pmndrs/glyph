import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const contractRoot = new URL('../../fixtures/contracts/', import.meta.url);

describe('paragraph fixture contract', () => {
  it('pins the independently measured natural and wrapped paragraph layouts', async () => {
    const paragraph = JSON.parse(await readFile(new URL('paragraph-layout-v0.json', contractRoot), 'utf8'));

    expect(paragraph.constraints.map(({ width }: { width: number }) => width)).toEqual([720, 360]);
    expect(paragraph.status).toBe('golden');
    expect(paragraph.goldens).toMatchObject({
      natural: { layout: { hash: 'bb15bbcc', glyphCount: 55 } },
      wide: { layout: { hash: 'f8b5c3ee', glyphCount: 55 } },
      narrow: { layout: { hash: '5c178199', glyphCount: 55 } },
    });
  });
});
