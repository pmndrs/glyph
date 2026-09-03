import type { AnyRasterFormat, Font } from '@pmndrs/glyph';
import { Text } from '@pmndrs/glyph/react';
import type { Glyphs, Text as ThreeText, ThreeTextMaterial } from '@pmndrs/glyph/three';
import { useFrame } from '@react-three/fiber/webgpu';
import { useEffect, useRef, useState } from 'react';
import { Matrix4 } from 'three/webgpu';

import { placeOnPath, type Path } from '../../lib/paths';

/**
 * A ring buffer of words written onto a path as they arrive. Every word that
 * completes in `text` becomes its own small paragraph, shaped once, copied
 * out with `breakApart()` on commit, and laid on the path at the write head;
 * the head advances by the word's measured width, the whole line turns at
 * `speed`, and a word the head laps is disposed, so the path never holds
 * more than one turn of text. Nothing already written is reshaped, so the
 * line never jumps.
 */
interface Entry {
  readonly glyphs: Glyphs;
  readonly width: number;
  /** Arc position of the word's first glyph when it was written. */
  readonly s: number;
}

interface Written {
  readonly id: number;
  readonly word: string;
}

export function LiveTextOnPath<Technique extends AnyRasterFormat>({
  font,
  path,
  text,
  speed = 0,
  size = 0.4,
  gap = size * 0.55,
  color = '#e7ecf6',
  letterSpacing = 0,
  material,
  castShadow = false,
}: {
  readonly font: Font<Technique>;
  readonly path: Path;
  /** The text so far; a word is written when the character after it arrives. */
  readonly text: string;
  readonly speed?: number;
  readonly size?: number;
  /** Arc between words. */
  readonly gap?: number;
  readonly color?: string;
  readonly letterSpacing?: number;
  readonly material?: ThreeTextMaterial;
  readonly castShadow?: boolean;
}) {
  const [words, setWords] = useState<readonly Written[]>([]);
  const consumed = useRef(0);
  const nextId = useRef(0);
  const head = useRef(0);
  const entries = useRef(new Map<number, Entry>());

  // Consume every word that has completed since the last look; the typist erasing restarts the count.
  useEffect(() => {
    if (text.length < consumed.current) consumed.current = 0;
    const pending = text.slice(consumed.current);
    const found: string[] = [];
    let cursor = 0;
    for (const match of pending.matchAll(/(\S+)\s/g)) {
      found.push(match[1] ?? '');
      cursor = (match.index ?? 0) + match[0].length;
    }
    if (found.length === 0) return;
    consumed.current += cursor;
    setWords((previous) => [...previous, ...found.map((word) => ({ id: nextId.current++, word }))]);
  }, [text]);

  useEffect(
    () => () => {
      for (const entry of entries.current.values()) entry.glyphs.dispose();
      entries.current.clear();
    },
    [],
  );

  const written = (id: number, glyphs: Glyphs, width: number) => {
    if (castShadow) glyphs.traverse((object) => void (object.castShadow = true));
    entries.current.set(id, { glyphs, width, s: head.current });
    head.current += width + gap;
    // A word the head has lapped is overwritten: drop it before the new one lands on it.
    const lapped: number[] = [];
    for (const [other, entry] of entries.current) {
      if (other !== id && head.current - entry.s > path.length - gap) lapped.push(other);
    }
    if (lapped.length > 0) {
      for (const other of lapped) {
        entries.current.get(other)?.glyphs.dispose();
        entries.current.delete(other);
      }
      setWords((previous) => previous.filter((word) => !lapped.includes(word.id)));
    }
  };

  useFrame(({ elapsed }) => {
    const m = new Matrix4();
    for (const entry of entries.current.values()) {
      const { glyphs } = entry;
      for (let i = 0; i < glyphs.count; i += 1) {
        const rest = glyphs.measurements[i];
        if (rest === undefined) continue;
        const s = entry.s + (rest.originalMatrix.elements[12] ?? 0) + elapsed * speed;
        glyphs.setMatrixAt(i, placeOnPath(path, s, 0, 0, rest.originalMatrix, m));
      }
    }
  });

  return (
    <>
      {words.map(({ id, word }) => (
        <Word
          key={id}
          id={id}
          word={word}
          font={font}
          size={size}
          color={color}
          letterSpacing={letterSpacing}
          {...(material === undefined ? {} : { material })}
          onCommit={written}
        />
      ))}
    </>
  );
}

/** One word: a paragraph that hides itself and hands its glyph copy up the moment it commits. */
function Word<Technique extends AnyRasterFormat>({
  id,
  word,
  font,
  size,
  color,
  letterSpacing,
  material,
  onCommit,
}: {
  readonly id: number;
  readonly word: string;
  readonly font: Font<Technique>;
  readonly size: number;
  readonly color: string;
  readonly letterSpacing: number;
  readonly material?: ThreeTextMaterial;
  readonly onCommit: (id: number, glyphs: Glyphs, width: number) => void;
}) {
  const source = useRef<ThreeText<Technique>>(null);
  const done = useRef(false);
  useFrame(() => {
    const text = source.current;
    if (done.current || text === null || text.commitState().status !== 'committed') return;
    done.current = true;
    const [glyphs] = text.breakApart();
    text.parent?.add(glyphs);
    text.visible = false;
    onCommit(id, glyphs, text.measure().contentWidth);
  });
  return (
    <Text
      ref={source}
      font={font}
      {...(material === undefined ? {} : { material })}
      style={{ fontSize: size, color, letterSpacing }}
      layout={{ wrap: 'none' }}
      constraints={{ width: { mode: 'exact', size: 40 } }}
    >
      {word}
    </Text>
  );
}
