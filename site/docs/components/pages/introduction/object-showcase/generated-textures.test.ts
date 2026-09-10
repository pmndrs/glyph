import { describe, expect, it } from 'vitest';

import { GRID_TEXTURE_URL, SKY_TEXTURE_URL } from './generated-textures';

describe('generated object-showcase textures', () => {
  it('ships the grid and sky as inline SVG data rather than external assets', () => {
    expect(GRID_TEXTURE_URL).toMatch(/^data:image\/svg\+xml/);
    expect(decodeURIComponent(GRID_TEXTURE_URL)).toContain('pattern id="major"');
    expect(SKY_TEXTURE_URL).toMatch(/^data:image\/svg\+xml/);
    expect(decodeURIComponent(SKY_TEXTURE_URL)).toContain('linearGradient');
  });
});
