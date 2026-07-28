#!/usr/bin/env node

import { execFile, spawn } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const SELF_TEST_RSS_MIB = 96
const DEFAULT_RSS_MIB = 2_048
const DEFAULT_TIMEOUT_SECONDS = 120
const POLL_MILLISECONDS = 100

const separator = process.argv.indexOf('--')
const runnerArguments = process.argv.slice(2, separator < 0 ? undefined : separator)
const selfTest = runnerArguments.includes('--self-test')

if (!selfTest && (separator < 0 || separator === process.argv.length - 1)) {
  console.error(
    'usage: run-tsc-bounded [--rss-mib N] [--timeout-seconds N] [--cwd PATH] -- tsc-args',
  )
  process.exit(2)
}

if (process.platform === 'win32') {
  console.error('run-tsc-bounded currently requires a POSIX process table')
  process.exit(2)
}

function numericOption(name, fallback) {
  const index = runnerArguments.indexOf(name)
  if (index < 0) return fallback
  const value = Number(runnerArguments[index + 1])
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive number`)
  }
  return value
}

function stringOption(name, fallback) {
  const index = runnerArguments.indexOf(name)
  if (index < 0) return fallback
  const value = runnerArguments[index + 1]
  if (value === undefined || value.length === 0) {
    throw new RangeError(`${name} must have a value`)
  }
  return value
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function processSnapshot() {
  const { stdout } = await execFileAsync(
    '/bin/ps',
    ['-axo', 'pid=,ppid=,pgid=,rss=,command='],
    { maxBuffer: 16 * 1024 * 1024 },
  )
  const rows = []
  for (const line of stdout.split('\n')) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/)
    if (match === null) continue
    rows.push({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      pgid: Number(match[3]),
      rssKiB: Number(match[4]),
      command: match[5],
    })
  }
  return rows
}

function expandTrackedProcesses(rows, tracked, rootProcessGroup) {
  let changed = true
  while (changed) {
    changed = false
    for (const row of rows) {
      if (tracked.has(row.pid)) continue
      if (row.pgid === rootProcessGroup || tracked.has(row.ppid)) {
        tracked.add(row.pid)
        changed = true
      }
    }
  }
}

function killProcess(pid) {
  try {
    process.kill(pid, 'SIGKILL')
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error
  }
}

function killTrackedProcesses(rows, tracked, rootProcessGroup) {
  try {
    process.kill(-rootProcessGroup, 'SIGKILL')
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error
  }
  for (const row of rows) {
    if (tracked.has(row.pid)) killProcess(row.pid)
  }
}

async function supervise(executable, args, options) {
  const startedAt = performance.now()
  const child = spawn(executable, args, {
    cwd: options.cwd,
    detached: true,
    stdio: 'inherit',
  })
  if (child.pid === undefined) throw new Error(`failed to start ${executable}`)

  const rootPid = child.pid
  const rootProcessGroup = rootPid
  const tracked = new Set([rootPid])
  const rssLimitKiB = options.rssMiB * 1024
  const timeoutMilliseconds = options.timeoutSeconds * 1000
  let childExit
  let exitOverride
  let peakRssKiB = 0
  let terminationReason

  child.once('error', (error) => {
    childExit = { code: 127, signal: null, error }
  })
  child.once('exit', (code, signal) => {
    childExit = { code, signal }
  })

  while (true) {
    let rows
    try {
      rows = await processSnapshot()
    } catch (error) {
      terminationReason = `process-table probe failed: ${error.message}`
      exitOverride = 125
      rows = []
      killProcess(rootPid)
    }

    expandTrackedProcesses(rows, tracked, rootProcessGroup)
    const liveRows = rows.filter((row) => tracked.has(row.pid))
    const rssKiB = liveRows.reduce((sum, row) => sum + row.rssKiB, 0)
    peakRssKiB = Math.max(peakRssKiB, rssKiB)
    const elapsedMilliseconds = performance.now() - startedAt

    if (terminationReason === undefined && rssKiB > rssLimitKiB) {
      terminationReason = `RSS ${Math.ceil(rssKiB / 1024)} MiB exceeded ${options.rssMiB} MiB`
      exitOverride = 86
    }
    if (terminationReason === undefined && elapsedMilliseconds > timeoutMilliseconds) {
      terminationReason = `wall time exceeded ${options.timeoutSeconds}s`
      exitOverride = 124
    }
    if (terminationReason !== undefined) {
      killTrackedProcesses(rows, tracked, rootProcessGroup)
    }

    if (childExit !== undefined && liveRows.length === 0) break
    if (childExit !== undefined && terminationReason === undefined && liveRows.length > 0) {
      terminationReason = `native compiler exited while ${liveRows.length} descendant process(es) remained`
      exitOverride = 125
      killTrackedProcesses(rows, tracked, rootProcessGroup)
    }

    await delay(POLL_MILLISECONDS)
  }

  const elapsedMilliseconds = Math.round(performance.now() - startedAt)
  const peakRssMiB = Math.ceil(peakRssKiB / 1024)
  if (terminationReason !== undefined) {
    console.error(`TSC_RESOURCE_LIMIT: ${terminationReason}; peak ${peakRssMiB} MiB`)
    return { exitCode: exitOverride, elapsedMilliseconds, peakRssMiB, rootPid }
  }
  if (childExit.error !== undefined) {
    console.error(childExit.error.message)
    return { exitCode: 127, elapsedMilliseconds, peakRssMiB, rootPid }
  }
  if (childExit.signal !== null) {
    console.error(`native compiler terminated by ${childExit.signal}`)
    return { exitCode: 128, elapsedMilliseconds, peakRssMiB, rootPid }
  }
  return {
    exitCode: childExit.code ?? 1,
    elapsedMilliseconds,
    peakRssMiB,
    rootPid,
  }
}

async function nativeTscPath() {
  const packageJson = fileURLToPath(import.meta.resolve('typescript/package.json'))
  const resolver = pathToFileURL(path.join(path.dirname(packageJson), 'lib', 'getExePath.js'))
  const getExePath = (await import(resolver.href)).default
  return getExePath()
}

async function runSelfTest() {
  const allocator = [
    'const retained = []',
    'setInterval(() => retained.push(Buffer.alloc(4 * 1024 * 1024, 1)), 25)',
  ].join(';')
  const result = await supervise(process.execPath, ['-e', allocator], {
    cwd: process.cwd(),
    rssMiB: SELF_TEST_RSS_MIB,
    timeoutSeconds: 10,
  })
  if (result.exitCode !== 86) {
    throw new Error(`bounded-runner self-test expected exit 86, received ${result.exitCode}`)
  }
  console.log(
    `bounded-runner self-test passed: killed PID ${result.rootPid} at ${result.peakRssMiB} MiB`,
  )
}

if (selfTest) {
  await runSelfTest()
} else {
  const result = await supervise(await nativeTscPath(), process.argv.slice(separator + 1), {
    cwd: path.resolve(stringOption('--cwd', process.cwd())),
    rssMiB: numericOption('--rss-mib', DEFAULT_RSS_MIB),
    timeoutSeconds: numericOption('--timeout-seconds', DEFAULT_TIMEOUT_SECONDS),
  })
  console.error(
    `TSC_BOUNDED: ${result.elapsedMilliseconds} ms; peak ${result.peakRssMiB} MiB; exit ${result.exitCode}`,
  )
  process.exitCode = result.exitCode
}
