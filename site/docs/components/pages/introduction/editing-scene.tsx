import type { AnyRasterTechnique, LayoutBox } from '@pmndrs/glyph';
import { Text, useFont } from '@pmndrs/glyph/react';
import type { Text as ThreeText } from '@pmndrs/glyph/three';
import { msdf } from '@pmndrs/glyph/three/msdf';
import { useFrame, useThree } from '@react-three/fiber/webgpu';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Mesh, Plane, Quaternion, Raycaster, Vector2, Vector3 } from 'three';

import type { GlyphSceneProps } from '../../explainer';
import {
  caretCenterAfterBoundary,
  caretRectAtTextOffset,
  isTextLayoutCommitted,
  selectionAtTextEnd,
  setProxyPointNdc,
} from './editing-coordinates';
import { MSDF_FONT } from './fonts';
import { paragraphTopFromCenter } from './scene-layout';
import { useSceneReady } from './use-scene-ready';

const INITIAL_TEXT = 'edit glyphs with a caret';
const INITIAL_SELECTION = selectionAtTextEnd(INITIAL_TEXT);

export function EditingScene({ inputs, onReady }: GlyphSceneProps) {
  const font = useFont(MSDF_FONT.input, MSDF_FONT.raster.technique, MSDF_FONT.raster.options);
  const viewport = useThree((state) => state.viewport);
  const canvasSize = useThree((state) => state.size);
  const camera = useThree((state) => state.camera);
  const text = useRef<ThreeText<typeof msdf>>(null);
  const caretMesh = useRef<Mesh>(null);
  const dragging = useRef<number | undefined>(undefined);
  const selectionRef = useRef<readonly [number, number]>(INITIAL_SELECTION);
  const valueRef = useRef(INITIAL_TEXT);
  const pendingCaret = useRef<Readonly<{ text: string; offset: number }> | undefined>({
    text: INITIAL_TEXT,
    offset: INITIAL_SELECTION[1],
  });
  const blinkElapsed = useRef(0);
  const [value, setValue] = useState(INITIAL_TEXT);
  const [selectionRects, setSelectionRects] = useState<readonly LayoutBox[]>([]);
  const [caretRect, setCaretRect] = useState<LayoutBox>();
  const raycaster = useMemo(() => new Raycaster(), []);
  const plane = useMemo(() => new Plane(), []);
  const ndc = useMemo(() => new Vector2(), []);
  const worldPoint = useMemo(() => new Vector3(), []);
  const planePoint = useMemo(() => new Vector3(), []);
  const planeNormal = useMemo(() => new Vector3(), []);
  const textWidth = viewport.width * 0.84;
  const fontSize = Math.min(viewport.width * 0.075, 0.9);
  const textPosition = useMemo(
    () => new Vector3(-viewport.width * 0.42, paragraphTopFromCenter(fontSize), 0.2),
    [fontSize, viewport.width],
  );
  const caretWidth = Math.max(viewport.width * 0.0025, 0.015);
  const select = useCallback((anchor: number, focus: number) => {
    const next: [number, number] = [anchor, focus];
    selectionRef.current = next;
    setSelectionRects(text.current?.selectionRects(anchor, focus) ?? []);
  }, []);
  useFrame((_state, delta) => {
    const currentText = text.current;
    if (currentText !== null) {
      for (const input of inputs.drain()) {
        if (
          (input.type === 'pointerdown' || input.type === 'pointermove' || input.type === 'pointerup') &&
          input.x !== undefined &&
          input.y !== undefined &&
          (input.type !== 'pointermove' || dragging.current !== undefined)
        ) {
          const local = proxyPointToTextLocal(
            input.x,
            input.y,
            canvasSize.width,
            canvasSize.height,
            camera,
            currentText,
            raycaster,
            plane,
            ndc,
            worldPoint,
            planePoint,
            planeNormal,
          );
          if (local !== undefined) {
            const caret = currentText.caretAt(local.x, -local.y);
            if (caret !== undefined) {
              if (input.type === 'pointerdown') dragging.current = caret.offset;
              const anchor = dragging.current ?? caret.offset;
              select(anchor, caret.offset);
              setCaretRect(caret.rect);
              blinkElapsed.current = 0;
            }
          }
          if (input.type === 'pointerup') dragging.current = undefined;
          continue;
        }
        if (input.type === 'pointercancel') {
          dragging.current = undefined;
          continue;
        }
        if (input.type !== 'keydown' || input.value === undefined) continue;
        const [anchor, focus] = selectionRef.current;
        const left = Math.min(anchor, focus);
        const right = Math.max(anchor, focus);
        if (input.value === 'ArrowLeft' || input.value === 'ArrowRight') {
          const direction = input.value === 'ArrowLeft' ? -1 : 1;
          const offset = Math.max(0, Math.min(valueRef.current.length, (direction < 0 ? left : right) + direction));
          select(offset, offset);
          pendingCaret.current = { text: valueRef.current, offset };
        } else if (input.value === 'Backspace') {
          const start = left === right ? Math.max(0, left - 1) : left;
          const nextValue = valueRef.current.slice(0, start) + valueRef.current.slice(right);
          valueRef.current = nextValue;
          setValue(nextValue);
          select(start, start);
          pendingCaret.current = { text: nextValue, offset: start };
          setCaretRect(undefined);
        } else if (input.value.length === 1) {
          const nextValue = valueRef.current.slice(0, left) + input.value + valueRef.current.slice(right);
          valueRef.current = nextValue;
          setValue(nextValue);
          const offset = left + input.value.length;
          select(offset, offset);
          pendingCaret.current = { text: nextValue, offset };
          setCaretRect(undefined);
        }
        blinkElapsed.current = 0;
      }
      const pending = pendingCaret.current;
      if (
        pending !== undefined &&
        isTextLayoutCommitted(currentText.text, pending.text, currentText.commitState().status)
      ) {
        const next = caretRectAtTextOffset(currentText, pending.offset, pending.text.length);
        if (next !== undefined) {
          setCaretRect(next);
          pendingCaret.current = undefined;
        }
      }
    } else {
      inputs.drain();
    }
    blinkElapsed.current += delta;
    if (caretMesh.current) caretMesh.current.visible = Math.floor(blinkElapsed.current / 0.5) % 2 === 0;
  });
  useSceneReady(onReady);
  return (
    <group position={textPosition}>
      {selectionRects.map((rect) => (
        <mesh
          key={`${rect.x}:${rect.y}:${rect.width}:${rect.height}`}
          position={[rect.x + rect.width / 2, -rect.y - rect.height / 2, 0.1]}
        >
          <planeGeometry args={[rect.width, rect.height]} />
          <meshBasicMaterial color="#38bdf8" depthWrite={false} opacity={0.25} transparent />
        </mesh>
      ))}
      <Text
        ref={text}
        constraints={{ width: { mode: 'exact', size: textWidth } }}
        font={font}
        layout={{ align: 'start', wrap: 'none' }}
        style={{ color: '#e0f2fe', fontSize }}
      >
        {value}
      </Text>
      {caretRect ? (
        <mesh
          ref={caretMesh}
          position={[caretCenterAfterBoundary(caretRect.x, caretWidth), -caretRect.y - caretRect.height / 2, 0.25]}
        >
          <planeGeometry args={[caretWidth, caretRect.height]} />
          <meshBasicMaterial color="#f8fafc" depthWrite={false} />
        </mesh>
      ) : null}
    </group>
  );
}

function proxyPointToTextLocal<Technique extends AnyRasterTechnique>(
  x: number,
  y: number,
  width: number,
  height: number,
  camera: Parameters<Raycaster['setFromCamera']>[1],
  text: ThreeText<Technique>,
  raycaster: Raycaster,
  plane: Plane,
  ndc: Vector2,
  worldPoint: Vector3,
  planePoint: Vector3,
  planeNormal: Vector3,
): Vector3 | undefined {
  text.updateWorldMatrix(true, false);
  setProxyPointNdc(ndc, x, y, width, height);
  raycaster.setFromCamera(ndc, camera);
  text.getWorldPosition(planePoint);
  text.getWorldQuaternion(_editingQuaternion);
  planeNormal.set(0, 0, 1).applyQuaternion(_editingQuaternion);
  plane.setFromNormalAndCoplanarPoint(planeNormal, planePoint);
  if (raycaster.ray.intersectPlane(plane, worldPoint) === null) return undefined;
  return text.worldToLocal(worldPoint);
}

const _editingQuaternion = new Quaternion();
