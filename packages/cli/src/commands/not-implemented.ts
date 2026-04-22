import { banner, blankLine, error, link } from '../output.js';

const PHASE_NOTE: Record<string, string> = {
  init: 'Phase 1 week 3-4',
  login: 'Phase 1 week 3-4',
  link: 'Phase 1 week 3-4',
  deploy: 'Phase 1 week 3-4',
  dev: 'Phase 2 month 2',
  env: 'Phase 2 month 2',
  logs: 'Phase 2 month 2',
  db: 'Phase 2 month 2',
  export: 'Phase 1 week 7-8',
  import: 'Phase 1 week 7-8',
  whoami: 'Phase 1 week 3-4',
  projects: 'Phase 1 week 3-4',
};

export function printNotImplemented(command: string): void {
  banner(`${command}: not implemented yet`);
  blankLine();
  const when = PHASE_NOTE[command];
  if (when) {
    error(`scheduled for ${when} — see BUILD_PLAN.md`);
  } else {
    error('unknown command');
  }
  link('https://docs.briven.cloud');
  process.exit(1);
}
