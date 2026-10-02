# `@t00ls-dev/doctor`

Private workspace CLI for deterministic, read-only checks of a Node and
Cloudflare D1 project without exposing secret values.

## Checks

- the running Node.js version against `package.json#engines.node`;
- a parseable package manifest with `name` and `version`;
- `wrangler.jsonc`, `wrangler.json`, or `wrangler.toml` and its core fields;
- required names in `.dev.vars.example`;
- configured D1 bindings and at least one SQL migration in each migrations
  directory;
- standard `db:generate`, `db:migrate`, `db:seed`, and `db:status` scripts;
- forbidden secret files tracked in Git, including real `.env*`, `.dev.vars*`,
  private key, and PKCS#12 files. Example, sample, and template env files are
  allowed.

The command is read-only. It reports variable names and file paths, never
variable or secret values. A report containing any `error` exits with status 1.
Invalid CLI usage exits with status 2; warnings alone do not fail the command.

## Usage

```sh
pnpm --filter @t00ls-dev/doctor build
pnpm --filter @t00ls-dev/doctor exec doctor ./examples/links
pnpm --filter @t00ls-dev/doctor exec doctor ./app --json
```

The default project path is the current directory. The default required names
are `AUTH_SECRET`, `BASE_URL`, `EMAIL_FROM`, and `RESEND_API_KEY`. Supplying one
or more `--required NAME` options replaces that list:

```sh
doctor ./app --required AUTH_SECRET --required API_TOKEN
```

## Library API

`diagnoseProject(path, options)` returns a `DoctorReport`. Every result has a
`check`, a structured `severity` (`info`, `warning`, or `error`), a safe
message, and optionally a project-relative path.
