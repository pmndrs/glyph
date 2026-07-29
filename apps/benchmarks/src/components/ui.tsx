import type {
  ButtonHTMLAttributes,
  ChangeEvent,
  CSSProperties,
  InputHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
} from 'react'

function classes(...values: readonly (string | false | undefined)[]): string {
  return values.filter(Boolean).join(' ')
}

export function Button({
  className,
  variant = 'secondary',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly variant?: 'primary' | 'secondary' | 'ghost'
}) {
  return (
    <button
      className={classes(
        'inline-flex h-8 items-center justify-center rounded-md px-3 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45',
        variant === 'primary' && 'bg-accent text-white hover:bg-accent-hover',
        variant === 'secondary' &&
          'border border-border bg-surface-raised text-foreground hover:bg-surface-active',
        variant === 'ghost' && 'text-muted hover:bg-surface-active hover:text-foreground',
        className,
      )}
      {...props}
    />
  )
}

export function Chip({
  children,
  tone = 'neutral',
}: {
  readonly children: ReactNode
  readonly tone?: 'neutral' | 'success' | 'warning' | 'accent'
}) {
  return (
    <span className="inline-flex h-6 items-center gap-2 rounded-full border border-border bg-surface px-2 font-mono text-[10px] text-muted">
      <span
        className={classes(
          'size-1.5 rounded-full bg-muted',
          tone === 'success' && 'bg-success',
          tone === 'warning' && 'bg-warning',
          tone === 'accent' && 'bg-accent',
        )}
      />
      {children}
    </span>
  )
}

export function Field({
  label,
  className,
  onRangeValueChange,
  rangeScale = 'linear',
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  readonly label: string
  readonly onRangeValueChange?: (value: number) => void
  readonly rangeScale?: 'linear' | 'logarithmic'
}) {
  const range = props.type === 'range'
  const logarithmic = range && rangeScale === 'logarithmic'
  const rangeMinimum = finiteNumber(props.min, 0)
  const rangeMaximum = finiteNumber(props.max, 100)
  const rangeValue = finiteNumber(
    props.value ?? props.defaultValue,
    rangeMinimum + (rangeMaximum - rangeMinimum) / 2,
  )
  const input = (
    <input
      className={classes(
        'h-8 min-w-0 text-xs text-foreground outline-none',
        range
          ? 'range-control w-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed'
          : 'rounded-md border border-border bg-background px-2.5 file:mr-2 file:border-0 file:bg-transparent file:text-xs file:text-muted focus:border-accent',
      )}
      {...props}
      {...(logarithmic
        ? {
            'aria-valuemax': rangeMaximum,
            'aria-valuemin': rangeMinimum,
            'aria-valuenow': rangeValue,
            max: 1,
            min: 0,
            step: 'any',
            value: logarithmicRangePosition(rangeValue, rangeMinimum, rangeMaximum),
            onChange: (event: ChangeEvent<HTMLInputElement>) =>
              onRangeValueChange?.(
                logarithmicRangeValue(
                  event.currentTarget.valueAsNumber,
                  rangeMinimum,
                  rangeMaximum,
                  finiteNumber(props.step, 1),
                ),
              ),
          }
        : {})}
    />
  )
  return (
    <label className={classes('grid min-w-0 gap-1.5', className)}>
      <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-dim">{label}</span>
      {range ? (
        <span
          className={classes('range-shell', props.disabled && 'is-disabled')}
          style={{ '--range-progress': rangeProgress(props, rangeScale) } as CSSProperties}
        >
          {input}
        </span>
      ) : (
        input
      )}
    </label>
  )
}

function rangeProgress(
  props: InputHTMLAttributes<HTMLInputElement>,
  scale: 'linear' | 'logarithmic',
): number {
  const minimum = finiteNumber(props.min, 0)
  const maximum = finiteNumber(props.max, 100)
  const fallback = minimum + (maximum - minimum) / 2
  const value = finiteNumber(props.value ?? props.defaultValue, fallback)
  if (maximum <= minimum) return 0
  if (scale === 'logarithmic') return logarithmicRangePosition(value, minimum, maximum)
  return Math.min(1, Math.max(0, (value - minimum) / (maximum - minimum)))
}

export function logarithmicRangePosition(value: number, minimum: number, maximum: number): number {
  assertLogarithmicRange(value, minimum, maximum)
  return Math.min(1, Math.max(0, Math.log(value / minimum) / Math.log(maximum / minimum)))
}

export function logarithmicRangeValue(
  position: number,
  minimum: number,
  maximum: number,
  step: number,
): number {
  assertLogarithmicRange(minimum, minimum, maximum)
  if (!Number.isFinite(position)) throw new RangeError('range position must be finite')
  if (!Number.isFinite(step) || step <= 0) throw new RangeError('range step must be positive')
  const normalized = Math.min(1, Math.max(0, position))
  const value = minimum * Math.pow(maximum / minimum, normalized)
  return Math.min(maximum, Math.max(minimum, minimum + Math.round((value - minimum) / step) * step))
}

function assertLogarithmicRange(value: number, minimum: number, maximum: number): void {
  if (
    !Number.isFinite(value) ||
    !Number.isFinite(minimum) ||
    !Number.isFinite(maximum) ||
    value <= 0 ||
    minimum <= 0 ||
    maximum <= minimum
  ) {
    throw new RangeError('logarithmic range values must be finite, positive, and increasing')
  }
}

function finiteNumber(value: unknown, fallback: number): number {
  const number = typeof value === 'number' || typeof value === 'string' ? Number(value) : Number.NaN
  return Number.isFinite(number) ? number : fallback
}

export function SelectField({
  label,
  children,
  value,
  onChange,
}: {
  readonly label: string
  readonly children: ReactNode
  readonly value: string
  readonly onChange: (value: string) => void
}) {
  return (
    <label className="grid min-w-0 gap-1.5">
      <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-dim">{label}</span>
      <select
        className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none focus:border-accent"
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      >
        {children}
      </select>
    </label>
  )
}

export function TextareaField({
  label,
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { readonly label: string }) {
  return (
    <label className={classes('grid min-w-0 gap-1.5', className)}>
      <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-dim">{label}</span>
      <textarea
        className="min-h-20 min-w-0 resize-y rounded-md border border-border bg-background px-2.5 py-2 text-xs leading-relaxed text-foreground outline-none focus:border-accent"
        {...props}
      />
    </label>
  )
}

export function Toggle({
  checked,
  disabled = false,
  label,
  onChange,
}: {
  readonly checked: boolean
  readonly disabled?: boolean
  readonly label: string
  readonly onChange: (value: boolean) => void
}) {
  return (
    <label
      className={classes(
        'flex min-h-8 items-center justify-between gap-3 text-xs text-muted',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
      )}
    >
      <span>{label}</span>
      <input
        aria-label={label}
        checked={checked}
        className="peer sr-only"
        disabled={disabled}
        type="checkbox"
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span className="relative h-[18px] w-8 rounded-full bg-border transition-colors peer-checked:bg-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent after:absolute after:left-0.5 after:top-0.5 after:size-3.5 after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-3.5" />
    </label>
  )
}

export function Metric({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="min-w-0 border-r border-border px-3 py-2 last:border-r-0">
      <div className="font-mono text-[9px] uppercase tracking-[0.08em] text-dim">{label}</div>
      <div className="mt-1 truncate font-mono text-base text-foreground">{value}</div>
    </div>
  )
}
