# Configs

My personal configs for Wayland. Currently this setup includes:

- [CaskaydiaCove Nerd Font](https://www.nerdfonts.com/font-downloads)
- zsh
- [foot](https://codeberg.org/dnkl/foot) - Wayland terminal emulator
- [starship](https://starship.rs) - Shell prompt
- [fnm](https://github.com/Schniz/fnm) - Node.js version manager,
- [waybar](https://github.com/Alexays/Waybar) - Wayland bar for Sway and Wlroots based compositors
- [fuzzel](https://codeberg.org/dnkl/fuzzel) - A launcher/menu program for wlroots based wayland compositors
- [swaync](https://github.com/ErikReider/SwayNotificationCenter) - GTK based notification daemon for SwayWM
- [lazygit](https://github.com/jesseduffield/lazygit) - A simple terminal UI for git commands
- [bemoji](https://github.com/marty-oehme/bemoji) - Emoji picker with support for fuzzel
- [cliphist](https://github.com/sentriz/cliphist) - Wayland clipboard manager
- [wtype](https://github.com/atx/wtype) - xdotool type for wayland
- [kanshi](https://sr.ht/~emersion/kanshi/) - Dynamic display configuration
- [fcitx5](https://fcitx-im.org/wiki/Fcitx_5) - Input method
- [flameshot](https://github.com/flameshot-org/flameshot) - Screenshot software
- Compositor, don't have to install both of them:
  - [sway](https://github.com/swaywm/sway) - i3-compatible Wayland compositor
    - [autotiling](https://github.com/nwg-piotr/autotiling) - Automatically switch sway/i3 window split orientation script
  - [hyprland](https://hyprland.org/) - Dynamic tiling Wayland compositor based on wlroots that doesn't sacrifice on its looks.
    - [hypridle](https://github.com/hyprwm/hypridle) - Hyprland's idle daemon
    - [hy3](https://github.com/outfoxxed/hy3) - Hyprland plugin for an i3 / sway like manual tiling layout
    - [swaybg](https://github.com/swaywm/swaybg) - Wallpaper tool for Wayland compositors

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
