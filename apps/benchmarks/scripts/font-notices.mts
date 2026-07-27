import { readFile } from 'node:fs/promises'

const notices = [
  ['Inter 4.1', '../fixtures/fonts/inter-v4.1/LICENSE.txt'],
  ['Amiri 1.002', '../fixtures/fonts/amiri-1.002/OFL.txt'],
  ['Noto Sans Devanagari', '../fixtures/fonts/noto-sans-devanagari/OFL.txt'],
  ['DotGothic16', '../fixtures/fonts/dot-gothic-16/OFL.txt'],
  ['Source Serif 4.005', '../fixtures/fonts/source-serif-4.005/OFL.md'],
  ['Dancing Script 3.000', '../fixtures/fonts/dancing-script-3.000/OFL.txt'],
] as const

export async function fontNotices(): Promise<string> {
  const sections = await Promise.all(
    notices.map(async ([font, path]) => {
      const license = await readFile(new URL(path, import.meta.url), 'utf8')
      return `${font}\n${'='.repeat(font.length)}\n\n${license.trim()}\n`
    }),
  )
  return `pmndrs/text benchmark font notices\n\n${sections.join('\n')}`
}
