local wezterm = require("wezterm")
local act = wezterm.action

local CTRL = "CTRL"
local CMD = "CMD"
local SHIFT = "SHIFT"
local LEADER = "LEADER"

local function key_map(key, mods, action)
	return {
		key = key,
		mods = mods,
		action = action,
	}
end

local function append_all(dst, src)
	for _, item in ipairs(src) do
		dst[#dst + 1] = item
	end
end

local function is_nvim(pane)
	local user_var = pane:get_user_vars().IS_NVIM == "true"
	local process = pane:get_foreground_process_name() or ""
	local process_is_nvim = process:find("n?vim") ~= nil
	return user_var or process_is_nvim
end

local function activate_pane_direction_key(key, direction)
	return key_map(
		key,
		CTRL,
		wezterm.action_callback(function(window, pane)
			if is_nvim(pane) then
				window:perform_action({ SendKey = { key = key, mods = CTRL } }, pane)
				return
			end

			window:perform_action({ ActivatePaneDirection = direction }, pane)
		end)
	)
end

local function smart_pane_split_action()
	return wezterm.action_callback(function(window, pane)
		local dimensions = pane:get_dimensions()
		if dimensions.pixel_height > dimensions.pixel_width then
			window:perform_action(act.SplitVertical({ domain = "CurrentPaneDomain" }), pane)
		else
			window:perform_action(act.SplitHorizontal({ domain = "CurrentPaneDomain" }), pane)
		end
	end)
end

local function activate_tab_key(key, tab)
	return key_map(key, CTRL, act.ActivateTab(tab))
end

local function activate_key_table(key, table_name)
	return key_map(
		key,
		LEADER,
		act.ActivateKeyTable({
			name = table_name,
			one_shot = false,
		})
	)
end

local function pane_navigation_keys()
	local keys = {}
	local directions = {
		{ key = "h", direction = "Left" },
		{ key = "j", direction = "Down" },
		{ key = "k", direction = "Up" },
		{ key = "l", direction = "Right" },
	}

	for _, item in ipairs(directions) do
		keys[#keys + 1] = activate_pane_direction_key(item.key, item.direction)
	end

	return keys
end

local function split_keys(smart_split)
	return {
		key_map("Enter", CTRL, smart_split),
		key_map("Enter", CMD, smart_split),
		key_map("/", CTRL, act.SplitHorizontal({})),
		key_map("/", CMD, act.SplitHorizontal({})),
		key_map("/", CTRL .. "|" .. SHIFT, act.SplitVertical({})),
		key_map("/", CMD .. "|" .. SHIFT, act.SplitVertical({})),
	}
end

local function close_keys()
	return {
		key_map("w", CMD, act.CloseCurrentPane({ confirm = false })),
		key_map("w", CMD .. "|" .. SHIFT, act.CloseCurrentTab({ confirm = false })),
	}
end

local function tab_keys()
	local keys = {}
	local order = { "1", "2", "3", "4", "5", "6", "7", "8", "9", "0" }

	for index, key in ipairs(order) do
		local tab_index = index - 1
		if key == "0" then
			tab_index = 9
		end
		keys[#keys + 1] = activate_tab_key(key, tab_index)
	end

	return keys
end

local function misc_keys()
	return {
		key_map("Backspace", "OPT", act.SendKey({ key = "w", mods = CTRL })),
		key_map("Enter", SHIFT, act.SendString("\x1b\r")),
		key_map("UpArrow", SHIFT, act.ScrollToPrompt(-1)),
		key_map("DownArrow", SHIFT, act.ScrollToPrompt(1)),
		activate_key_table("r", "resize_pane"),
	}
end

local function resize_pane_table()
	return {
		{ key = "LeftArrow", action = act.AdjustPaneSize({ "Left", 1 }) },
		{ key = "h", action = act.AdjustPaneSize({ "Left", 1 }) },
		{ key = "RightArrow", action = act.AdjustPaneSize({ "Right", 1 }) },
		{ key = "l", action = act.AdjustPaneSize({ "Right", 1 }) },
		{ key = "UpArrow", action = act.AdjustPaneSize({ "Up", 1 }) },
		{ key = "k", action = act.AdjustPaneSize({ "Up", 1 }) },
		{ key = "DownArrow", action = act.AdjustPaneSize({ "Down", 1 }) },
		{ key = "j", action = act.AdjustPaneSize({ "Down", 1 }) },
		{ key = "Escape", action = "PopKeyTable" },
	}
end

local M = {}

function M.apply_to_config(config)
	local keys = {}
	local smart_split = smart_pane_split_action()

	append_all(keys, pane_navigation_keys())
	append_all(keys, split_keys(smart_split))
	append_all(keys, close_keys())
	append_all(keys, tab_keys())
	append_all(keys, misc_keys())

	config.leader = { key = "a", mods = CTRL }
	config.keys = keys
	config.key_tables = {
		resize_pane = resize_pane_table(),
	}
end

return M
