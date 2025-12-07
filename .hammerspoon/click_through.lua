-- Left mouse click through functionality
local utils = require("utils")
local M = {}

-- Module state
local clickThroughEventTap = nil

-- Create the click through event tap
local function createEventTap()
	return hs.eventtap.new({ hs.eventtap.event.types.leftMouseDown }, function(event)
		local mousePoint = hs.mouse.absolutePosition()
		local currentWindow = hs.window.focusedWindow()

		-- Skip if current window is fullscreen
		if currentWindow and currentWindow:isFullScreen() then
			return
		end

		-- Skip if click is in current window
		if currentWindow and utils.isPointInFrame(mousePoint, currentWindow:frame()) then
			return
		end

		-- Find and focus window under mouse cursor
		local candidateWindows = utils.getFocusableWindowsFilter():getWindows()
		for _, window in ipairs(candidateWindows) do
			if utils.isPointInFrame(mousePoint, window:frame()) then
				window:focus()
				return
			end
		end
	end)
end

-- Start left mouse click through
local function start()
	if clickThroughEventTap then
		return
	end

	clickThroughEventTap = createEventTap()
	clickThroughEventTap:start()
end

-- Stop left mouse click through
local function stop()
	if clickThroughEventTap then
		clickThroughEventTap:stop()
		clickThroughEventTap = nil
	end
end

-- Toggle left mouse click through on/off
local function toggle()
	if clickThroughEventTap and clickThroughEventTap:isEnabled() then
		stop()
		hs.alert.show("Left mouse click through disabled")
	else
		start()
		hs.alert.show("Left mouse click through enabled")
	end
end

-- Check if currently enabled
local function isEnabled()
	return clickThroughEventTap and clickThroughEventTap:isEnabled()
end

-- Public API
M.start = start
M.stop = stop
M.toggle = toggle
M.isEnabled = isEnabled

return M