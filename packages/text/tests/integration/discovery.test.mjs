import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { discoverProjectFonts } from '../../dist/discovery.js'

async function project() {
  const root = await mkdtemp(join(tmpdir(), 'pmndrs-text-discovery-'))
  await Promise.all([
    mkdir(join(root, 'src'), { recursive: true }),
    mkdir(join(root, 'public', 'fonts'), { recursive: true }),
    mkdir(join(root, 'node_modules', '@fixture', 'raster'), { recursive: true }),
  ])
  await writeFile(
    join(root, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        module: 'esnext',
        moduleResolution: 'bundler',
        target: 'es2022',
        jsx: 'preserve',
        strict: true,
      },
      include: ['src'],
    }),
  )
  await writeFile(
    join(root, 'node_modules', '@fixture', 'raster', 'package.json'),
    JSON.stringify({
      name: '@fixture/raster',
      version: '1.0.0',
      type: 'module',
      exports: {
        '.': { types: './index.d.ts', import: './index.js' },
        './bakers/bitmap': { types: './index.d.ts', import: './baker.js' },
        './package.json': './package.json',
      },
      pmndrs: { text: { bitmap: './bakers/bitmap' } },
    }),
  )
  await writeFile(
    join(root, 'node_modules', '@fixture', 'raster', 'index.d.ts'),
    'export declare function bitmap(options: { strikes: readonly number[] }): unknown\n',
  )
  await writeFile(join(root, 'node_modules', '@fixture', 'raster', 'index.js'), 'export const bitmap = (x) => x\n')
  await writeFile(join(root, 'node_modules', '@fixture', 'raster', 'baker.js'), 'export {}\n')
  return root
}

test('discovers aliased defineFont and immutable raster options through TypeScript symbols', async (t) => {
  const root = await project()
  t.after(() => rm(root, { recursive: true, force: true }))
  const fontPath = join(root, 'public', 'fonts', 'Inter Regular.ttf')
  await writeFile(fontPath, 'font')
  await writeFile(
    join(root, 'src', 'main.ts'),
    `
      import { defineFont as declareFont } from '@pmndrs/text'
      import { bitmap as makeBitmap } from '@fixture/raster'
      declare function assetOrigin(): string
      const origin = assetOrigin()
      const strikes = [16, 32] as const
      export const prose = declareFont(
        \`\${origin}/fonts/Inter%20Regular.ttf?v=4#ignored\`,
        makeBitmap({ strikes }),
      )
      // defineFont('/fonts/not-real.ttf') must not be discovered from text.
    `,
  )

  const report = await discoverProjectFonts({ projectRoot: root })

  assert.deepEqual(report.diagnostics, [])
  assert.equal(report.fonts.length, 1)
  assert.equal(report.fonts[0].resolvedFile, await realpath(fontPath))
  assert.equal(report.fonts[0].publicPathname, '/fonts/Inter Regular.ttf')
  assert.deepEqual(report.fonts[0].raster, {
    packageName: '@fixture/raster',
    kind: 'bitmap',
    specifier: '@fixture/raster/bakers/bitmap',
    options: { strikes: [16, 32] },
  })
})

test('resolves new URL inputs relative to the declaring module', async (t) => {
  const root = await project()
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'src', 'fonts'), { recursive: true })
  const fontPath = join(root, 'src', 'fonts', 'Local.otf')
  await writeFile(fontPath, 'font')
  await writeFile(
    join(root, 'src', 'main.ts'),
    `
      import * as text from '@pmndrs/text'
      import { bitmap } from '@fixture/raster'
      text.defineFont(new URL('./fonts/Local.otf', import.meta.url), bitmap({ strikes: [16] }))
    `,
  )

  const report = await discoverProjectFonts({ projectRoot: root, assetRoots: [join(root, 'src')] })

  assert.deepEqual(report.diagnostics, [])
  assert.equal(report.fonts[0].resolvedFile, await realpath(fontPath))
  assert.equal(report.fonts[0].publicPathname, '/fonts/Local.otf')
})

