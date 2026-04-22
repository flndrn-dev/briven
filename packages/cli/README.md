# @briven/cli

> ship typescript backends to your own postgres

The developer CLI for [briven](https://briven.cloud).

## install

```bash
# one-off, no install
npx briven init

# or install globally
pnpm add -g @briven/cli
```

## commands

Implemented commands land through [BUILD_PLAN.md](../../docs/BUILD_PLAN.md) phases. Run `briven --help` for the live list.

```
briven init
briven login
briven link
briven dev
briven deploy
briven env set|get|list|rm
briven logs [--tail] [--function=name]
briven db studio | shell
briven export [--data] [--schema] [--functions]
briven import <path>
briven whoami
briven projects
```

## licence

MIT.
