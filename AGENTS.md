# AGENTS

## Dotfiles Structure

This repository mimics the structure of the home folder (`~`).
Paths in this repo should match where they are expected under `$HOME`.

## Symlink Workflow

Use GNU Stow from the repository root to expose configs in `$HOME`:

```bash
stow -v .
```

This creates symlinks so configurations in this repo are available in the home folder.

## Ignore Rules

Use `.stow-local-ignore` to omit files or folders that should not be stowed.
Update that file whenever new local-only artifacts should be excluded.
