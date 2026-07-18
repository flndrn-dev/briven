import { printSetupHelp, runSetup } from '../setup.js';

export async function runSetupCommand(argv: readonly string[]): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    printSetupHelp();
    return 0;
  }
  return runSetup(argv);
}
