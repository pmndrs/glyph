import { graphemeSegments } from 'unicode-segmenter/grapheme'

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
  | 'noto-sans-cjk-showcase'

export interface AdvancedShapingCase {
  readonly id: AdvancedShapingCaseId
  readonly label: string
  readonly fontFixture: AdvancedShapingFontFixture
  readonly language: string
  readonly direction: 'ltr' | 'rtl'
  readonly features: readonly { readonly tag: string; readonly value: number }[]
  /** Focused authored units retained by the finite conformance matrix. */
  readonly revealUnits: readonly string[]
  /** Thousandths of the viewport width, keeping timeline math integer and reproducible. */
  readonly widthPermille: readonly number[]
  /** Longer grapheme-safe product copy used by the live typewriter. */
  readonly showcaseRevealUnits: readonly string[]
  /** Stable live paragraph measure in thousandths of the viewport width. */
  readonly showcaseWidthPermille: number
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
  | { readonly kind: 'reset' }
  | { readonly kind: 'seek'; readonly tick: number }
  | { readonly kind: 'select-case'; readonly caseId: AdvancedShapingCaseId }
  | { readonly kind: 'edit'; readonly text: string }

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
    showcaseRevealUnits: revealUnits(
      'AVATAR office é ä ffl. Affinity, efficient files, and fine forms reveal where ligatures join and kerning pairs settle. Café, naïve, and coöperate keep their marks intact while To, Ta, Wa, and Yo adjust their rhythm. Every arriving character reshapes the paragraph, and every completed word wraps from the same quiet starting edge.',
    ),
    showcaseWidthPermille: 720,
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
    showcaseRevealUnits: revealUnits(
      'النص العربي يتدفق بوضوح، وتتصل الحروف وتتغير أشكالها مع كل حرف جديد. في هذا السطر نراقب التشكيل وإعادة الترتيب والالتفاف لحظة بلحظة، بينما تبقى بداية الفقرة ثابتة وتستمر الكلمات في بناء إيقاعها.',
    ),
    showcaseWidthPermille: 720,
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
    showcaseRevealUnits: revealUnits(
      'कर्म क्षेत्र में प्रगति निरंतर चलती है। प्रत्येक नया अक्षर शब्दों को आकार देता है, मात्राएँ सही स्थान पर आती हैं, संयुक्त रूप बदलते हैं, और अनुच्छेद अपनी स्थिर शुरुआत से पंक्ति दर पंक्ति आगे बढ़ता है।',
    ),
    showcaseWidthPermille: 720,
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
    showcaseRevealUnits: revealUnits(
      'PMNDRS 2026 — النص العربي يتدفق بوضوح، while Latin words and 0123456789 keep their own direction. علامات الترقيم meet office ligatures, and the paragraph resolves every run before wrapping from one stable edge.',
    ),
    showcaseWidthPermille: 760,
  },
  {
    id: 'cjk-line-breaks',
    label: 'CJK line breaking',
    fontFixture: 'noto-sans-cjk-showcase',
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
    showcaseRevealUnits: revealUnits(
      '文字組版では、空白なしでも自然に改行します。新しい文字が一つずつ現れるたびに、禁則処理と句読点の位置を保ちながら段落が伸びていきます。固定された始点から複数の行へ滑らかに折り返し、日本語の密度とリズムをそのまま観察できます。',
    ),
    showcaseWidthPermille: 700,
  },
] as const

const casesById = new Map(ADVANCED_SHAPING_CASES.map((entry) => [entry.id, entry]))

export function initialAdvancedShapingState(): AdvancedShapingState {
  const definition = advancedShapingCase('latin-features')
  return {
    caseId: definition.id,
    playing: true,
    tick: 0,
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
        tick: state.tick >= definition.showcaseRevealUnits.length ? 0 : state.tick,
      }
    case 'pause':
      return { ...state, playing: false }
    case 'reset':
      return {
        ...state,
        playing: false,
        tick: 0,
        editedText: undefined,
      }
    case 'seek':
      return {
        ...state,
        playing: false,
        tick: clampTick(command.tick, definition.showcaseRevealUnits.length),
      }
    case 'select-case':
      const nextDefinition = advancedShapingCase(command.caseId)
      return {
        caseId: command.caseId,
        playing: state.playing,
        tick: state.playing ? 0 : nextDefinition.showcaseRevealUnits.length,
        editedText: undefined,
      }
    case 'edit':
      return { ...state, playing: false, editedText: command.text }
  }
}

export function advanceAdvancedShaping(state: AdvancedShapingState): AdvancedShapingState {
  if (!state.playing || state.editedText !== undefined) return state
  const tickCount = advancedShapingCase(state.caseId).showcaseRevealUnits.length
  if (state.tick >= tickCount) return { ...state, tick: 0 }
  return { ...state, tick: state.tick + 1 }
}

export function advancedShapingFrame(state: AdvancedShapingState): AdvancedShapingFrame {
  const caseDefinition = advancedShapingCase(state.caseId)
  const tickCount = caseDefinition.showcaseRevealUnits.length
  const tick = clampTick(state.tick, tickCount)
  return {
    caseDefinition,
    playing: state.playing,
    text: state.editedText ?? caseDefinition.showcaseRevealUnits.slice(0, tick).join(''),
    tick,
    tickCount,
    widthPermille: caseDefinition.showcaseWidthPermille,
    progress: tickCount === 0 ? 1 : tick / tickCount,
    isEdited: state.editedText !== undefined,
  }
}

export function advancedShapingCase(id: AdvancedShapingCaseId): AdvancedShapingCase {
  const definition = casesById.get(id)
  if (definition === undefined) throw new RangeError(`Unknown advanced-shaping case: ${id}`)
  return definition
}

/** Derive the complete finite conformance matrix from the focused authored corpus. */
export function advancedShapingFrames(): readonly AdvancedShapingFrame[] {
  return ADVANCED_SHAPING_CASES.flatMap((definition) =>
    Array.from({ length: definition.revealUnits.length + 1 }, (_, tick) => {
      const widthIndex = tick % definition.widthPermille.length
      return {
        caseDefinition: definition,
        playing: false,
        text: definition.revealUnits.slice(0, tick).join(''),
        tick,
        tickCount: definition.revealUnits.length,
        widthPermille: definition.widthPermille[widthIndex]!,
        progress: definition.revealUnits.length === 0 ? 1 : tick / definition.revealUnits.length,
        isEdited: false,
      }
    }),
  )
}

function revealUnits(text: string): readonly string[] {
  return Object.freeze(Array.from(graphemeSegments(text), ({ segment }) => segment))
}

function clampTick(value: number, tickCount: number): number {
  if (!Number.isSafeInteger(value)) throw new TypeError('advanced-shaping tick must be an integer')
  return Math.max(0, Math.min(value, tickCount))
}
