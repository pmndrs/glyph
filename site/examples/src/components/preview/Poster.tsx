import { useState } from 'react';

/**
 * What covers the canvas until it has drawn: the last frame it presented, or
 * a sentinel — the gallery thumbnail when there is one, a card with the
 * example's name when there is not.
 */
export function Poster({
  slug,
  title,
  snapshot,
  hidden,
}: {
  readonly slug: string;
  readonly title: string;
  readonly snapshot: string | undefined;
  readonly hidden: boolean;
}) {
  const [thumbnail, setThumbnail] = useState<'unknown' | 'present' | 'absent'>('unknown');
  const source = snapshot ?? (thumbnail === 'absent' ? undefined : `/examples/thumbnails/${slug}.webp`);
  return (
    <div className="poster" data-hidden={hidden}>
      {source !== undefined && (
        <img
          alt=""
          src={source}
          onLoad={() => setThumbnail('present')}
          onError={() => (snapshot === undefined ? setThumbnail('absent') : undefined)}
        />
      )}
      {source === undefined && (
        <div className="sentinel">
          <span>{title}</span>
        </div>
      )}
    </div>
  );
}
