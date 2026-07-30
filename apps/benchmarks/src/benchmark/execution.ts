import type {
  BenchmarkControls,
  BenchmarkEnvironment,
  BenchmarkExecutionContext,
  BenchmarkInput,
  BenchmarkSummary,
  RunnerEvent,
} from './contracts';
import { runBenchmark } from './runner';
import { scenarios } from './scenarios';
import { targets } from './targets';

export interface RegisteredBenchmarkRequest {
  readonly targetId: string;
  readonly scenarioId: string;
  readonly input: BenchmarkInput;
  readonly controls: BenchmarkControls;
  readonly environment: BenchmarkEnvironment;
  readonly executionContext?: BenchmarkExecutionContext;
  readonly onEvent?: (event: RunnerEvent) => void;
}

export async function runRegisteredBenchmark(request: RegisteredBenchmarkRequest): Promise<BenchmarkSummary> {
  const target = targets.find((candidate) => candidate.id === request.targetId);
  if (target === undefined) throw new Error(`Unknown benchmark target: ${request.targetId}`);
  const scenario = scenarios.find((candidate) => candidate.id === request.scenarioId);
  if (scenario === undefined) throw new Error(`Unknown benchmark scenario: ${request.scenarioId}`);

  return runBenchmark({
    target,
    scenario,
    input: request.input,
    controls: request.controls,
    environment: request.environment,
    ...(request.executionContext === undefined ? {} : { executionContext: request.executionContext }),
    ...(request.onEvent === undefined ? {} : { onEvent: request.onEvent }),
  });
}
