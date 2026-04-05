local wezterm = require("wezterm")

local M = {}

function M.apply_to_config(config)
	config.window_padding = {
		left = 0,
		right = 0,
		top = 10,
		bottom = 0,
	}
	config.use_resize_increments = false

	-- config.color_scheme = "Kanagawa (Gogh)"
	config.color_scheme = "Gruvbox Dark (Gogh)"
	-- config.color_scheme = "Everforest Dark (Gogh)"
	config.inactive_pane_hsb = {
		saturation = 1,
		brightness = 0.9,
	}

	config.font_size = 13
	config.font = wezterm.font("CaskaydiaCove Nerd Font Mono")
	config.font_rules = {
		{
			intensity = "Half",
			font = wezterm.font({
				family = "CaskaydiaCove Nerd Font Mono",
				weight = "DemiLight",
			}),
		},
		{
			intensity = "Bold",
			font = wezterm.font({
				family = "CaskaydiaCove Nerd Font Mono",
				weight = "Bold",
			}),
		},
	}

	config.tab_bar_at_bottom = true
	config.use_fancy_tab_bar = true
	config.hide_tab_bar_if_only_one_tab = true
	config.tab_max_width = 50

	config.window_decorations = "RESIZE"
	config.window_background_opacity = 0.98
	config.macos_window_background_blur = 15

	config.pane_focus_follows_mouse = true
	config.scrollback_lines = 10000

	-- Disable macOS Option key composition
	config.send_composed_key_when_left_alt_is_pressed = false
	config.send_composed_key_when_right_alt_is_pressed = false

	-- config.unix_domains = {
	-- 	{
	-- 		name = "unix",
	-- 	},
	-- }
	--
	-- -- This causes `wezterm` to act as though it was started as
	-- -- `wezterm connect unix` by default, connecting to the unix
	-- -- domain on startup.
	-- -- If you prefer to connect manually, leave out this line.
	-- config.default_gui_startup_args = { "connect", "unix" }
end

return M
