import { describe, expect, it, vi } from 'vitest';

import { renderGlyphPresentation } from './render-presentation';

describe('renderGlyphPresentation', () => {
  it('renders an installed post-processing pipeline instead of bypassing it', () => {
    const render = vi.fn();
    const renderPipeline = { render: vi.fn() };

    renderGlyphPresentation({ render }, { camera: 'camera', renderPipeline, scene: 'scene' });

    expect(renderPipeline.render).toHaveBeenCalledOnce();
    expect(render).not.toHaveBeenCalled();
  });

  it('renders the scene directly when no pipeline is installed', () => {
    const render = vi.fn();

    renderGlyphPresentation({ render }, { camera: 'camera', renderPipeline: null, scene: 'scene' });

    expect(render).toHaveBeenCalledWith('scene', 'camera');
  });
});
