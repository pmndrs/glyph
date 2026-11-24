import './styles.css';

import { useWorld } from 'koota/react';
import { useEffect, useState } from 'react';
import { Mode } from '../director/traits';
import { usePreparationStatus } from '../loading/prepare';
import { WORD_COUNT } from '../page/content';
import { Spread } from '../page/traits';
import { Quality } from '../quality/traits';

/** The page's chrome, outside the canvas: a cover until the scene is ready, then a discreet live readout. */
export function Hud() {
  const world = useWorld();
  const { phase, failure } = usePreparationStatus();
  const [readout, setReadout] = useState({ columns: 3, reflow: 0, frame: 0, lite: false, play: false });

  useEffect(() => {
    // Four times a second is as fast as a number can be read.
    const timer = setInterval(() => {
      const spread = world.get(Spread)!;
      const quality = world.get(Quality)!;
      setReadout({
        columns: Math.round(spread.columns),
        reflow: spread.reflowMs,
        frame: quality.frameMs,
        lite: quality.tier === 'lite',
        play: world.get(Mode)!.kind === 'play',
      });
    }, 250);

    return () => clearInterval(timer);
  }, [world]);

  return (
    <>
      <output className="hero-cover" data-ready={phase === 'ready'}>
        {phase === 'failed' ? failure : null}
      </output>
      <p className="hero-readout" aria-live="off">
        {WORD_COUNT.toLocaleString('en')} words · {readout.columns} {readout.columns === 1 ? 'column' : 'columns'} ·
        reflow {readout.reflow.toFixed(1)} ms{readout.lite ? ' · lite' : ''}
      </p>
      <p className="hero-hint" data-shown={readout.play}>
        drag a gutter · fling the star · click to type · scroll to dive
      </p>
    </>
  );
}
