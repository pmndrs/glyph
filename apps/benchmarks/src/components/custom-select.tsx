// oxlint-disable jsx-a11y/prefer-tag-over-role -- This application-owned listbox intentionally avoids native select UI.
import { useId, useState, type KeyboardEvent } from 'react';

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
  readonly variant?: 'field' | 'zen';
  readonly onChange: (value: string) => void;
}) {
  const listboxId = useId();
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const selected = options[selectedIndex];

  const openListbox = (): void => {
    setActiveIndex(selectedIndex);
    setOpen(true);
  };
  const closeListbox = (): void => setOpen(false);
  const selectIndex = (index: number): void => {
    const option = options[index];
    if (option === undefined || option.disabled) return;
    onChange(option.value);
    closeListbox();
  };
  const moveActive = (direction: -1 | 1): void => {
    if (options.length === 0) return;
    let next = activeIndex;
    for (let offset = 0; offset < options.length; offset += 1) {
      next = (next + direction + options.length) % options.length;
      if (options[next]?.disabled !== true) {
        setActiveIndex(next);
        return;
      }
    }
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) openListbox();
      else moveActive(event.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const available = options
        .map((option, index) => ({ option, index }))
        .filter(({ option }) => option.disabled !== true);
      const target = event.key === 'Home' ? available[0] : available.at(-1);
      if (target !== undefined) setActiveIndex(target.index);
      if (!open) setOpen(true);
      return;
    }
    if ((event.key === 'Enter' || event.key === ' ') && open) {
      event.preventDefault();
      selectIndex(activeIndex);
      return;
    }
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      closeListbox();
    }
  };

  return (
    <div
      className={`relative min-w-0 ${variant === 'zen' ? 'w-fit max-w-[32vw] shrink-0' : ''}`}
      data-custom-select={ariaLabel}
      onBlur={(event) => {
        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) {
          closeListbox();
        }
      }}
    >
      <button
        aria-controls={listboxId}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        className={`flex h-8 cursor-pointer items-center justify-between gap-2 rounded-md border px-2.5 text-left outline-none focus:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
          variant === 'zen'
            ? 'w-max max-w-full rounded-lg border-border bg-black/80 text-[10px] text-foreground hover:border-accent'
            : 'w-full border-border bg-background text-xs text-foreground hover:bg-surface'
        }`}
        type="button"
        onClick={() => (open ? closeListbox() : openListbox())}
        onKeyDown={handleKeyDown}
      >
        <span className={variant === 'zen' ? 'grid min-w-0 overflow-hidden' : 'min-w-0 truncate'}>
          <span className={variant === 'zen' ? 'col-start-1 row-start-1 min-w-0 truncate' : ''}>
            {selected?.label ?? value}
          </span>
          {variant === 'zen' &&
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
        <svg
          aria-hidden="true"
          className={`size-3 shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 16 16"
        >
          <path d="m4 6 4 4 4-4" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div
          aria-label={ariaLabel}
          className={`absolute left-0 top-[calc(100%+0.25rem)] z-50 max-h-[min(22rem,60dvh)] min-w-full overflow-y-auto overscroll-contain rounded-lg border border-border p-1 shadow-2xl ${
            variant === 'zen' ? 'bg-black/95' : 'bg-background'
          }`}
          id={listboxId}
          role="listbox"
        >
          {options.map((option, index) => (
            <button
              aria-selected={option.value === value}
              className={`block w-full whitespace-nowrap rounded-md px-2.5 py-2 text-left text-xs disabled:cursor-not-allowed disabled:opacity-40 ${
                index === activeIndex
                  ? 'bg-surface-active text-foreground'
                  : 'text-muted hover:bg-surface hover:text-foreground'
              }`}
              disabled={option.disabled}
              key={option.value}
              role="option"
              tabIndex={-1}
              type="button"
              onMouseEnter={() => setActiveIndex(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectIndex(index)}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
