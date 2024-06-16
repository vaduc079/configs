# Configs

My personal configs for Wayland. Currently include:

- foot
- sway
- zsh

## Other dependencies

- [CaskaydiaCove Nerd Font](https://www.nerdfonts.com/font-downloads)
- [starship](starship.rs)
- [autotiling](https://github.com/nwg-piotr/autotiling)
- [waybar](https://github.com/Alexays/Waybar)
- [flameshot](https://github.com/flameshot-org/flameshot)
- [fnm](https://github.com/Schniz/fnm)
- [GNU Stow](https://www.gnu.org/software/stow/)

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