test('follows imported constants and resolves literal, concatenated, and absolute URL sources', async (t) => {
  const root = await project()
  t.after(() => rm(root, { recursive: true, force: true }))
  const assetRoot = join(root, 'assets')
  await mkdir(join(assetRoot, 'fonts'), { recursive: true })
  await Promise.all([
    writeFile(join(assetRoot, 'fonts', 'Literal.ttf'), 'literal'),
    writeFile(join(assetRoot, 'fonts', 'Combined.ttf'), 'combined'),
    writeFile(join(assetRoot, 'fonts', 'Remote.ttf'), 'remote'),
  ])
  await writeFile(join(root, 'src', 'paths.ts'), "export const moduleFont = '/fonts/Literal.ttf' as const\n")
  await writeFile(
    join(root, 'src', 'main.ts'),
    `
      import { defineFont } from '@pmndrs/text'
      import { bitmap } from '@fixture/raster'
      import { moduleFont } from './paths.js'
      const directory = '/fonts/'
      const name = 'Combined'
      defineFont(moduleFont, bitmap({ strikes: [16] }))
      defineFont(directory + name + '.ttf', bitmap({ strikes: [16] }))
      defineFont(new URL('https://cdn.example/fonts/Remote.ttf?v=4#ignored'), bitmap({ strikes: [16] }))
    `,
  )

  const report = await discoverProjectFonts({ projectRoot: root, assetRoots: [assetRoot] })

  assert.deepEqual(report.diagnostics, [])
  assert.deepEqual(
    report.fonts.map(({ publicPathname }) => publicPathname).sort(),
    ['/fonts/Combined.ttf', '/fonts/Literal.ttf', '/fonts/Remote.ttf'],
  )
})

test('discovers core and React raw forms, resolves source overrides, and skips baked-only inputs', async (t) => {
  const root = await project()
  t.after(() => rm(root, { recursive: true, force: true }))
  await Promise.all([
    writeFile(join(root, 'public', 'fonts', 'Core.ttf'), 'core'),
    writeFile(join(root, 'public', 'fonts', 'React.ttf'), 'react'),
    writeFile(join(root, 'public', 'fonts', 'Override.ttf'), 'override'),
  ])
  await writeFile(
    join(root, 'src', 'main.tsx'),
    `
      import { Text as CoreText, defineFont } from '@pmndrs/text'
      import { Text as ReactText } from '@pmndrs/text/react'
      import { bitmap } from '@fixture/raster'
      new CoreText({ font: '/fonts/Core.ttf', raster: bitmap({ strikes: [16] }) })
      const override = { source: '/fonts/Override.ttf', baked: '/fonts/custom.glb' } as const
      defineFont(override, { module: bitmap, options: { strikes: [16, 32] } })
      defineFont({ baked: '/fonts/Already.font.glb' }, bitmap({ strikes: [16] }))
      export const label = <ReactText font="/fonts/React.ttf" raster={bitmap({ strikes: [16] })} />
    `,
  )

  const report = await discoverProjectFonts({ projectRoot: root })

  assert.deepEqual(report.diagnostics, [])
  assert.deepEqual(
    report.fonts.map(({ publicPathname }) => publicPathname).sort(),
    ['/fonts/Core.ttf', '/fonts/Override.ttf', '/fonts/React.ttf'],
  )
})

