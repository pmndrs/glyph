import { useWorld } from 'koota/react';
import { useEffect, useMemo, useRef } from 'react';
import type { Mesh } from 'three/webgpu';
import { editorActions } from './actions';
import { createCaretMaterial, editorUniforms } from './materials';

/** The caret: a bar of light, and a second, fainter bar for its other place where two directions meet. */
export function CaretRenderer() {
  const world = useWorld();
  const material = useMemo(() => createCaretMaterial(), []);
  const bar = useRef<Mesh>(null);
  const second = useRef<Mesh>(null);

  useEffect(() => {
    editorActions(world).mountEditorView({
      fields: [],
      bar: bar.current!,
      second: second.current!,
      uniforms: editorUniforms,
    });

    return () => editorActions(world).unmountEditorView();
  }, [world]);

  useEffect(() => () => material.dispose(), [material]);

  return (
    <group name="caret">
      <mesh material={material} ref={bar} renderOrder={50}>
        <planeGeometry args={[1, 1]} />
      </mesh>
      <mesh material={material} ref={second} renderOrder={50} visible={false}>
        <planeGeometry args={[1, 1]} />
      </mesh>
    </group>
  );
}
