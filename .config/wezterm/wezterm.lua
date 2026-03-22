local wezterm = require("wezterm")
local config = wezterm.config_builder()

require("options").apply_to_config(config)
require("events").apply_to_config(config)
require("keys").apply_to_config(config)

return config
