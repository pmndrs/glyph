import {
  useEffect,
  useEffectEvent,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react'

export interface CanvasViewController {
  panBy(deltaX: number, deltaY: number): void
  resetView(): void
  zoomBy?(factor: number): void
}

interface PointerPosition {
  readonly x: number
  readonly y: number
}

interface GestureSnapshot {
  readonly centerX: number
  readonly centerY: number
  readonly distance?: number
}

export function InteractiveCanvas({
  label,
  canvasRef,
  className,
  controllerRef,
  zoom = false,
}: {
  readonly label: string
  readonly canvasRef: RefObject<HTMLCanvasElement | null>
  readonly className?: string
  readonly controllerRef: RefObject<CanvasViewController | undefined>
  readonly zoom?: boolean
}) {
  const pointers = useRef(new Map<number, PointerPosition>())
  const gesture = useRef<GestureSnapshot | undefined>(undefined)
  const panX = useRef(0)
  const panY = useRef(0)
  const zoomScale = useRef(1)

  function publishView(canvas: HTMLCanvasElement): void {
    canvas.dataset.panX = String(panX.current)
    canvas.dataset.panY = String(panY.current)
    canvas.dataset.zoom = String(zoomScale.current)
  }

  function pan(canvas: HTMLCanvasElement, deltaX: number, deltaY: number): void {
    panX.current += deltaX
    panY.current += deltaY
    controllerRef.current?.panBy(deltaX, deltaY)
    publishView(canvas)
  }

  function applyZoom(canvas: HTMLCanvasElement, factor: number): void {
    zoomScale.current *= factor
    controllerRef.current?.zoomBy?.(factor)
    publishView(canvas)
  }

  const applyWheelZoom = useEffectEvent((canvas: HTMLCanvasElement, factor: number): void => {
    applyZoom(canvas, factor)
  })

  function reset(canvas: HTMLCanvasElement): void {
    panX.current = 0
    panY.current = 0
    zoomScale.current = 1
    controllerRef.current?.resetView()
    publishView(canvas)
  }

  function updateGesture(): GestureSnapshot | undefined {
    const positions = [...pointers.current.values()]
    if (positions.length === 0) return undefined
    if (positions.length === 1) {
      const position = positions[0]!
      return { centerX: position.x, centerY: position.y }
    }
    const first = positions[0]!
    const second = positions[1]!
    return {
      centerX: (first.x + second.x) / 2,
      centerY: (first.y + second.y) / 2,
      distance: Math.hypot(second.x - first.x, second.y - first.y),
    }
  }

  function beginPointer(event: ReactPointerEvent<HTMLCanvasElement>): void {
    if (event.pointerType !== 'touch' && event.button !== 0) return
    if (event.isTrusted) event.currentTarget.setPointerCapture(event.pointerId)
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    gesture.current = updateGesture()
  }

  function movePointer(event: ReactPointerEvent<HTMLCanvasElement>): void {
    if (!pointers.current.has(event.pointerId)) return
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    const previous = gesture.current
    const next = updateGesture()
    gesture.current = next
    if (previous === undefined || next === undefined) return
    const touchMayPan = event.pointerType !== 'touch' || pointers.current.size >= 2
    if (touchMayPan) {
      pan(event.currentTarget, next.centerX - previous.centerX, next.centerY - previous.centerY)
    }
    if (
      zoom &&
      previous.distance !== undefined &&
      next.distance !== undefined &&
      previous.distance > 0
    ) {
      applyZoom(event.currentTarget, next.distance / previous.distance)
    }
  }

  function endPointer(event: ReactPointerEvent<HTMLCanvasElement>): void {
    if (!pointers.current.delete(event.pointerId)) return
    gesture.current = updateGesture()
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null || !zoom) return
    const zoomWheel = (event: WheelEvent): void => {
      event.preventDefault()
      applyWheelZoom(canvas, Math.exp(-event.deltaY * 0.0015))
    }
    canvas.addEventListener('wheel', zoomWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', zoomWheel)
  }, [canvasRef, controllerRef, zoom])

  return (
    <canvas
      aria-label={label}
      className={`absolute inset-0 size-full cursor-grab touch-none bg-background active:cursor-grabbing ${className ?? ''}`}
      style={{ backgroundColor: '#070709' }}
      data-pan-enabled="true"
      data-pan-x="0"
      data-pan-y="0"
      data-touch-pan="two-finger"
      data-zoom="1"
      data-zoom-enabled={String(zoom)}
      ref={canvasRef}
      onDoubleClick={(event) => reset(event.currentTarget)}
      onPointerCancel={endPointer}
      onPointerDown={beginPointer}
      onPointerMove={movePointer}
      onPointerUp={endPointer}
    />
  )
}
