export interface FontFixtureButtonOption<Id extends string> {
  readonly id: Id;
  readonly label: string;
  readonly metadata: string;
  readonly dataAttribute?: 'icon' | 'zoom';
}

export function FontFixtureButtons<Id extends string>({
  options,
  readOnly = false,
  value,
  onChange,
}: {
  readonly options: readonly FontFixtureButtonOption<Id>[];
  readonly readOnly?: boolean;
  readonly value: Id;
  readonly onChange: (value: Id) => void;
}) {
  return (
    <div className="grid gap-1" data-testid="font-fixture-buttons">
      {options.map((option) => {
        const selected = option.id === value;
        return (
          <button
            aria-pressed={selected}
            className={`rounded-md border px-3 py-2 text-left disabled:cursor-default disabled:opacity-100 ${
              selected
                ? 'border-accent bg-surface-active text-foreground'
                : 'border-border bg-surface text-muted hover:bg-surface-active hover:text-foreground'
            }`}
            data-font-fixture-option={option.id}
            data-icon-font-fixture={option.dataAttribute === 'icon' ? option.id : undefined}
            data-zoom-font-fixture={option.dataAttribute === 'zoom' ? option.id : undefined}
            disabled={readOnly}
            key={option.id}
            type="button"
            onClick={() => onChange(option.id)}
          >
            <span className="block text-xs">{option.label}</span>
            <span className="mt-1 block font-mono text-[8px] leading-tight text-dim">{option.metadata}</span>
          </button>
        );
      })}
    </div>
  );
}
