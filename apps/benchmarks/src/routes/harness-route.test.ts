import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

describe('harness route ownership', () => {
  it('keeps Main and Presentation on one persistent component identity', async () => {
    const [app, route, controller, layout] = await Promise.all([
      readFile(new URL('../app.tsx', import.meta.url), 'utf8'),
      readFile(new URL('./harness-route.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../controllers/harness-controller.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../surfaces/harness/persistent-layout.tsx', import.meta.url), 'utf8'),
    ]);

    expect(app.match(/<HarnessRoute /g)).toHaveLength(2);
    expect(app).not.toContain('MainRoute');
    expect(app).not.toContain('PresentationRoute');
    expect(route).toContain('<RuntimeWorldProvider>');
    expect(route).toContain('<HarnessController layout={layout} />');
    expect(controller).not.toContain('PersistentRenderHostProvider');
    expect(layout).toContain('<PersistentRenderHostProvider');
  });
});
