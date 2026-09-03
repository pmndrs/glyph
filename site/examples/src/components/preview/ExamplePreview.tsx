import { Suspense, lazy, useEffect, useEffectEvent, useRef, useState } from 'react';

import type { ExampleEntry } from '../../catalog';
import { Stage } from '../stage';
import { FirstFrame } from './FirstFrame';
import { Poster } from './Poster';

/**
 * An example is alive only while it is in view. Off screen, the last frame
 * the canvas presented is kept as a picture and the root — canvas, device,
 * fonts, engine handle — is torn down. Coming back into view mounts it again
 * behind that picture, and the picture fades once the first live frame has
 * rendered, so the eye never sees a black canvas. Before any frame exists
 * the picture is a sentinel.
 */
const LINGER_MS = 400;

export function ExamplePreview({ slug, entry }: { readonly slug: string; readonly entry: ExampleEntry }) {
  const host = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  const [snapshot, setSnapshot] = useState<string | undefined>(undefined);
  const [live, setLive] = useState(false);
  const [Scene] = useState(() => lazy(entry.load));

  // Reads the current canvas without the observer needing to re-subscribe when state changes.
  const leaveView = useEffectEvent(() => {
    const canvas = host.current?.querySelector('canvas');
    if (canvas !== null && canvas !== undefined && live) {
      try {
        setSnapshot(canvas.toDataURL('image/webp', 0.85)); // the last presented frame
      } catch {
        // A tainted or context-lost canvas keeps whatever picture it already had.
      }
    }
    setLive(false);
    setInView(false);
  });

  useEffect(() => {
    const element = host.current;
    if (element === null) return undefined;
    let leaving: ReturnType<typeof setTimeout> | undefined;
    const observer = new IntersectionObserver(
      ([record]) => {
        if (record === undefined) return;
        if (record.isIntersecting) {
          clearTimeout(leaving);
          leaving = undefined;
          setInView(true);
        } else if (leaving === undefined) {
          leaving = setTimeout(leaveView, LINGER_MS); // a flick past the example does not tear it down
        }
      },
      { threshold: 0, rootMargin: '20% 0px' },
    );
    observer.observe(element);
    return () => {
      clearTimeout(leaving);
      observer.disconnect();
    };
  }, []);

  return (
    <div ref={host} className="preview">
      {inView && (
        <Stage {...entry.stage}>
          <Suspense fallback={null}>
            <Scene />
            <FirstFrame onFrame={() => setLive(true)} />
          </Suspense>
        </Stage>
      )}
      <Poster slug={slug} title={entry.title} snapshot={snapshot} hidden={live} />
    </div>
  );
}
