import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

interface Segment {
  direction: string
  script: string
  language: string
  features: string[]
}

interface Case extends Partial<Segment> {
  id: string
  text: string
  utf16Length: number
  codePoints: string[]
  oracle?: boolean
}

interface Corpus {
  schemaVersion: number
  fontFixture: string
  clusterUnit: string
  defaults: Segment
  cases: Case[]
}

interface HarfBuzzGlyph {
  g: number
  cl: number
  ax: number
  ay: number
  dx: number
  dy: number
  fl?: number
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}

function codePointClusterToUtf16(text: string, cluster: number): number {
  return [...text].slice(0, cluster).join('').length
}

const executable = option('--hb-shape') ?? process.env.PMNDRS_TEXT_HB_SHAPE ?? 'hb-shape'
const fontPath = resolve(option('--font') ?? 'fixtures/fonts/inter-v4.1/Inter-Regular.ttf')
const casesPath = resolve(option('--cases') ?? 'fixtures/shaping/inter-regular/cases.json')
const outputPath = option('--output')
const check = process.argv.includes('--check')
if (check && outputPath === undefined) {
  throw new Error('--check requires --output <committed-oracle.json>')
}
const versionOutput = execFileSync(executable, ['--version'], { encoding: 'utf8' }).trim()
if (versionOutput !== 'hb-shape (HarfBuzz) 13.0.0') {
  throw new Error(`expected pinned HarfBuzz 13.0.0, received ${JSON.stringify(versionOutput)}`)
}

const corpus = JSON.parse(await readFile(casesPath, 'utf8')) as Corpus
if (corpus.schemaVersion !== 0 || corpus.clusterUnit !== 'utf16') {
  throw new Error('unsupported corpus schema or cluster unit')
}

const cases = corpus.cases
  .filter((entry) => entry.oracle !== false)
  .map((entry) => {
    if (
      entry.text.length !== entry.utf16Length ||
      [...entry.text].length !== entry.codePoints.length
    ) {
      throw new Error(`case ${entry.id} has inconsistent text metadata`)
    }
    const segment = {
      direction: entry.direction ?? corpus.defaults.direction,
      script: entry.script ?? corpus.defaults.script,
      language: entry.language ?? corpus.defaults.language,
      features: entry.features ?? corpus.defaults.features,
    }
    const raw = execFileSync(
      executable,
      [
        fontPath,
        entry.text,
        `--direction=${segment.direction}`,
        `--script=${segment.script}`,
        `--language=${segment.language}`,
        `--features=${segment.features.join(',')}`,
        '--cluster-level=0',
        '--unsafe-to-concat',
        '--show-flags',
        '--output-format=json',
        '--no-glyph-names',
      ],
      { encoding: 'utf8' },
    )
    const glyphs = JSON.parse(raw) as HarfBuzzGlyph[]
    return {
      id: entry.id,
      text: entry.text,
      segment,
      glyphs: glyphs.map((glyph) => ({
        glyphId: glyph.g,
        cluster: codePointClusterToUtf16(entry.text, glyph.cl),
        xAdvance: glyph.ax,
        yAdvance: glyph.ay,
        xOffset: glyph.dx,
        yOffset: glyph.dy,
        flags: glyph.fl ?? 0,
      })),
    }
  })

const document = {
  schemaVersion: 0,
  engine: {
    name: 'HarfBuzz',
    version: '13.0.0',
    commit: 'a0fc099681a69ae40665fbea74982a2e9d7a5260',
    sourceArchiveSha256: '1626ebc763d28f4bcca1531fef42e92ca995d45f8ad90ad2ae0b5d1a567fe67a',
  },
  fontFixture: corpus.fontFixture,
  clusterUnit: 'utf16',
  positionUnit: 'font-unit',
  cases,
}
const output = `${JSON.stringify(document, undefined, 2)}\n`
if (check) {
  const expected = await readFile(resolve(outputPath!), 'utf8')
  if (output !== expected) throw new Error(`${resolve(outputPath!)} is stale; regenerate it`)
} else if (outputPath === undefined) {
  process.stdout.write(output)
} else {
  await writeFile(resolve(outputPath), output)
}