test('reports ambiguity, unsafe paths, missing files, dynamic options, and dynamic sources', async (t) => {
  const root = await project()
  t.after(() => rm(root, { recursive: true, force: true }))
  const secondRoot = join(root, 'assets')
  await mkdir(join(secondRoot, 'fonts'), { recursive: true })
  await writeFile(join(root, 'public', 'fonts', 'Shared.ttf'), 'one')
  await writeFile(join(root, 'public', 'fonts', 'Unique.ttf'), 'unique')
  await writeFile(join(secondRoot, 'fonts', 'Shared.ttf'), 'two')
  await writeFile(
    join(root, 'src', 'main.ts'),
    `
      import { defineFont } from '@pmndrs/text'
      import { bitmap } from '@fixture/raster'
      declare function source(): string
      declare function strikes(): number[]
      defineFont('/fonts/Shared.ttf', bitmap({ strikes: [16] }))
      defineFont('/fonts/%2e%2e/secret.ttf', bitmap({ strikes: [16] }))
      defineFont('/fonts/Missing.ttf', bitmap({ strikes: [16] }))
      defineFont('/fonts/Unique.ttf', bitmap({ strikes: strikes() }))
      defineFont(source(), bitmap({ strikes: [16] }))
    `,
  )

  const report = await discoverProjectFonts({
    projectRoot: root,
    assetRoots: [join(root, 'public'), secondRoot],
  })

  assert.deepEqual(
    report.diagnostics.map(({ code }) => code).sort(),
    [
      'ambiguous-font-source',
      'dynamic-font-source',
      'invalid-font-source',
      'invalid-raster-options',
      'missing-font-source',
    ],
  )
  assert.equal(report.fonts.length, 0)
})

test('rejects CommonJS and package-escaping raster baker manifests', async (t) => {
  const root = await project()
  t.after(() => rm(root, { recursive: true, force: true }))
  const commonjsRoot = join(root, 'node_modules', '@fixture', 'commonjs')
  const escapeRoot = join(root, 'node_modules', '@fixture', 'escape')
  await Promise.all([
    mkdir(commonjsRoot, { recursive: true }),
    mkdir(escapeRoot, { recursive: true }),
    writeFile(join(root, 'public', 'fonts', 'Valid.ttf'), 'font'),
  ])
  await Promise.all([
    writeFile(
      join(commonjsRoot, 'package.json'),
      JSON.stringify({
        name: '@fixture/commonjs',
        exports: {
          '.': './index.cjs',
          './bakers/bitmap': { import: './baker.cjs' },
          './package.json': './package.json',
        },
        pmndrs: { text: { bitmap: './bakers/bitmap' } },
      }),
    ),
    writeFile(join(commonjsRoot, 'index.cjs'), 'exports.bitmap = (x) => x\n'),
    writeFile(join(commonjsRoot, 'baker.cjs'), 'module.exports = {}\n'),
    writeFile(
      join(escapeRoot, 'package.json'),
      JSON.stringify({
        name: '@fixture/escape',
        type: 'module',
        exports: {
          '.': './index.js',
          './bakers/bitmap': { import: '../outside.mjs' },
          './package.json': './package.json',
        },
        pmndrs: { text: { bitmap: './bakers/bitmap' } },
      }),
    ),
    writeFile(join(escapeRoot, 'index.js'), 'export const bitmap = (x) => x\n'),
    writeFile(join(root, 'node_modules', '@fixture', 'outside.mjs'), 'export {}\n'),
  ])
  await writeFile(
    join(root, 'src', 'main.ts'),
    `
      import { defineFont } from '@pmndrs/text'
      import { bitmap as commonjs } from '@fixture/commonjs'
      import { bitmap as escaping } from '@fixture/escape'
      defineFont('/fonts/Valid.ttf', commonjs({ strikes: [16] }))
      defineFont('/fonts/Valid.ttf', escaping({ strikes: [16] }))
    `,
  )

  const report = await discoverProjectFonts({ projectRoot: root })

  assert.equal(report.fonts.length, 0)
  assert.deepEqual(report.diagnostics.map(({ code }) => code), [
    'invalid-raster-manifest',
    'invalid-raster-manifest',
  ])
  assert.match(report.diagnostics[0].message, /exported ESM subpath|outside its package/)
  assert.match(report.diagnostics[1].message, /exported ESM subpath|outside its package/)
})
