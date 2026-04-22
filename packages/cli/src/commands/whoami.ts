import { apiCall, ApiCallError } from '../api-client.js';
import { readCredentials } from '../config.js';
import { readProjectConfig } from '../project-config.js';
import { banner, blankLine, error as printError, step, success } from '../output.js';

interface InfoResponse {
  projectId: string;
  authenticatedVia: 'api_key' | 'session';
  apiKeyId: string | null;
  userId: string | null;
}

export async function runWhoami(): Promise<number> {
  const file = await readCredentials();
  const local = await readProjectConfig();

  const targetId = local?.projectId ?? file.default;
  if (!targetId) {
    banner('whoami');
    blankLine();
    step('no linked project found.');
    step('run: briven login --project <p_...> --key <brk_...>');
    return 1;
  }

  const cred = file.projects[targetId];
  if (!cred) {
    printError(`no credentials stored for ${targetId}`);
    step('run: briven login --project <id> --key <brk_...>');
    return 1;
  }

  try {
    const info = await apiCall<InfoResponse>(`/v1/projects/${cred.projectId}/info`, {
      apiOrigin: cred.apiOrigin,
      apiKey: cred.apiKey,
    });
    banner('whoami');
    step(`project     ${info.projectId}`);
    step(`origin      ${cred.apiOrigin}`);
    step(`key suffix  ${cred.suffix}`);
    step(`auth        ${info.authenticatedVia}`);
    success('credentials ok');
    return 0;
  } catch (err) {
    if (err instanceof ApiCallError) {
      printError(`server rejected: ${err.code} (${err.status})`);
    } else {
      printError(err instanceof Error ? err.message : 'unknown error');
    }
    return 1;
  }
}
