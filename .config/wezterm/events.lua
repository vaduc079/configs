local wezterm = require("wezterm")

local M = {}

function M.apply_to_config(_config)
	-- Open wezterm at center of screen
	wezterm.on("gui-startup", function(cmd)
		local screen = wezterm.gui.screens().main
		local ratio = 0.8
		local width = math.floor(screen.width * ratio)
		local height = math.floor(screen.height * ratio)

		cmd = cmd or {}
		cmd.position = {
			x = math.floor((screen.width - width) / 2),
			y = math.floor((screen.height - height) / 2),
			origin = "MainScreen",
		}

		local _tab, _pane, window = wezterm.mux.spawn_window(cmd)
		window:gui_window():set_inner_size(width, height)
	end)

	-- Show which key table is active in the status area
	wezterm.on("update-right-status", function(window, _pane)
		local name = window:active_key_table()
		if name then
			name = "TABLE: " .. name
		end
		window:set_right_status(name or "")
	end)
end

return M
