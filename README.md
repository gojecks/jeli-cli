# jeli-cli

The toolchain for [jeli](https://github.com/gojecks/jeli-js) apps and libraries: the `jeli` command line, the
template compiler, and the dev server.

## Packages

This is a monorepo (`packages/*`, Yarn workspaces). Each package is published under the `@jeli` scope:

| Package | Binary | Purpose |
|---|---|---|
| [`@jeli/cli`](packages/cli) | `jeli` | Commands: create, build, serve, test, generate, update |
| [`@jeli/compiler-cli`](packages/compiler-cli) | `jeli-compiler` | Compiles templates, styles and modules into UMD/ES bundles |
| [`@jeli/dev-cli`](packages/dev-cli) | — | Dev server with live reload, plus test utilities for app specs |

## Install

```sh
npm install -g @jeli/cli
jeli create my-app
cd my-app
jeli serve
```

## Commands

| Command | What it does |
|---|---|
| `jeli create <name>` | Scaffold an application or library |
| `jeli build [project]` | Build a project from `jeli.json` (`--all` builds every project) |
| `jeli serve [project]` | Build, serve and rebuild on change |
| `jeli test [project]` | Build first (so real compile errors surface), then run Jest |
| `jeli new <type> <path>` | Generate an element, directive, service, pipe or module, with a `.spec.js` (`-T` to skip) |
| `jeli remove <name>` | Remove a project from the workspace |
| `jeli update [packages...]` | Check npm for newer `@jeli/*` versions and update `package.json` (`--dry`, `-y`) |
| `jeli docs [project]` | Generate API docs (esdoc) |
| `jeli info` | Print environment info |

## Configuration (`jeli.json`)

```json
{
  "projects": {
    "my-app": {
      "sourceRoot": "src",
      "prefix": "app",
      "output": { "folder": "dist/", "patterns": ["MODULE"], "styles": ["src/styles.scss"] },
      "configurations": {
        "production": { "buildOptions": { "prod": true, "compiledBindings": true, "sass": true } }
      }
    }
  },
  "resolve": { "alias": { "@jeli/*": "../jeli-js/dist/" } }
}
```

Build options worth knowing:

- **`compiledBindings`** compiles template expressions and event handlers to JavaScript ahead of time instead of
  shipping them for the runtime to interpret.
- **`sass`** runs `.scss`/`.sass` through Dart Sass (installed on demand). Without it, styles go through PostCSS
  with nesting only, so Sass variables, maps and control flow fail to parse.
- **`resolve.alias`** maps imports to local builds, e.g. sibling repos' `dist/`.

## Template syntax highlights

- Bindings: `{prop}="expr"`, events `@click="fn($event)"`, two-way `@{:model}="field"`, structural `*if`/`*for`.
- Control-flow blocks: `@if (cond) { … } @else { … }`, `@for (item of items) { … }`,
  `@switch (value) { @case (x) { … } @switchDefault { … } }`.
- Interpolation: `${expr}` updates; `${:expr}` and `attr-x="expr"` bind once.
- Slots: `<j-place>` with `fallback="…"` content.

## Development (this repo)

```sh
yarn install
yarn test         # Jest across the packages (needs --experimental-vm-modules, set by the script)
yarn release      # version and publish the packages
```

Build apps through `packages/cli/bin/jeli.js build` rather than calling `compiler-cli/bin/compiler.js` directly: the
CLI path is the one that includes global Sass stylesheets in the output.

## License

MIT
