import { readFile } from 'node:fs/promises'

import { fontNotices } from './font-notices.mts'

const expected = await fontNotices()
const built = await readFile(new URL('../dist/font-notices.txt', import.meta.url), 'utf8')
if (built !== expected) throw new Error('production font notices are missing or stale')
