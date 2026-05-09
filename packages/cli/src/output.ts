import pc from 'picocolors';

/**
 * CLI output helpers. Per BRAND.md §7.4: terse, scannable, colour used
 * sparingly, no ASCII art, no emojis. The single word "briven" renders in
 * brand green as the only accent on any line.
 */
const BRAND = '  briven';

export function banner(line: string): void {
  process.stdout.write(`${pc.green(BRAND)}  ${line}\n`);
}

export function step(line: string): void {
  process.stdout.write(`        ${pc.dim('·')} ${line}\n`);
}

export function success(line: string): void {
  process.stdout.write(`        ${pc.green('·')} ${line}\n`);
}

export function error(line: string): void {
  process.stderr.write(`        ${pc.red('·')} ${line}\n`);
}

export function blankLine(): void {
  process.stdout.write('\n');
}

export function link(url: string): void {
  process.stdout.write(`\n        ${pc.dim(url)}\n`);
}
