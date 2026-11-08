# pi-extensions

Duc's pi extensions, as one local pi package. pi loads every `extensions/*/index.ts` (the `pi` manifest in `package.json`) from one `packages` entry in `~/.pi/agent/settings.json`.

## Commands

```bash
npm install          # also links pi's packages into node_modules (npm run link-pi)
npm run check        # typecheck + lint + tests; must pass before you hand work back
npm run link-pi      # after a pi upgrade, or when @earendil-works/* stops resolving
```

`npm run lint` runs oxlint (type-aware, with the `local` JS plugin in `lint/plugin.ts`), `lint/structure.ts`, and knip (unused files, exports, dependencies).

## Structure

```
extensions/<name>/   one extension; index.ts is the entry pi loads
src/                 code shared between extensions
lint/                the oxlint plugin (`local/*` rules) and the structure check
scripts/             package tooling
```

Enforced by lint (`local/boundaries` in `lint/boundaries.ts`, and `lint/structure.ts`):

- An extension imports its own folder, `src/`, `node:` built-ins, and pi's host packages. It never imports another extension. To share code, move it to `src/`.
- `src/` never imports an extension, and extensions and `src/` never import tooling (`lint/`, `scripts/`).
- Every `src/` module is reached by at least one extension (tests do not count). Put code in `src/` when it is shared, or is a building block another extension is about to use; keep code with one user in its extension otherwise (review item).
- Relative imports include the file extension (`./ui.ts`), because Node and pi load the path as written.
- Tests sit beside the module they test (`ui.test.ts` next to `ui.ts`), with no `test/` folders. A test-only helper is named `*.fixture.ts`.
- The root holds only the entries listed in `lint/structure.ts`.

## Code

Follow `duc-principle-write-code` and `duc-principle-simple-solution`. `.oxlintrc.json` enforces the parts that can be checked. Lint holds only rules that correct code almost never breaks. A disable needs `// oxlint-disable-next-line <rule> -- <reason>` (`local/disable-reason`); `local/boundaries`, `local/disable-reason`, `no-explicit-any` and the `no-unsafe-*` rules cannot be disabled, and only line-scoped disables (`-line`, `-next-line`) are allowed.

Review these:

- No single-use helpers unless the name explains a real concept. No thin wrappers.
- Comments say why, not what.
- Name complex conditions with a variable.
- Is this try/catch at a real I/O, parse, or process boundary, and does the catch handle a failure you can name?
- Would map/filter/flatMap or for...of read better than this index loop?
- No guard or fallback for a failure you cannot name.
- Does a class extend another? Prefer composition. `local/no-extends` flags it too; a disable of it needs a reason the reviewer agrees with.

`extensions/permissions/shell/scan.ts` is vendored from OpenCode. Style rules are off for it so it stays diffable against upstream; keep its header up to date when you change it.

## pi specifics

- **pi imports each extension separately with `moduleCache: false`.** Every extension gets its own copy of a `src/` module, so a module-level variable is not shared. Cross-extension state goes through `pi.events` or `globalThis`.
- **Host packages** (`@earendil-works/pi-ai`, `pi-agent-core`, `pi-coding-agent`, `pi-tui`, `typebox`) come from the running pi. Never add them to `dependencies` and never npm-install them. `scripts/link-pi.ts` links each one from the installed release so types and tests match.
- **Only erasable TypeScript** (no enums, namespaces, or parameter properties), and use `import type` for types. pi and Node's type stripping load the `.ts` files as they are; `tsconfig.json` enforces this.
- **`PI_SUBAGENT_CHILD=1`** is set by `subagents` in its child sessions. Code that would prompt the user must not prompt in a child: `permissions` blocks `ask` rules there.
- **A displayed custom message** (a subagent result, a background command's result) closes the open tool group in `tools-verbose-low` low mode.
- pi docs: `node_modules/@earendil-works/pi-coding-agent/docs` (linked from the installed release).

## Working rules

- Personal repo: Duc commits. Agents leave changes uncommitted and never push.
- Duc edits `~/.pi/agent/settings.json` and `permissions.json` by hand.
- Check a change live before calling it done: start `pi` in a Rex pane and use the feature. Running sessions pick up changes on `/reload`.
