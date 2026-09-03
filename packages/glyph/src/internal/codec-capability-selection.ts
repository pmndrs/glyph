import type { CodecCapabilitySet, CodecDescriptor } from '../config/codec.js';
import type { CodecHandle } from './glyph-id.js';

declare const codecCapabilitySetSelectionBrand: unique symbol;

export interface CodecCapabilitySetSelection {
  readonly [codecCapabilitySetSelectionBrand]: true;
}

interface CapabilitySetSelectionRecord {
  readonly id: number;
  readonly codecHandle: CodecHandle;
}

const selections = new WeakMap<object, CapabilitySetSelectionRecord>();

export function selectCodecCapabilitySet(
  codecHandle: CodecHandle,
  descriptor: CodecDescriptor,
  selected: CodecCapabilitySet,
): CodecCapabilitySetSelection {
  const selectedIndex = descriptor.capabilitySets.indexOf(selected);
  if (selectedIndex < 0) throw new TypeError('selected capability set does not belong to the installed Codec');
  const selection = Object.freeze({}) as CodecCapabilitySetSelection;
  selections.set(selection, Object.freeze({ id: selectedIndex + 1, codecHandle }));
  return selection;
}

export function codecCapabilitySetSelectionId(
  selection: CodecCapabilitySetSelection,
  codecHandle: CodecHandle,
): number {
  const selected = selections.get(selection);
  if (selected === undefined) throw new TypeError('capability set selection is not package-owned');
  if (selected.codecHandle !== codecHandle) throw new TypeError('capability set selection belongs to another Codec');
  return selected.id;
}
