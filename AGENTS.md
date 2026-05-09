# AGENTS

## Dotfiles Structure

This repository mimics the structure of the home folder (`~`).
Paths in this repo should match where they are expected under `$HOME`.

## Symlink Workflow

Use `./setup.sh` from the repository root as the primary setup entry point:

```bash
./setup.sh
```

This runs GNU Stow to expose configs in `$HOME` and applies extra setup steps that do not fit the Stow mirror structure.

For a dry run of the Stow step:

```bash
./setup.sh --debug
```

## Ignore Rules

Use `.stow-local-ignore` to omit files or folders that should not be stowed.
Update that file whenever new local-only artifacts should be excluded.
