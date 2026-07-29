import assert from 'node:assert/strict'
import test from 'node:test'

import {
  chromiumExecutablePathEnvironmentVariable,
  projectChromiumLaunchOptions,
} from './project-chromium.mts'

test('leaves executablePath absent for the Playwright-managed local default', () => {
  const options = projectChromiumLaunchOptions({ headless: true }, {})

  assert.deepEqual(options, { headless: true })
  assert.equal(Object.hasOwn(options, 'executablePath'), false)
})

test('uses the exact project Chromium executable when configured', () => {
  const options = projectChromiumLaunchOptions(
    { headless: true },
    { [chromiumExecutablePathEnvironmentVariable]: '/opt/project browser/chromium' },
  )

  assert.deepEqual(options, {
    headless: true,
    executablePath: '/opt/project browser/chromium',
  })
})

test('rejects an empty configured Chromium executable', () => {
  assert.throws(
    () =>
      projectChromiumLaunchOptions(
        { headless: true },
        { [chromiumExecutablePathEnvironmentVariable]: '   ' },
      ),
    new Error(`${chromiumExecutablePathEnvironmentVariable} must name an executable`),
  )
})
