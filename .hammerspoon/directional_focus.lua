-- Directional window focus with hotkeys
local utils = require("utils")
local M = {}

-- Module state
local isEnabled = false
local hotkeys = {}

-- Start directional window focus (bind hotkeys)
local function start()
	if isEnabled then
		return
	end

	hotkeys.left = hs.hotkey.bind({ "cmd", "shift" }, "h", function()
		utils.focusDirection("left")
	end)

	hotkeys.right = hs.hotkey.bind({ "cmd", "shift" }, "l", function()
		utils.focusDirection("right")
	end)

	hotkeys.up = hs.hotkey.bind({ "cmd", "shift" }, "k", function()
		utils.focusDirection("up")
	end)

	hotkeys.down = hs.hotkey.bind({ "cmd", "shift" }, "j", function()
		utils.focusDirection("down")
	end)

	isEnabled = true
end

-- Stop directional window focus (unbind hotkeys)
local function stop()
	if not isEnabled then
		return
	end

	for _, hotkey in pairs(hotkeys) do
		hotkey:delete()
	end
	hotkeys = {}
	isEnabled = false
end

-- Toggle directional window focus on/off
local function toggle()
	if isEnabled then
		stop()
		hs.alert.show("Directional window focus disabled")
	else
		start()
		hs.alert.show("Directional window focus enabled")
	end
end

-- Check if currently enabled
local function getIsEnabled()
	return isEnabled
end

-- Public API
M.start = start
M.stop = stop
M.toggle = toggle
M.isEnabled = getIsEnabled

return M