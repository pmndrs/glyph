export type WorkflowRunner = 'node' | 'vitexec';

/** Removes pnpm's conventional option delimiter before forwarding workflow arguments. */
export function forwardedWorkflowArguments(arguments_: readonly string[]): readonly string[] {
  return arguments_[0] === '--' ? arguments_.slice(1) : arguments_;
}

/** Keeps Vitexec options before its injected module while preserving ordinary Node argv order. */
export function workflowCommandArguments(
  runner: WorkflowRunner,
  file: string,
  declared: readonly string[],
  forwarded: readonly string[],
): readonly string[] {
  return runner === 'node' ? [file, ...declared, ...forwarded] : [...declared, ...forwarded, file];
}
