import { useCallback, useEffect, useRef, useState } from 'react';

const INSTALL = 'npm install @pmndrs/glyph';
const RESET_AFTER = 1600;

function NpmMark() {
  return (
    <svg aria-hidden="true" className="mark" viewBox="0 0 27.23 27.23">
      <rect fill="currentColor" height="27.23" rx="2" width="27.23" />
      <polygon
        className="mark-cut"
        points="5.8 21.75 13.66 21.75 13.66 9.98 17.59 9.98 17.59 21.75 21.52 21.75 21.52 5.5 5.8 5.5 5.8 21.75"
      />
    </svg>
  );
}

function CheckMark() {
  return (
    <svg aria-hidden="true" className="mark" fill="none" viewBox="0 0 24 24">
      <path
        d="M4 12.5 9.5 18 20 6.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2.4"
      />
    </svg>
  );
}

function GitHubMark() {
  return (
    <svg aria-hidden="true" className="mark" viewBox="0 0 24 24">
      <path
        d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23a11.5 11.5 0 0 1 3-.405c1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"
        fill="currentColor"
      />
    </svg>
  );
}

export function Overlay() {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(INSTALL);
    } catch {
      // A denied clipboard is not worth an error state on a landing page; the
      // command is in the button's title either way.
      return;
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), RESET_AFTER);
  }, []);

  return (
    <div className="overlay">
      <nav className="links">
        <button className={`link link-icon${copied ? ' is-copied' : ''}`} onClick={copy} title={INSTALL} type="button">
          <span className="mark-swap">{copied ? <CheckMark /> : <NpmMark />}</span>
          <span className="sr-only">Copy install command</span>
        </button>

        <a
          aria-label="glyph on GitHub"
          className="link link-icon"
          href="https://github.com/pmndrs/glyph"
          rel="noreferrer"
          target="_blank"
        >
          <GitHubMark />
        </a>

        <a className="link link-cta" href="/docs/getting-started/introduction">
          Get Started <span aria-hidden="true">→</span>
        </a>
      </nav>
      <span aria-live="polite" className="sr-only">
        {copied ? 'Install command copied' : ''}
      </span>
    </div>
  );
}
