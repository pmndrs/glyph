import type { RasterTechnique } from '../benchmark/url-state';

function techniqueLabel(technique: RasterTechnique): 'Bitmap' | 'MSDF' | 'Slug' {
  return technique === 'mtsdf' ? 'MSDF' : technique === 'slug' ? 'Slug' : 'Bitmap';
}

export function TechniqueSwitcher({
  className,
  presentation = 'main',
  technique,
  onTechnique,
}: {
  readonly className: string;
  readonly presentation?: 'main' | 'zen';
  readonly technique: RasterTechnique;
  readonly onTechnique: (technique: RasterTechnique) => void;
}) {
  return (
    <div
      className={`grid grid-cols-3 gap-1 ${presentation === 'main' ? 'rounded-md border border-border bg-background p-0.5' : 'h-8 rounded-lg border border-border/80 bg-black/70 p-0.5'} ${className}`}
      data-testid="technique-switcher"
    >
      {(['bitmap', 'mtsdf', 'slug'] as const).map((value) => (
        <button
          aria-pressed={technique === value}
          className={`${presentation === 'zen' ? 'h-full min-h-0' : 'min-h-7'} rounded px-2 text-[10px] font-medium capitalize transition-colors ${technique === value ? 'bg-surface-active text-foreground ring-1 ring-inset ring-accent' : 'text-muted hover:bg-surface hover:text-foreground'} disabled:cursor-not-allowed disabled:opacity-45`}
          key={value}
          type="button"
          onClick={() => onTechnique(value)}
        >
          {techniqueLabel(value)}
        </button>
      ))}
    </div>
  );
}
