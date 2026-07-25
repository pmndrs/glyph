export type Capability = 'deterministic' | 'font-bytes' | 'wasm' | 'raster' | 'gpu-timestamps'

export type TargetStatus = 'ready' | 'needs-fixture' | 'unavailable'

export interface BenchmarkEnvironment {
  readonly browser: string
  readonly hardwareConcurrency: number
  readonly webgpu: boolean
  readonly crossOriginIsolated: boolean
}

export interface BenchmarkControls {
  readonly samples: number
  readonly warmup: number
}

export interface BenchmarkInput {
  readonly fontBytes?: Uint8Array
}

export interface BenchmarkMeasurement {
  readonly sample: number
  readonly durationMs: number
  readonly outputBytes: number
  readonly hash: string
}

export interface BenchmarkSummary {
  readonly targetId: string
  readonly scenarioId: string
  readonly status: 'passed' | 'failed'
  readonly validation: string
  readonly measurements: readonly BenchmarkMeasurement[]
  readonly medianMs: number
  readonly p95Ms: number
  readonly minMs: number
  readonly maxMs: number
  readonly outputBytes: number
  readonly completedAt: string
  readonly environment: BenchmarkEnvironment
}

export interface TargetRunOutput {
  readonly bytes: number
  readonly hash: string
}

export interface BenchmarkTarget {
  readonly id: string
  readonly label: string
  readonly detail: string
  readonly color: 'violet' | 'green' | 'cyan' | 'amber'
  readonly capabilities: ReadonlySet<Capability>
  status(input: BenchmarkInput): TargetStatus
  load(): Promise<void>
  run(input: BenchmarkInput, sample: number): Promise<TargetRunOutput>
  dispose(): Promise<void>
}

export interface BenchmarkScenario {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly requiredCapabilities: ReadonlySet<Capability>
  validate(measurements: readonly BenchmarkMeasurement[]): string
}

export interface RunnerEvent {
  readonly phase: 'loading' | 'warming' | 'sampling' | 'complete'
  readonly completed: number
  readonly total: number
}
