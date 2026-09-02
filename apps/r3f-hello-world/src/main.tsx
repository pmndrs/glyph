import './styles.css';

type ExampleKind = 'r3f' | 'three';

const selected = selectedExample(new URL(window.location.href));
const root = document.querySelector<HTMLElement>('#root');
if (root === null) throw new Error('Glyph examples need a #root element');

document.documentElement.dataset.example = selected;
document.body.prepend(exampleNavigation(selected));

try {
  const dispose =
    selected === 'three'
      ? await (await import('./three-example.js')).mountThreeExample(root)
      : (await import('./r3f-example.js')).mountR3fExample(root);
  import.meta.hot?.dispose(dispose);
} catch (error) {
  root.replaceChildren(exampleFailure(error));
  throw error;
}

function selectedExample(url: URL): ExampleKind {
  return url.searchParams.get('example') === 'three' ? 'three' : 'r3f';
}

function exampleNavigation(active: ExampleKind): HTMLElement {
  const navigation = document.createElement('nav');
  navigation.className = 'example-navigation';
  navigation.setAttribute('aria-label', 'Glyph example');
  for (const [kind, label] of [
    ['three', 'Three.js'],
    ['r3f', 'React Three Fiber'],
  ] as const) {
    const link = document.createElement('a');
    link.href = `?example=${kind}`;
    link.textContent = label;
    if (kind === active) link.setAttribute('aria-current', 'page');
    navigation.append(link);
  }
  return navigation;
}

function exampleFailure(error: unknown): HTMLElement {
  const fallback = document.createElement('div');
  fallback.className = 'fallback';
  fallback.textContent = error instanceof Error ? error.message : String(error);
  return fallback;
}
