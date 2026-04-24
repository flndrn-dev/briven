export type Pm = 'npm' | 'pnpm' | 'yarn' | 'bun';
export const PMS: readonly Pm[] = ['npm', 'pnpm', 'yarn', 'bun'];

export type PmBlock = Record<Pm, string>;

/**
 * Run an already-installed bin (from ./node_modules/.bin) using each PM's
 * native shortcut. Lines are prefixed with `$ ` to match the existing docs
 * code style.
 */
export function pmExec(...lines: string[]): PmBlock {
  const prefix: PmBlock = {
    npm: 'npx',
    pnpm: 'pnpm',
    yarn: 'yarn',
    bun: 'bunx',
  };
  const out = {} as PmBlock;
  for (const m of PMS) {
    out[m] = lines.map((l) => `$ ${prefix[m]} ${l}`).join('\n');
  }
  return out;
}

/**
 * One-shot remote execution without a prior install (npx / dlx / bunx style).
 */
export function pmDlx(cmd: string): PmBlock {
  return {
    npm: `$ npx ${cmd}`,
    pnpm: `$ pnpm dlx ${cmd}`,
    yarn: `$ yarn dlx ${cmd}`,
    bun: `$ bunx ${cmd}`,
  };
}

/**
 * Install one or more packages. `dev: true` switches to a dev-dep install.
 */
export function pmInstall(pkgs: string, options: { dev?: boolean } = {}): PmBlock {
  const dev = options.dev ?? false;
  return {
    npm: `$ npm install ${dev ? '-D ' : ''}${pkgs}`,
    pnpm: `$ pnpm add ${dev ? '-D ' : ''}${pkgs}`,
    yarn: `$ yarn add ${dev ? '-D ' : ''}${pkgs}`,
    bun: `$ bun add ${dev ? '-d ' : ''}${pkgs}`,
  };
}

/** Same literal line across every PM — for things like `mkdir` that don't vary. */
export function pmPlain(...lines: string[]): PmBlock {
  const body = lines.join('\n');
  return { npm: body, pnpm: body, yarn: body, bun: body };
}

/** Concatenate several blocks vertically, preserving each PM's own body. */
export function pmJoin(...blocks: PmBlock[]): PmBlock {
  const out = {} as PmBlock;
  for (const m of PMS) {
    out[m] = blocks.map((b) => b[m]).join('\n');
  }
  return out;
}
