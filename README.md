# Configs

My personal configs for macos. Currently this setup includes:

- [CaskaydiaCove Nerd Font](https://www.nerdfonts.com/font-downloads)
- zsh
- [starship](https://starship.rs) - Shell prompt
- [kitty](https://sw.kovidgoyal.net/kitty/) - Terminal emulator
- [homebrew](https://brew.sh/) - Package manager
- [mise](https://mise.jdx.dev/) - Polyglot tool version manager
- [lazygit](https://github.com/jesseduffield/lazygit) - A simple terminal UI for git commands

## Other dependencies

- [GNU Stow](https://www.gnu.org/software/stow/) - Symlink farm manager

## Install

Clone or download the repo to `$HOME`

```bash
git clone https://github.com/vaduc079/configs.git $HOME/configs
```

Use `stow` to symlink everything to `$HOME`

```bash
cd $HOME/configs
stow .
```
