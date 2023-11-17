# Configs

My personal configs. Currently includes:
- dunst
- i3wm (based on EndeavourOS's i3 config)
- kitty
- mpv
- picom
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
