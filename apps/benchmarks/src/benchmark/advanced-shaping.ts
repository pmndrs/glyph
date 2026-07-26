export type AdvancedShapingCaseId =
  | 'latin-features'
  | 'arabic-joining'
  | 'indic-reordering'
  | 'mixed-bidi'
  | 'cjk-line-breaks'

export type AdvancedShapingFontFixture =
  | 'inter'
  | 'amiri'
  | 'noto-sans-devanagari'
  | 'dot-gothic-16'

export interface AdvancedShapingCase {
  readonly id: AdvancedShapingCaseId
  readonly label: string
  readonly fontFixture: AdvancedShapingFontFixture
  readonly language: string
  readonly direction: 'ltr' | 'rtl'
  readonly features: readonly { readonly tag: string; readonly value: number }[]
  /** Authored reveal units. A unit is never split by deterministic typewriter playback. */
  readonly revealUnits: readonly string[]
  /** Thousandths of the viewport width, keeping timeline math integer and reproducible. */
  readonly widthPermille: readonly number[]
}

export interface AdvancedShapingState {
  readonly caseId: AdvancedShapingCaseId
  readonly playing: boolean
  readonly tick: number
  readonly editedText: string | undefined
}

export type AdvancedShapingCommand =
  | { readonly kind: 'play' }
  | { readonly kind: 'pause' }
  | { readonly kind: 'step'; readonly ticks: -1 | 1 }
  | { readonly kind: 'seek'; readonly tick: number }
  | { readonly kind: 'select-case'; readonly caseId: AdvancedShapingCaseId }
  | { readonly kind: 'edit'; readonly text: string }
  | { readonly kind: 'restore-authored-text' }

export interface AdvancedShapingFrame {
  readonly caseDefinition: AdvancedShapingCase
  readonly playing: boolean
  readonly text: string
  readonly tick: number
  readonly tickCount: number
  readonly widthPermille: number
  readonly progress: number
  readonly isEdited: boolean
}

export const ADVANCED_SHAPING_CASES: readonly AdvancedShapingCase[] = [
  {
    id: 'latin-features',
    label: 'Ligatures and marks',
    fontFixture: 'inter',
    language: 'en',
    direction: 'ltr',
    features: [
      { tag: 'kern', value: 1 },
      { tag: 'liga', value: 1 },
    ],
    revealUnits: [
      'A',
      'V',
      'A',
      'T',
      'A',
      'R',
      ' ',
      'o',
      'f',
      'f',
      'i',
      'c',
      'e',
      ' ',
      'e\u0301',
      ' ',
      'a\u0308',
      ' ',
      'f',
      'f',
      'l',
    ],
    widthPermille: [820, 510, 700, 430, 760],
  },
  {
    id: 'arabic-joining',
    label: 'Arabic joining and marks',
    fontFixture: 'amiri',
    language: 'ar',
    direction: 'rtl',
    features: [],
    revealUnits: ['ا', 'ل', 'ن', 'ّ', 'ص', ' ', 'ا', 'ل', 'ع', 'ر', 'ب', 'ي', 'ّ'],
    widthPermille: [760, 470, 680, 420, 720],
  },
  {
    id: 'indic-reordering',
    label: 'Devanagari reordering',
    fontFixture: 'noto-sans-devanagari',
    language: 'hi',
    direction: 'ltr',
    features: [],
    revealUnits: ['कर्म', ' ', 'क्षेत्र', ' ', 'में', ' ', 'प्रगति'],
    widthPermille: [780, 450, 640, 390, 720],
  },
  {
    id: 'mixed-bidi',
    label: 'Mixed-direction paragraph',
    fontFixture: 'amiri',
    language: 'ar',
    direction: 'rtl',
    features: [],
    revealUnits: ['PMNDRS', ' ', '2026', ' — ', 'النص', ' ', 'يتدفق', ' ', 'بوضوح', '.'],
    widthPermille: [840, 520, 710, 440, 780],
  },
  {
    id: 'cjk-line-breaks',
    label: 'CJK line breaking',
    fontFixture: 'dot-gothic-16',
    language: 'ja',
    direction: 'ltr',
    features: [],
    revealUnits: [
      '文字',
      '組版',
      'では',
      '、',
      '空白',
      'なし',
      'でも',
      '自然',
      'に',
      '改行',
      'します',
      '。',
    ],
    widthPermille: [790, 440, 610, 360, 690],
  },
] as const

