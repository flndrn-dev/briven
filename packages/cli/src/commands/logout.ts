import { clearCredentials, readCredentials, writeCredentials } from '../config.js';
import { banner, success } from '../output.js';

export async function runLogout(argv: readonly string[]): Promise<number> {
  const projectArg = parseProject(argv);
  banner('logout');

  if (!projectArg) {
    await clearCredentials();
    success('all credentials cleared');
    return 0;
  }

  const file = await readCredentials();
  delete file.projects[projectArg];
  if (file.default === projectArg) delete file.default;
  await writeCredentials(file);
  success(`credentials for ${projectArg} cleared`);
  return 0;
}

function parseProject(argv: readonly string[]): string | null {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--project' && argv[i + 1]) return argv[i + 1] ?? null;
  }
  return null;
}
