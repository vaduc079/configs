# Dotfiles

Personal macOS dotfiles managed with GNU Stow.

## How It Works

- This repo mirrors the structure of `$HOME` (`~`).
- Run `./setup.sh` from repo root to apply Stow-managed links and extra setup steps.
- `.stow-local-ignore` excludes files/folders that should not be linked.

## Prerequisites

- macOS
- [GNU Stow](https://www.gnu.org/software/stow/)

## Setup

```bash
git clone https://github.com/vaduc079/configs.git "$HOME/configs"
cd "$HOME/configs"
./setup.sh
```

## What `setup.sh` Does

`setup.sh` is the entry point for local setup. It currently:

- Runs `stow -v .` from the repo root
- Symlinks `.config/zsh/scripts/git-wt.sh` to `$HOME/.local/bin/git-wt`

Use `./setup.sh --debug` to dry-run the Stow step with `stow -nv .` before applying changes.

## Update

After pulling changes:

```bash
cd "$HOME/configs"
./setup.sh
```
