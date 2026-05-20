export interface PullOpts {
  apiOrigin: string;
  bearer: string;
  projectId: string;
  cwd: string;
}

export async function pullSchemaToDisk(_opts: PullOpts): Promise<void> {
  throw new Error('schema-pull: not yet implemented — Task C5');
}
