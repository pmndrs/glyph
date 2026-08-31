import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';

/** How long a touch has to be held before it counts as a request to look. */
const LONG_PRESS = 380;

interface TooltipProps {
  readonly children: ReactNode;
  readonly label: string;
}

/**
 * A tooltip in the top layer.
 *
 * `popover` rather than a positioned sibling: the canvas and the control strip
 * are stacking contexts of their own, and the top layer is the one place a small
 * panel is guaranteed to escape both without a z-index argument.
 *
 * Hover is the pointer affordance; touch has none, so a long press stands in for
 * it. The press deliberately does not cancel the button's own action — lifting
 * early still copies or navigates, and only a held finger asks to read first.
 */
export function Tooltip({ children, label }: TooltipProps) {
  const anchor = useRef<HTMLSpanElement>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [open, setOpen] = useState(false);
  const id = useId();

  const place = useCallback(() => {
    const trigger = anchor.current?.firstElementChild;
    const panel = bubble.current;
    if (!trigger || !panel) return;

    const box = trigger.getBoundingClientRect();
    panel.style.left = `${box.left + box.width / 2}px`;
    panel.style.top = `${box.top}px`;
  }, []);

  useEffect(() => {
    const panel = bubble.current;
    if (!panel) return;

    if (open) {
      place();
      panel.showPopover();
    } else if (panel.matches(':popover-open')) {
      panel.hidePopover();
    }
  }, [open, place]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const hold = useCallback((event: React.PointerEvent) => {
    if (event.pointerType === 'mouse') return;
    timer.current = setTimeout(() => setOpen(true), LONG_PRESS);
  }, []);

  const release = useCallback(() => {
    clearTimeout(timer.current);
    setOpen(false);
  }, []);

  return (
    <span
      className="tip-anchor"
      onPointerCancel={release}
      onPointerDown={hold}
      onPointerEnter={(event) => event.pointerType === 'mouse' && setOpen(true)}
      onPointerLeave={release}
      onPointerUp={release}
      ref={anchor}
    >
      {children}
      <div className="tip" id={id} popover="manual" ref={bubble} role="tooltip">
        <span className="tip-text">{label}</span>
      </div>
    </span>
  );
}
