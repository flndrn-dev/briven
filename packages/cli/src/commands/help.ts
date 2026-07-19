import { banner, blankLine } from '../output.js';

const HELP = `
usage:   briven <command> [options]

commands:
  setup             one command: sign in + new/existing project + wire this folder
  storage           MinIO/S3 bucket for this project (setup | status)
  init              scaffold briven/ folder only (no cloud) — prefer \`setup\`
  connect           sign in to the platform only (browser OAuth)
  projects          project lifecycle: list, create, use, unlink, set-default
  auth              manage Briven Auth (scaffold middleware, configure providers)
  login             store a dashboard api key for a project (manual path)
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
  doctor            run a health check against the linked api
  ai                generate schema / function / explain code (schema|function|explain)

lifecycle (convex-style):
  briven setup              # or: briven setup my-app
  briven deploy             # or: briven dev

options:
  --version, -v     print the cli version and exit
  --help, -h        print this help and exit

docs:    https://docs.briven.tech/connect
source:  https://code.konnos.org/flndrn/briven
`;

export function printHelp(): void {
  banner('ship typescript backends to your own version-controlled database');
  blankLine();
  process.stdout.write(HELP);
}
