-- Pull in the wezterm API
local wezterm = require("wezterm")

-- This will hold the configuration.
local config = wezterm.config_builder()

-- This is where you actually apply your config choices.
-- config.initial_cols = 200
-- config.initial_rows = 60

-- config.color_scheme = "Kanagawa (Gogh)"
config.color_scheme = "Gruvbox Dark (Gogh)"
-- config.color_scheme = "Everforest Dark (Gogh)"

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
config.use_fancy_tab_bar = false
config.hide_tab_bar_if_only_one_tab = true

config.window_decorations = "RESIZE"
config.window_background_opacity = 0.9
config.macos_window_background_blur = 15

config.pane_focus_follows_mouse = true
config.scrollback_lines = 10000

-- Open wezterm at center of screen
wezterm.on("gui-startup", function(cmd)
	local screen = wezterm.gui.screens().main
	local ratio = 0.8
	local width, height = screen.width * ratio, screen.height * ratio
	cmd = cmd or {}
	cmd.position = {
		x = (screen.width - width) / 2,
		y = (screen.height - height) / 2,
		-- Optional origin to use for x and y.
		-- Possible values:
		-- * "ScreenCoordinateSystem" (this is the default)
		-- * "MainScreen" (the primary or main screen)
		-- * "ActiveScreen" (whichever screen hosts the active/focused window)
		-- * {Named="HDMI-1"} - uses a screen by name. See wezterm.gui.screens()
		origin = "MainScreen",
	}
	local _tab, _pane, window = wezterm.mux.spawn_window(cmd)
	wezterm.log_warn(width, height)
	wezterm.log_warn(screen.width, screen.height)
	-- window:gui_window():maximize()
	window:gui_window():set_inner_size(width, height)
end)

-- Show which key table is active in the status area
wezterm.on("update-right-status", function(window, pane)
	local name = window:active_key_table()
	if name then
		name = "TABLE: " .. name
	end
	window:set_right_status(name or "")
end)

config.leader = { key = "a", mods = "CTRL" }
-- General helper function to create key bindings
local function keyMap(key, mods, action)
	return {
		key = key,
		mods = mods,
		action = action,
	}
end

-- Helper function to create ActivatePaneDirection key bindings
local function activatePaneDirectionKey(key, direction)
	return keyMap(key, "CTRL", wezterm.action.ActivatePaneDirection(direction))
end

local function activateTabKey(key, tab)
	return keyMap(key, "CTRL", wezterm.action.ActivateTab(tab))
end

local function activateKeyTable(key, table)
	return keyMap(
		key,
		"LEADER",
		wezterm.action.ActivateKeyTable({
			name = table,
			one_shot = false,
		})
	)
end

config.keys = {
	-- Pane navigation using helper function
	activatePaneDirectionKey("h", "Left"),
	activatePaneDirectionKey("j", "Down"),
	activatePaneDirectionKey("k", "Up"),
	activatePaneDirectionKey("l", "Right"),
	-- Tab navigation
	activateTabKey("1", 0),
	activateTabKey("2", 1),
	activateTabKey("3", 2),
	activateTabKey("4", 3),
	activateTabKey("5", 4),
	activateTabKey("6", 5),
	activateTabKey("7", 6),
	activateTabKey("8", 7),
	activateTabKey("9", 8),
	activateTabKey("0", 9),
	-- Make Option + Backspace = backward-kill-word
	keyMap("Backspace", "OPT", wezterm.action.SendKey({ key = "w", mods = "CTRL" })),
	-- Make Shift + Enter = new line
	keyMap("Enter", "SHIFT", wezterm.action.SendString("\x1b\r")),
	-- Make Alt + t = Alt + t instead of "†"
	keyMap("t", "ALT", wezterm.action.SendKey({ key = "t", mods = "ALT" })),
	keyMap("i", "ALT", wezterm.action.SendKey({ key = "i", mods = "ALT" })),

	-- Scroll to prompt
	keyMap("UpArrow", "SHIFT", wezterm.action.ScrollToPrompt(-1)),
	keyMap("DownArrow", "SHIFT", wezterm.action.ScrollToPrompt(1)),
	-- Split panes
	-- keyMap("Enter", "CTRL", wezterm.action.SplitHorizontal({ cwd = wezterm.home_dir })),
	-- keyMap("Enter", "CTRL|SHIFT", wezterm.action.SplitVertical({ cwd = wezterm.home_dir })),
	-- keyMap("Enter", "CMD", wezterm.action.SplitHorizontal({ cwd = wezterm.home_dir })),
	-- keyMap("Enter", "CMD|SHIFT", wezterm.action.SplitVertical({ cwd = wezterm.home_dir })),
	keyMap("Enter", "CTRL", wezterm.action.SplitHorizontal({})),
	keyMap("Enter", "CTRL|SHIFT", wezterm.action.SplitVertical({})),
	keyMap("Enter", "CMD", wezterm.action.SplitHorizontal({})),
	keyMap("Enter", "CMD|SHIFT", wezterm.action.SplitVertical({})),
	-- Close pane and tab
	keyMap("w", "CMD", wezterm.action.CloseCurrentPane({ confirm = false })),
	keyMap("w", "CMD|SHIFT", wezterm.action.CloseCurrentTab({ confirm = false })),
	-- Key tables
	activateKeyTable("r", "resize_pane"),
}

config.key_tables = {
	resize_pane = {
		{ key = "LeftArrow", action = wezterm.action.AdjustPaneSize({ "Left", 1 }) },
		{ key = "h", action = wezterm.action.AdjustPaneSize({ "Left", 1 }) },

		{ key = "RightArrow", action = wezterm.action.AdjustPaneSize({ "Right", 1 }) },
		{ key = "l", action = wezterm.action.AdjustPaneSize({ "Right", 1 }) },

		{ key = "UpArrow", action = wezterm.action.AdjustPaneSize({ "Up", 1 }) },
		{ key = "k", action = wezterm.action.AdjustPaneSize({ "Up", 1 }) },

		{ key = "DownArrow", action = wezterm.action.AdjustPaneSize({ "Down", 1 }) },
		{ key = "j", action = wezterm.action.AdjustPaneSize({ "Down", 1 }) },

		-- Cancel the mode by pressing escape
		{ key = "Escape", action = "PopKeyTable" },
	},
}

-- Finally, return the configuration to wezterm:
return config
