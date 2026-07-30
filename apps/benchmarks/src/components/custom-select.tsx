import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';

export interface CustomSelectOption {
  readonly disabled?: boolean;
  readonly label: string;
  readonly value: string;
}

export function CustomSelect({
  ariaLabel,
  options,
  value,
  variant = 'field',
  onChange,
}: {
  readonly ariaLabel: string;
  readonly options: readonly CustomSelectOption[];
  readonly value: string;
  readonly variant?: 'field' | 'presentation';
  readonly onChange: (value: string) => void;
}) {
  const selectedLabel = options.find((option) => option.value === value)?.label ?? value;
  return (
    <Select
      value={value}
      onValueChange={(nextValue) => {
        if (typeof nextValue === 'string') onChange(nextValue);
      }}
    >
      <SelectTrigger
        aria-label={ariaLabel}
        className={
          variant === 'presentation'
            ? 'h-8 w-max max-w-[32vw] shrink-0 rounded-md border-border bg-black/80 px-2.5 text-[10px] text-foreground hover:border-accent'
            : 'h-8 w-full rounded-md border-border bg-background px-2.5 text-xs text-foreground hover:bg-surface'
        }
        data-custom-select={ariaLabel}
      >
        <span className={variant === 'presentation' ? 'grid min-w-0 overflow-hidden' : 'min-w-0 truncate'}>
          <span className={variant === 'presentation' ? 'col-start-1 row-start-1 min-w-0 truncate' : ''}>
            {selectedLabel}
          </span>
          {variant === 'presentation' &&
            options.map((option) => (
              <span
                aria-hidden="true"
                className="invisible col-start-1 row-start-1 whitespace-nowrap"
                key={`select-width-${option.value}`}
              >
                {option.label}
              </span>
            ))}
        </span>
      </SelectTrigger>
      <SelectContent
        align="start"
        alignItemWithTrigger={false}
        className="max-h-[min(22rem,60dvh)] min-w-(--anchor-width) rounded-md border border-border bg-black/95 p-1 text-foreground ring-0"
        sideOffset={4}
      >
        {options.map((option) => (
          <SelectItem
            className="cursor-pointer px-2.5 py-2 text-xs text-muted focus:bg-surface-active focus:text-foreground"
            disabled={option.disabled}
            key={option.value}
            value={option.value}
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
