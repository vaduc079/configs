-- Mouse follow focus functionality
local utils = require("utils")
local M = {}

-- Module state
local isEnabled = false

-- Move mouse to center of window if not already inside
local function moveMouseToWindow(window)
	local mousePoint = hs.mouse.absolutePosition()
	local frame = window:frame()

	-- Don't move if mouse is already in the window
	if utils.isPointInFrame(mousePoint, frame) then
		return
	end

	-- Move mouse to window center
	hs.mouse.absolutePosition(frame.center)
end

-- Start mouse follow focus (subscribe to window events)
local function start()
	if isEnabled then
		return
	end

	local standardFilter = utils.getStandardWindowsFilter()

	-- Move mouse when window gains focus
	standardFilter:subscribe(hs.window.filter.windowFocused, function(window)
		moveMouseToWindow(window)
	end)

	-- Move mouse when focused window moves (if mouse buttons not pressed)
	standardFilter:subscribe(hs.window.filter.windowMoved, function(window)
		local currentFocusedWindow = hs.window.focusedWindow()
		if window ~= currentFocusedWindow then
			return
		end

		-- Don't move mouse if user is dragging
		if #hs.mouse.getButtons() ~= 0 then
			return
		end

		moveMouseToWindow(window)
	end)

	isEnabled = true
end

-- Stop mouse follow focus (unsubscribe from window events)
local function stop()
	if not isEnabled then
		return
	end

	local standardFilter = utils.getStandardWindowsFilter()
	standardFilter:unsubscribe({ 
		hs.window.filter.windowFocused, 
		hs.window.filter.windowMoved 
	})

	isEnabled = false
end

-- Toggle mouse follow focus on/off
local function toggle()
	if isEnabled then
		stop()
		hs.alert.show("Mouse follow focus disabled")
	else
		start()
		hs.alert.show("Mouse follow focus enabled")
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