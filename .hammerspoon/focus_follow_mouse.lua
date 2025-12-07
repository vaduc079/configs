-- Focus follow mouse functionality
local utils = require("utils")
local M = {}

-- Module state and configuration
local focusFollowMouseEventTap = nil
local lastEventTimestamp = nil
local intervalNs = 150 * 1000000 -- 150ms default interval

-- Create the focus follow mouse event tap
local function createEventTap()
	return hs.eventtap.new({ hs.eventtap.event.types.mouseMoved }, function(event)
		-- Throttle events to avoid excessive processing
		if lastEventTimestamp and event:timestamp() - lastEventTimestamp < intervalNs then
			return
		end

		lastEventTimestamp = event:timestamp()
		local mousePoint = hs.mouse.absolutePosition()
		local currentWindow = hs.window.focusedWindow()

		-- Skip if current window is fullscreen
		if currentWindow and currentWindow:isFullScreen() then
			return
		end

		-- Skip if mouse is already in current focusable window
		if currentWindow and utils.isWindowFocusable(currentWindow) and 
		   utils.isPointInFrame(mousePoint, currentWindow:frame()) then
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

-- Start focus follow mouse
local function start()
	if focusFollowMouseEventTap then
		return
	end

	focusFollowMouseEventTap = createEventTap()
	focusFollowMouseEventTap:start()
end

-- Stop focus follow mouse
local function stop()
	if focusFollowMouseEventTap then
		focusFollowMouseEventTap:stop()
		focusFollowMouseEventTap = nil
	end
	lastEventTimestamp = nil
end

-- Toggle focus follow mouse on/off
local function toggle()
	if focusFollowMouseEventTap and focusFollowMouseEventTap:isEnabled() then
		stop()
		hs.alert.show("Focus follow mouse disabled")
	else
		start()
		hs.alert.show("Focus follow mouse enabled")
	end
end

-- Check if currently enabled
local function isEnabled()
	return focusFollowMouseEventTap and focusFollowMouseEventTap:isEnabled()
end

-- Set the focus follow mouse interval
local function setInterval(intervalMs)
	intervalNs = intervalMs * 1000000
end

-- Get current interval in milliseconds
local function getInterval()
	return intervalNs / 1000000
end

-- Public API
M.start = start
M.stop = stop
M.toggle = toggle
M.isEnabled = isEnabled
M.setInterval = setInterval
M.getInterval = getInterval

return M