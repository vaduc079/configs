# Configs

My personal configs for Wayland. Currently include:

- [foot](https://codeberg.org/dnkl/foot) - Wayland terminal emulator
- [sway](https://github.com/swaywm/sway) - i3-compatible Wayland compositor
- [waybar](https://github.com/Alexays/Waybar) - Wayland bar for Sway and Wlroots based compositors
- [fuzzel](https://codeberg.org/dnkl/fuzzel) - A launcher/menu program for wlroots based wayland compositors
- [swaync](https://github.com/ErikReider/SwayNotificationCenter) - GTK based notification daemon for SwayWM
- zsh

## Other dependencies

- [fcitx5](https://fcitx-im.org/wiki/Fcitx_5) - Input method
- [CaskaydiaCove Nerd Font](https://www.nerdfonts.com/font-downloads)
- [starship](starship.rs) - Shell prompt
- [autotiling](https://github.com/nwg-piotr/autotiling) - Automatically switch sway/i3 window split orientation script
- [flameshot](https://github.com/flameshot-org/flameshot) - Screenshot software
- [cliphist](https://github.com/sentriz/cliphist) - Wayland clipboard manager
- [wtype](https://github.com/atx/wtype) - xdotool type for wayland
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
