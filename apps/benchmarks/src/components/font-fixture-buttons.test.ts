import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { FontFixtureButtons } from './font-fixture-buttons';

describe('FontFixtureButtons', () => {
  it('renders every selectable fixture as a button', () => {
    const markup = renderToStaticMarkup(
      createElement(FontFixtureButtons, {
        options: [
          { id: 'inter', label: 'Inter', metadata: 'Sans' },
          { id: 'serif', label: 'Source Serif', metadata: 'Serif' },
        ],
        value: 'inter',
        onChange: () => undefined,
      }),
    );

    expect(markup.match(/<button/g)).toHaveLength(2);
    expect(markup).not.toContain('<select');
    expect(markup).toContain('aria-pressed="true"');
  });

  it('keeps a sole authenticated fixture to one disabled selected button', () => {
    const markup = renderToStaticMarkup(
      createElement(FontFixtureButtons, {
        options: [
          {
            id: 'font-awesome',
            label: 'Font Awesome',
            metadata: '1,402 packed solid icons',
            dataAttribute: 'icon' as const,
          },
        ],
        readOnly: true,
        value: 'font-awesome',
        onChange: () => undefined,
      }),
    );

    expect(markup.match(/<button/g)).toHaveLength(1);
    expect(markup).toContain('disabled=""');
    expect(markup).toContain('data-icon-font-fixture="font-awesome"');
  });
});
