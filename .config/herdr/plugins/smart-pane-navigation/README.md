# Smart Pane Navigation

Provides Herdr plugin actions for:

- splitting the focused pane along its longest visual axis
- forwarding `Ctrl+h/j/k/l` to Vim, Neovim, fzf, or Lumen
- otherwise focusing the adjacent Herdr pane

The smart split treats terminal cells as twice as tall as they are wide by
default. Set `HERDR_SMART_SPLIT_CELL_RATIO` before starting Herdr to override
that ratio.

## Install

```sh
herdr plugin link ~/.config/herdr/plugins/smart-pane-navigation
```

For local development from this repo:

```sh
herdr plugin link ~/configs/.config/herdr/plugins/smart-pane-navigation
```

## Test

```sh
bun test ~/.config/herdr/plugins/smart-pane-navigation
```
