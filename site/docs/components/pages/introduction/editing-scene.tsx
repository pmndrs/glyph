import type { LayoutBox, RasterFormatMetadata, TextPosition, msdf } from '@pmndrs/glyph';
import { Text, useFont } from '@pmndrs/glyph/react';
import type { Text as ThreeText } from '@pmndrs/glyph/three';
import { useFrame, useThree } from '@react-three/fiber/webgpu';
import { useMemo, useRef, useState } from 'react';
import { Mesh, Plane, Quaternion, Raycaster, Vector2, Vector3 } from 'three';

import type { GlyphSceneProps } from '../../explainer';
import { caretCenterAfterBoundary, orderedRange, positionAtTextEnd, setProxyPointNdc } from './editing-coordinates';
import { MSDF_FONT } from './fonts';
import { paragraphTopFromCenter } from './scene-layout';
import { useSceneReady } from './use-scene-ready';

const INITIAL_TEXT = 'edit glyphs with a caret';
const INITIAL_POSITION = positionAtTextEnd(INITIAL_TEXT);

export function EditingScene({ inputs, onReady }: GlyphSceneProps) {
  const font = useFont(MSDF_FONT.src, { format: MSDF_FONT.format });
  const viewport = useThree((state) => state.viewport);
  const canvasSize = useThree((state) => state.size);
  const camera = useThree((state) => state.camera);
  const text = useRef<ThreeText<typeof msdf>>(null);
  const caretMesh = useRef<Mesh>(null);
  // The selection is two positions; the application owns it, the text only answers geometry.
  const anchor = useRef<TextPosition>(INITIAL_POSITION);
  const focus = useRef<TextPosition>(INITIAL_POSITION);
  const dragging = useRef(false);
  const placed = useRef(false);
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
  useFrame((_state, delta) => {
    const currentText = text.current;
    if (currentText === null) {
      inputs.drain();
      return;
    }
    // Every query prepares the text first, so the answer after an edit is the edited layout.
    const place = (nextAnchor: TextPosition, nextFocus: TextPosition) => {
      anchor.current = nextAnchor;
      focus.current = nextFocus;
      const [start, end] = orderedRange(nextAnchor.offset, nextFocus.offset);
      setSelectionRects(start === end ? [] : currentText.rangeRects(start, end));
      setCaretRect(currentText.caret(nextFocus).rect);
      blinkElapsed.current = 0;
      placed.current = true;
    };
    const edit = (start: number, end: number, insert: string) => {
      currentText.replace(start, end, insert);
      setValue(currentText.text);
      const position: TextPosition = { offset: start + insert.length, affinity: 'upstream' };
      place(position, position);
    };
    if (!placed.current) place(anchor.current, focus.current);
    for (const input of inputs.drain()) {
      if (
        (input.type === 'pointerdown' || input.type === 'pointermove' || input.type === 'pointerup') &&
        input.x !== undefined &&
        input.y !== undefined &&
        (input.type !== 'pointermove' || dragging.current)
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
        if (local !== undefined && (input.type === 'pointerdown' || dragging.current)) {
          // Text-local coordinates are +Y down; the Three object is +Y up.
          const position = currentText.hitTest({ x: local.x, y: -local.y });
          if (input.type === 'pointerdown') dragging.current = true;
          place(input.type === 'pointerdown' ? position : anchor.current, position);
        }
        if (input.type === 'pointerup') dragging.current = false;
        continue;
      }
      if (input.type === 'pointercancel') {
        dragging.current = false;
        continue;
      }
      if (input.type !== 'keydown' || input.value === undefined) continue;
      const [start, end] = orderedRange(anchor.current.offset, focus.current.offset);
      if (input.value === 'ArrowLeft' || input.value === 'ArrowRight') {
        const direction = input.value === 'ArrowLeft' ? 'left' : 'right';
        const position =
          start === end
            ? currentText.move(focus.current, direction, 'grapheme').position
            : ({ offset: direction === 'left' ? start : end, affinity: 'downstream' } as const);
        place(position, position);
      } else if (input.value === 'Backspace') {
        if (start !== end) edit(start, end, '');
        else if (start > 0) edit(currentText.move(focus.current, 'backward', 'grapheme').position.offset, end, '');
      } else if (input.value.length === 1) {
        edit(start, end, input.value);
      }
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

function proxyPointToTextLocal<Format extends RasterFormatMetadata>(
  x: number,
  y: number,
  width: number,
  height: number,
  camera: Parameters<Raycaster['setFromCamera']>[1],
  text: ThreeText<Format>,
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
