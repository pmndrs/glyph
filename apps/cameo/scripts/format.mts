/* @workflow {
  "name": "cameo:format",
  "summary": "Format the cameo application with the repository-pinned Oxfmt configuration.",
  "requirements": "Workspace dependencies.",
  "writes": "Formatted source and configuration files under apps/cameo"
} */
import { execFileSync } from 'node:child_process';

execFileSync('pnpm', ['exec', 'oxfmt', '.'], { cwd: new URL('..', import.meta.url), stdio: 'inherit' });
