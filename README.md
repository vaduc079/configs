# Configs

My personal configs for Wayland. Currently include:

- [foot](https://codeberg.org/dnkl/foot) - Wayland terminal emulator
- [sway](https://github.com/swaywm/sway) - i3-compatible Wayland compositor
- zsh

## Other dependencies

- [CaskaydiaCove Nerd Font](https://www.nerdfonts.com/font-downloads)
- [starship](starship.rs) - Shell prompt
- [autotiling](https://github.com/nwg-piotr/autotiling) - Automatically switch sway/i3 window split orientation script
- [waybar](https://github.com/Alexays/Waybar) - Wayland bar for Sway and Wlroots based compositors
- [flameshot](https://github.com/flameshot-org/flameshot) - Screenshot software
- [fnm](https://github.com/Schniz/fnm) - Node.js version manager,
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
