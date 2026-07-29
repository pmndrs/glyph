import { chromium, type Browser, type LaunchOptions } from 'playwright'

export const chromiumExecutablePathEnvironmentVariable = 'PMNDRS_TEXT_CHROMIUM_EXECUTABLE_PATH'

type ProjectChromiumLaunchOptions = Omit<LaunchOptions, 'executablePath'>

export function projectChromiumLaunchOptions(
  options: ProjectChromiumLaunchOptions,
  environment: NodeJS.ProcessEnv = process.env,
): LaunchOptions {
  const executablePath = environment[chromiumExecutablePathEnvironmentVariable]
  if (executablePath === undefined) return options
  if (executablePath.trim().length === 0) {
    throw new Error(`${chromiumExecutablePathEnvironmentVariable} must name an executable`)
  }
  return { ...options, executablePath }
}

export async function launchProjectChromium(
  options: ProjectChromiumLaunchOptions,
): Promise<Browser> {
  const launchOptions = projectChromiumLaunchOptions(options)
  const browser = await chromium.launch(launchOptions)
  const source =
    launchOptions.executablePath === undefined
      ? 'Playwright-managed executable'
      : launchOptions.executablePath
  process.stderr.write(`[chromium] ${browser.version()} via ${source}\n`)
  return browser
}
