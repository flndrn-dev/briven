import { banner, blankLine, error, link } from '../output.js';

const PHASE_NOTE: Record<string, string> = {
  export: 'private beta',
  import: 'private beta',
};

export function printNotImplemented(command: string): void {
  banner(`${command}: not implemented yet`);
  blankLine();
  const when = PHASE_NOTE[command];
  if (when) {
    error(`scheduled for ${when} — see the changelog at docs.briven.cloud`);
  } else {
    error('unknown command');
  }
  link('https://docs.briven.cloud');
  process.exit(1);
}
