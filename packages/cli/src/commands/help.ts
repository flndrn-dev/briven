import { banner, blankLine } from '../output.js';

const HELP = `
usage:   briven <command> [options]

commands:
  init              scaffold briven/ folder and briven.json
  login             store an api key for a project
  logout            forget stored credentials
  whoami            verify stored credentials against the server
  deploy            create a deployment from the current project
  invoke            invoke a deployed function and print the response
  link              associate this directory with a briven project
  dev               watch mode — push schema + functions on change
  env               manage project environment variables
  logs              stream or fetch logs
  db                open studio or psql against the project database
  export            export schema + functions to a json archive
  import            create a deployment from a json archive on the linked project
  projects          list projects authenticated on this machine + set default

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
