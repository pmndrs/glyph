/* @workflow {
  "name": "hero:format",
  "summary": "Format the hero application with the repository-pinned Oxfmt configuration.",
  "requirements": "Workspace dependencies.",
  "writes": "Formatted source and configuration files under apps/hero"
} */
import { execFileSync } from 'node:child_process';

execFileSync('pnpm', ['exec', 'oxfmt', '.'], { cwd: new URL('..', import.meta.url), stdio: 'inherit' });
