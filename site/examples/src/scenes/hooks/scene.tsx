import { Text } from '@pmndrs/glyph/react';
import { useMsdf } from '@pmndrs/glyph/react/msdf';
import { useFrame } from '@react-three/fiber/webgpu';
import { StrictMode, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { CHORUS_MSDF, INTER } from '../../fonts';
import { ACCENT, PAPER, PAPER_DIM } from '../../theme';
import { PERIOD, PRELOAD_LEAD, rowAt, urlFor, type Row } from './config';

/**
 * The same face mounted cold and mounted warm. Every cycle the left column
 * calls `useMsdf` on a URL nobody has loaded, so the component suspends and
 * the Suspense fallback shows until the face is in; the right column called
 * `useMsdf.preload` on its URL a moment earlier, so the hook finds the face
 * loaded and renders synchronously. Both columns report how long their
 * fallback was on screen. The whole scene sits under StrictMode.
 */
interface Cycle {
  readonly index: number;
  readonly row: Row;
  readonly startedAt: number;
}

interface Shown {
  readonly cold?: number;
  readonly warm?: number;
}

export default function Hooks() {
  const inter = useMsdf(INTER);
  const [cycle, setCycle] = useState<Cycle | undefined>(undefined);
  const [shown, setShown] = useState<Shown>({});
  const current = useRef(-1);
  const preloaded = useRef(-1);

  useFrame(({ elapsed }) => {
    const index = Math.floor(elapsed / PERIOD);
    const next = index + 1;
    if (elapsed - index * PERIOD > PERIOD - PRELOAD_LEAD && preloaded.current !== next) {
      preloaded.current = next;
      // Warms the default handle's cache; a rejection would resurface at mount.
      useMsdf.preload(urlFor(rowAt(next), 'warm', next), CHORUS_MSDF).catch(() => undefined);
    }
    if (current.current === index) return;
    const previous = current.current;
    current.current = index;
    setCycle({ index, row: rowAt(index), startedAt: performance.now() });
    setShown({});
    if (previous >= 0) {
      // Release last cycle's declarations; a mounted lease is never invalidated by this.
      useMsdf.clear(urlFor(rowAt(previous), 'cold', previous), CHORUS_MSDF);
      useMsdf.clear(urlFor(rowAt(previous), 'warm', previous), CHORUS_MSDF);
    }
  });

  const reportCold = useCallback((ms: number) => setShown((s) => (s.cold === ms ? s : { ...s, cold: ms })), []);
  const reportWarm = useCallback((ms: number) => setShown((s) => (s.warm === ms ? s : { ...s, warm: ms })), []);

  return (
    <StrictMode>
      <Column x={-5.2} title="useMsdf(url)" hint="mounted cold: suspends until the face is in" report={shown.cold}>
        {cycle !== undefined && (
          <Suspense key={cycle.index} fallback={<Fallback font={inter} />}>
            <Loaded
              url={urlFor(cycle.row, 'cold', cycle.index)}
              word={cycle.row.word}
              startedAt={cycle.startedAt}
              onShown={reportCold}
            />
          </Suspense>
        )}
      </Column>
      <Column
        x={0.4}
        title="useMsdf.preload(url) first"
        hint={`preloaded ${PRELOAD_LEAD} s earlier: renders at once`}
        report={shown.warm}
      >
        {cycle !== undefined && (
          <Suspense key={cycle.index} fallback={<Fallback font={inter} />}>
            <Loaded
              url={urlFor(cycle.row, 'warm', cycle.index)}
              word={cycle.row.word}
              startedAt={cycle.startedAt}
              onShown={reportWarm}
            />
          </Suspense>
        )}
      </Column>
      <Text
        font={inter}
        style={{ fontSize: 0.26, color: PAPER_DIM, letterSpacing: 0.02 }}
        layout={{ wrap: 'none' }}
        position={[-5.2, -2.45, 0]}
      >
        {cycle === undefined
          ? 'waiting for the first frame'
          : `${cycle.row.note}: a new URL is a new face, so every cycle loads again`}
      </Text>
    </StrictMode>
  );
}

function Column({
  x,
  title,
  hint,
  report,
  children,
}: {
  readonly x: number;
  readonly title: string;
  readonly hint: string;
  readonly report: number | undefined;
  readonly children: ReactNode;
}) {
  const inter = useMsdf(INTER);
  return (
    <group position={[x, 0, 0]}>
      <Text font={inter} style={{ fontSize: 0.34, color: ACCENT }} layout={{ wrap: 'none' }} position={[0, 2.2, 0]}>
        {title}
      </Text>
      <Text font={inter} style={{ fontSize: 0.26, color: PAPER_DIM }} layout={{ wrap: 'none' }} position={[0, 1.7, 0]}>
        {hint}
      </Text>
      <group position={[0, 0.9, 0]}>{children}</group>
      <Text font={inter} style={{ fontSize: 0.3, color: PAPER }} layout={{ wrap: 'none' }} position={[0, -1.3, 0]}>
        {report === undefined ? 'fallback showing' : `fallback shown for ${report} ms`}
      </Text>
    </group>
  );
}

function Fallback({ font }: { readonly font: ReturnType<typeof useMsdf> }) {
  return (
    <Text font={font} style={{ fontSize: 0.5, color: PAPER_DIM }} layout={{ wrap: 'none' }}>
      loading the face
    </Text>
  );
}

function Loaded({
  url,
  word,
  startedAt,
  onShown,
}: {
  readonly url: string;
  readonly word: string;
  readonly startedAt: number;
  readonly onShown: (ms: number) => void;
}) {
  // Suspends on the face's one load Promise when it is not loaded yet; synchronous otherwise.
  const font = useMsdf(url, CHORUS_MSDF);
  useEffect(() => {
    onShown(Math.round(performance.now() - startedAt));
  }, [onShown, startedAt]);
  return (
    <Text font={font} style={{ fontSize: 1.1, color: PAPER }} layout={{ wrap: 'none' }}>
      {word}
    </Text>
  );
}
