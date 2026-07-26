import type { ParagraphLayout } from '@pmndrs/text'

type PortableParagraphLayout = Pick<
  ParagraphLayout,
  | 'glyphFontSlots'
  | 'glyphIds'
  | 'clusters'
  | 'glyphFontSizes'
  | 'x'
  | 'y'
  | 'glyphFlags'
  | 'lineTextStarts'
  | 'lineTextEnds'
  | 'lineGlyphStarts'
  | 'lineGlyphCounts'
  | 'lineBaselines'
  | 'lineAdvances'
>

interface ParagraphPolicyHashContract {
  readonly bidi: Readonly<Record<string, { readonly layout: { readonly hash: string } }>>
  readonly policies: {
    readonly cases: Readonly<Record<string, { readonly layout: { readonly hash: string } }>>
  }
  readonly uikit: { readonly resolved: { readonly layout: { readonly hash: string } } }
}

export function paragraphLayoutContract(layout: ParagraphLayout, full = true) {
  const contract: Record<string, unknown> = {
    measurement: {
      width: layout.width,
      height: layout.height,
      contentWidth: layout.contentWidth,
      contentHeight: layout.contentHeight,
      firstBaseline: layout.firstBaseline,
      lastBaseline: layout.lastBaseline,
      overflowed: layout.overflowed,
    },
    hash: hashParagraphLayout(layout),
  }
  const fields = full
    ? ([
        'glyphFontSlots',
        'glyphIds',
        'clusters',
        'glyphFontSizes',
        'x',
        'y',
        'glyphFlags',
        'lineTextStarts',
        'lineTextEnds',
        'lineGlyphStarts',
        'lineGlyphCounts',
        'lineBaselines',
        'lineAdvances',
      ] as const)
    : ([
        'glyphIds',
        'clusters',
        'x',
        'lineTextStarts',
        'lineTextEnds',
        'lineGlyphStarts',
        'lineGlyphCounts',
        'lineBaselines',
        'lineAdvances',
      ] as const)
  for (const field of fields) contract[field] = [...layout[field]]
  return contract
}

export function hashParagraphLayout(layout: PortableParagraphLayout): string {
  let hash = 2_166_136_261
  for (const values of portableLayoutArrays(layout)) {
    hash = Math.imul(hash ^ values.length, 16_777_619)
    const bytes = new Uint8Array(values.buffer, values.byteOffset, values.byteLength)
    for (const value of bytes) hash = Math.imul(hash ^ value, 16_777_619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function hashParagraphLayouts(layouts: readonly PortableParagraphLayout[]): string {
  return layouts.map(hashParagraphLayout).join(':')
}

export function paragraphLayoutBytes(layout: ParagraphLayout): number {
  return [layout.fontHandles, ...portableLayoutArrays(layout)].reduce(
    (sum, values) => sum + values.byteLength,
    0,
  )
}

export function paragraphPolicyContractHash(contract: ParagraphPolicyHashContract): string {
  return [
    ...Object.values(contract.bidi).map(({ layout }) => layout.hash),
    ...Object.values(contract.policies.cases).map(({ layout }) => layout.hash),
    contract.uikit.resolved.layout.hash,
  ].join(':')
}

function portableLayoutArrays(
  layout: PortableParagraphLayout,
): readonly (Uint16Array | Uint32Array | Float32Array)[] {
  return [
    layout.glyphFontSlots,
    layout.glyphIds,
    layout.clusters,
    layout.glyphFontSizes,
    layout.x,
    layout.y,
    layout.glyphFlags,
    layout.lineTextStarts,
    layout.lineTextEnds,
    layout.lineGlyphStarts,
    layout.lineGlyphCounts,
    layout.lineBaselines,
    layout.lineAdvances,
  ]
}
