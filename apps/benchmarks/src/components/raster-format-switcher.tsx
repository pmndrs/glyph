import type { RasterFormatName } from '../benchmark/url-state';

function formatLabel(format: RasterFormatName): 'Bitmap' | 'MSDF' | 'Slug' {
  return format === 'mtsdf' ? 'MSDF' : format === 'slug' ? 'Slug' : 'Bitmap';
}

export function RasterFormatSwitcher({
  className,
  format,
  onFormat,
  presentation = 'main',
}: {
  readonly className: string;
  readonly format: RasterFormatName;
  readonly onFormat: (format: RasterFormatName) => void;
  readonly presentation?: 'main' | 'presentation';
}) {
  return (
    <div
      className={`grid grid-cols-3 gap-1 ${presentation === 'main' ? 'rounded-md border border-border bg-background p-0.5' : 'h-8 rounded-md border border-border bg-black/80 p-0.5'} ${className}`}
      data-testid="raster-format-switcher"
    >
      {(['bitmap', 'mtsdf', 'slug'] as const).map((value) => (
        <button
          aria-pressed={format === value}
          className={`${presentation === 'presentation' ? 'h-full min-h-0 px-2' : 'min-h-7 px-1.5'} rounded text-[10px] font-medium capitalize transition-colors ${format === value ? 'bg-surface-active text-foreground ring-1 ring-inset ring-accent' : 'text-muted hover:bg-surface hover:text-foreground'} disabled:cursor-not-allowed disabled:opacity-45`}
          key={value}
          type="button"
          onClick={() => onFormat(value)}
        >
          {formatLabel(value)}
        </button>
      ))}
    </div>
  );
}
