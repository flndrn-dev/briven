import { printHelp } from './commands/help.js';
import { runDeploy } from './commands/deploy.js';
import { runInit } from './commands/init.js';
import { runLogin } from './commands/login.js';
import { runLogout } from './commands/logout.js';
import { printNotImplemented } from './commands/not-implemented.js';
import { printVersion } from './commands/version.js';
import { runWhoami } from './commands/whoami.js';

const STUB_COMMANDS = new Set(['link', 'dev', 'env', 'logs', 'db', 'export', 'import', 'projects']);

export async function run(argv: readonly string[]): Promise<number> {
  const [first, ...rest] = argv;

  if (!first || first === '--help' || first === '-h' || first === 'help') {
    printHelp();
    return 0;
  }

  if (first === '--version' || first === '-v' || first === 'version') {
    printVersion();
    return 0;
  }

  switch (first) {
    case 'init':
      return runInit(rest);
    case 'login':
      return runLogin(rest);
    case 'logout':
      return runLogout(rest);
    case 'whoami':
      return runWhoami();
    case 'deploy':
      return runDeploy(rest);
  }

  if (STUB_COMMANDS.has(first)) {
    printNotImplemented(first);
    return 0;
  }

  process.stderr.write(`briven: unknown command '${first}'\n`);
  process.stderr.write(`run 'briven --help' for usage\n`);
  return 1;
}
