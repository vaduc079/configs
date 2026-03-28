# Dotfiles

Personal macOS dotfiles managed with GNU Stow.

## How It Works

- This repo mirrors the structure of `$HOME` (`~`).
- Run `stow -v .` from repo root to symlink files into `$HOME`.
- `.stow-local-ignore` excludes files/folders that should not be linked.

## Prerequisites

- macOS
- [GNU Stow](https://www.gnu.org/software/stow/)

## Setup

```bash
git clone https://github.com/vaduc079/configs.git "$HOME/configs"
cd "$HOME/configs"
# To dry run
stow -nv .
# Run
stow -v .
```

## Update

After pulling changes:

```bash
cd "$HOME/configs"
# To dry run
stow -nv .
# Run
stow -v .
```
