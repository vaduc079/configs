-- Hammerspoon Configuration
-- Modularized window management and mouse behavior

-- Load all modules
local directionalFocus = require("directional_focus")
local focusFollowMouse = require("focus_follow_mouse")
local clickThrough = require("click_through")
local mouseFollowFocus = require("mouse_follow_focus")
local nvimPicker = require("nvim_picker")
local cli = require("cli")

-- Configuration
local config = {
	-- Enable modules by default
	enableDirectionalFocus = true,
	enableFocusFollowMouse = false,
	enableClickThrough = false,
	enableMouseFollowFocus = true,
	enableNvimPicker = true,

	-- Focus follow mouse interval in milliseconds
	focusFollowMouseInterval = 150,
}

-- Initialize enabled modules
local function initializeModules()
	-- Set focus follow mouse interval
	focusFollowMouse.setInterval(config.focusFollowMouseInterval)

	-- Enable modules based on configuration
	if config.enableDirectionalFocus then
		directionalFocus.start()
	end

	if config.enableFocusFollowMouse then
		focusFollowMouse.start()
	end

	if config.enableClickThrough then
		clickThrough.start()
	end

	if config.enableMouseFollowFocus then
		mouseFollowFocus.start()
	end

	if config.enableNvimPicker then
		nvimPicker.start()
	end
end

-- Reload configuration
function ReloadConfig()
	hs.reload()
end

-- Show configuration status
function ShowStatus()
	local status = {
		"Hammerspoon Configuration Status:",
		"",
		string.format("Directional Focus: %s", directionalFocus.isEnabled() and "ENABLED" or "DISABLED"),
		string.format("Focus Follow Mouse: %s", focusFollowMouse.isEnabled() and "ENABLED" or "DISABLED"),
		string.format("Click Through: %s", clickThrough.isEnabled() and "ENABLED" or "DISABLED"),
		string.format("Mouse Follow Focus: %s", mouseFollowFocus.isEnabled() and "ENABLED" or "DISABLED"),
		"",
		string.format("Focus Follow Mouse Interval: %dms", focusFollowMouse.getInterval()),
	}

	hs.alert.show(table.concat(status, "\n"), 3)
end

-- Initialize configuration
initializeModules()

-- Show initialization complete message
hs.alert.show("Hammerspoon configuration loaded", 1)
