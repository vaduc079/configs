# Configs

My personal configs. Currently includes:

- alacritty
- sway (need `python-i3ipc>=2.0.1` for autotiling)
- zsh
- starship

## Install

Install any included packages.

Install GNU `stow`.

Clone or download the repo to `$HOME`

```bash
git clone https://github.com/vaduc079/configs.git ~/configs
```

Run `stow` to symlink everything to `$HOME`

```bash
cd ~/configs
stow .
```
