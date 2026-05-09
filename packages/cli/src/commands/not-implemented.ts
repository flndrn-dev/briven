import { banner, blankLine, error, link } from '../output.js';

const PHASE_NOTE: Record<string, string> = {
  export: 'Phase 1 week 7-8',
  import: 'Phase 1 week 7-8',
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
