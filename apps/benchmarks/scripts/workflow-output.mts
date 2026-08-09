const VITEXEC_FAILURE = /(?:^|\n)\[(?:error|page error)\]/;

/** Vitexec 0.1.17 reports injected-module failures as browser logs while exiting successfully. */
export function hasVitexecFailure(output: string): boolean {
  return VITEXEC_FAILURE.test(output);
}
