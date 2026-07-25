export interface HarnessLocation {
  readonly target: string
  readonly scenario: string
  readonly view: 'scene' | 'controls' | 'report' | 'export'
}

export const defaultLocation: HarnessLocation = {
  target: 'synthetic',
  scenario: 'overview',
  view: 'scene',
}

export function readHarnessLocation(search: string): HarnessLocation {
  const values = new URLSearchParams(search)
  const view = values.get('view')
  return {
    target: values.get('target') ?? defaultLocation.target,
    scenario: values.get('scenario') ?? defaultLocation.scenario,
    view:
      view === 'controls' || view === 'report' || view === 'export' ? view : defaultLocation.view,
  }
}

export function writeHarnessLocation(value: HarnessLocation): string {
  const values = new URLSearchParams()
  values.set('target', value.target)
  values.set('scenario', value.scenario)
  if (value.view !== 'scene') values.set('view', value.view)
  return `?${values.toString()}`
}