const casesById = new Map(ADVANCED_SHAPING_CASES.map((entry) => [entry.id, entry]))

export function initialAdvancedShapingState(): AdvancedShapingState {
  const definition = advancedShapingCase('latin-features')
  return {
    caseId: definition.id,
    playing: false,
    tick: definition.revealUnits.length,
    editedText: undefined,
  }
}

export function updateAdvancedShaping(
  state: AdvancedShapingState,
  command: AdvancedShapingCommand,
): AdvancedShapingState {
  const definition = advancedShapingCase(state.caseId)
  switch (command.kind) {
    case 'play':
      return {
        ...state,
        playing: true,
        tick: state.tick >= definition.revealUnits.length ? 0 : state.tick,
      }
    case 'pause':
      return { ...state, playing: false }
    case 'step':
      return {
        ...state,
        playing: false,
        tick: clampTick(state.tick + command.ticks, definition.revealUnits.length),
      }
    case 'seek':
      return {
        ...state,
        playing: false,
        tick: clampTick(command.tick, definition.revealUnits.length),
      }
    case 'select-case':
      return {
        caseId: command.caseId,
        playing: state.playing,
        tick: advancedShapingCase(command.caseId).revealUnits.length,
        editedText: undefined,
      }
    case 'edit':
      return { ...state, playing: false, editedText: command.text }
    case 'restore-authored-text':
      return { ...state, tick: definition.revealUnits.length, editedText: undefined }
  }
}

export function advanceAdvancedShaping(state: AdvancedShapingState): AdvancedShapingState {
  if (!state.playing || state.editedText !== undefined) return state
  const tickCount = advancedShapingCase(state.caseId).revealUnits.length
  if (state.tick >= tickCount) return { ...state, playing: false }
  return { ...state, tick: state.tick + 1 }
}

export function advancedShapingFrame(state: AdvancedShapingState): AdvancedShapingFrame {
  const caseDefinition = advancedShapingCase(state.caseId)
  const tickCount = caseDefinition.revealUnits.length
  const tick = clampTick(state.tick, tickCount)
  const widthIndex = tick % caseDefinition.widthPermille.length
  return {
    caseDefinition,
    playing: state.playing,
    text: state.editedText ?? caseDefinition.revealUnits.slice(0, tick).join(''),
    tick,
    tickCount,
    widthPermille: caseDefinition.widthPermille[widthIndex]!,
    progress: tickCount === 0 ? 1 : tick / tickCount,
    isEdited: state.editedText !== undefined,
  }
}

export function advancedShapingCase(id: AdvancedShapingCaseId): AdvancedShapingCase {
  const definition = casesById.get(id)
  if (definition === undefined) throw new RangeError(`Unknown advanced-shaping case: ${id}`)
  return definition
}

/** Derive the complete finite conformance matrix from the authored product corpus. */
export function advancedShapingFrames(): readonly AdvancedShapingFrame[] {
  return ADVANCED_SHAPING_CASES.flatMap((definition) =>
    Array.from({ length: definition.revealUnits.length + 1 }, (_, tick) =>
      advancedShapingFrame({
        caseId: definition.id,
        playing: false,
        tick,
        editedText: undefined,
      }),
    ),
  )
}

function clampTick(value: number, tickCount: number): number {
  if (!Number.isSafeInteger(value)) throw new TypeError('advanced-shaping tick must be an integer')
  return Math.max(0, Math.min(value, tickCount))
}
