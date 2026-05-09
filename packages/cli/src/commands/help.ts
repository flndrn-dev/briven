import { banner, blankLine } from '../output.js';

const HELP = `
usage:   briven <command> [options]

commands:
  init              scaffold briven/ folder and briven.json
  login             store an api key for a project
  logout            forget stored credentials
  whoami            verify stored credentials against the server
  deploy            create a deployment from the current project
  link              associate this directory with a briven project
  dev               watch mode — push schema + functions on change
  env               manage project environment variables
  logs              stream or fetch logs
  db                open studio or psql against the project database
  export            export schema + functions + data
  import            reverse of export
  projects          list projects accessible to the current user

options:
  --version, -v     print the cli version and exit
  --help, -h        print this help and exit

docs:    https://docs.briven.cloud
source:  https://github.com/flndrn-dev/briven
`;

export function printHelp(): void {
  banner('ship typescript backends to your own postgres');
  blankLine();
  process.stdout.write(HELP);
}
