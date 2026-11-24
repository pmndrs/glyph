import { explainerPageNames, installExplainerPages, type ExplainerPageDefinition } from './explainer';

const pageModules = import.meta.glob<{ default: ExplainerPageDefinition }>('./pages/*/index.tsx');

async function registerPageExplainers() {
  const pages = new Set(
    [...document.querySelectorAll<HTMLElement>('[data-explainer-page]')].flatMap((element) =>
      explainerPageNames(element.dataset.explainerPage),
    ),
  );
  const definitions = await Promise.all(
    [...pages].map((page) => {
      const load = pageModules[`./pages/${page}/index.tsx`];
      if (load === undefined) throw new TypeError(`Unknown docs explainer page: ${page}`);
      return load().then((module) => [page, module.default] as const);
    }),
  );
  installExplainerPages(new Map(definitions));
}

if (document.readyState === 'complete') void registerPageExplainers();
else window.addEventListener('load', () => void registerPageExplainers(), { once: true });
