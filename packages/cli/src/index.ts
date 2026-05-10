import { printHelp } from './commands/help.js';
import { runDb } from './commands/db.js';
import { runDeploy } from './commands/deploy.js';
import { runDev } from './commands/dev.js';
import { runEnv } from './commands/env.js';
import { runExport } from './commands/export.js';
import { runImport } from './commands/import.js';
import { runInit } from './commands/init.js';
import { runInvoke } from './commands/invoke.js';
import { runLink } from './commands/link.js';
import { runLogin } from './commands/login.js';
import { runLogout } from './commands/logout.js';
import { runLogs } from './commands/logs.js';
import { runProjects } from './commands/projects.js';
import { printVersion } from './commands/version.js';
import { runWhoami } from './commands/whoami.js';

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
    case 'link':
      return runLink(rest);
    case 'login':
      return runLogin(rest);
    case 'logout':
      return runLogout(rest);
    case 'whoami':
      return runWhoami();
    case 'deploy':
      return runDeploy(rest);
    case 'invoke':
      return runInvoke(rest);
    case 'env':
      return runEnv(rest);
    case 'db':
      return runDb(rest);
    case 'logs':
      return runLogs(rest);
    case 'dev':
      return runDev(rest);
    case 'projects':
      return runProjects(rest);
    case 'export':
      return runExport(rest);
    case 'import':
      return runImport(rest);
  }

  process.stderr.write(`briven: unknown command '${first}'\n`);
  process.stderr.write(`run 'briven --help' for usage\n`);
  return 1;
}
