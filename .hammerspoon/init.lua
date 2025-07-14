-- Utils
local function isWindowFocusable(window)
	return window:isStandard() and window:isVisible() and not (window:isMinimized() or window:isFullScreen())
end

local function isPointInFrame(point, frame)
	return point.x >= frame.x and point.x <= frame.x + frame.w and
			point.y >= frame.y and point.y <= frame.y + frame.h
end

local function createFocusableWindowsFilter()
	return hs.window.filter
			.new(function(window)
				return isWindowFocusable(window)
			end)
			:setCurrentSpace(true)
end

local function createVisibleWindowsFilter()
	return hs.window.filter
			.new(function(window)
				return window:isVisible() and window:isStandard()
			end)
end

FocusableWindowFilter = createFocusableWindowsFilter()
VisibleWindowFilter = createVisibleWindowsFilter()

-- Directional window focus

local function focusDirection(direction)
	local currentWindow = hs.window.focusedWindow()
	if not currentWindow then
		return
	end

	local strict = true
	local frontMost = true
	if direction == "left" then
		FocusableWindowFilter:focusWindowWest(currentWindow, frontMost, strict)
		return
	end

	if direction == "right" then
		FocusableWindowFilter:focusWindowEast(currentWindow, frontMost, strict)
		return
	end

	if direction == "up" then
		FocusableWindowFilter:focusWindowNorth(currentWindow, frontMost, strict)
		return
	end

	if direction == "down" then
		FocusableWindowFilter:focusWindowSouth(currentWindow, frontMost, strict)
		return
	end
end

-- Bind hotkeys
hs.hotkey.bind({ "cmd", "shift" }, "h", function()
	focusDirection("left")
end)
hs.hotkey.bind({ "cmd", "shift" }, "l", function()
	focusDirection("right")
end)
hs.hotkey.bind({ "cmd", "shift" }, "k", function()
	focusDirection("up")
end)
hs.hotkey.bind({ "cmd", "shift" }, "j", function()
	focusDirection("down")
end)

-- Focus follow mouse (only frontmost windows)
LastEventTimestamp = nil
FocusFollowMouseIntervalNs = 150 * 1000000 -- 150ms
local focusFollowMouse = hs.eventtap.new({ hs.eventtap.event.types.mouseMoved }, function(event)
	if LastEventTimestamp and event:timestamp() - LastEventTimestamp < FocusFollowMouseIntervalNs then
		return
	end

	LastEventTimestamp = event:timestamp()
	-- { x, y }
	local point = hs.mouse.absolutePosition()
	local currentWindow = hs.window.focusedWindow()
	if currentWindow and currentWindow:isFullScreen() then
		return
	end

	if currentWindow and isWindowFocusable(currentWindow) and isPointInFrame(point, currentWindow:frame()) then
		return
	end

	local candidateWindows = FocusableWindowFilter:getWindows()
	for _, window in ipairs(candidateWindows) do
		if isPointInFrame(point, window:frame()) then
			window:focus()
			return
		end
	end

	-- print("not in frame of any window")
end)

-- Left mouse click through
local leftMouseClickThrough = hs.eventtap.new({ hs.eventtap.event.types.leftMouseDown }, function(event)
	-- { x, y }
	local point = hs.mouse.absolutePosition()
	local currentWindow = hs.window.focusedWindow()
	if currentWindow and currentWindow:isFullScreen() then
		return
	end

	if currentWindow and isPointInFrame(point, currentWindow:frame()) then
		return
	end

	local candidateWindows = FocusableWindowFilter:getWindows()
	for _, window in ipairs(candidateWindows) do
		if isPointInFrame(point, window:frame()) then
			window:focus()
			return
		end
	end
end)

-- Mouse follow focus
local mouseFollowFocus = {}
mouseFollowFocus.isEnabled = false
function mouseFollowFocus:start()
	VisibleWindowFilter:subscribe(hs.window.filter.windowFocused, function(window)
		self:moveMouseToWindow(window)
	end)

	VisibleWindowFilter:subscribe(hs.window.filter.windowMoved, function(window)
		if window ~= hs.window.focusedWindow() then
			return
		end

		if #hs.mouse.getButtons() ~= 0 then
			return
		end

		self:moveMouseToWindow(window)
	end)
	self.isEnabled = true
end

function mouseFollowFocus:stop()
	VisibleWindowFilter:unsubscribe({ hs.window.filter.windowFocused, hs.window.filter.windowMoved })
	self.isEnabled = false
end

function mouseFollowFocus:moveMouseToWindow(window)
	local point = hs.mouse.absolutePosition()
	local frame = window:frame()
	if (isPointInFrame(point, frame)) then
		return
	end

	-- local currentScreen = hs.mouse.getCurrentScreen()
	-- local windowScreen = window:screen()
	-- if currentScreen and windowScreen and currentScreen ~= windowScreen then
	-- 	-- avoid getting the mouse stuck on a screen corner by moving through the center of each screen
	-- 	hs.mouse.absolutePosition(currentScreen:frame().center)
	-- 	hs.mouse.absolutePosition(windowScreen:frame().center)
	-- end
	hs.mouse.absolutePosition(frame.center)
end

-- Global functions for cli
require("hs.ipc")

function SetFocusFollowMouseInterval(intervalMs)
	FocusFollowMouseIntervalNs = intervalMs * 1000000
end

function ToggleFocusFollowMouse()
	if focusFollowMouse:isEnabled() then
		focusFollowMouse:stop()
		hs.alert.show("Focus follow mouse disabled")
	else
		focusFollowMouse:start()
		hs.alert.show("Focus follow mouse enabled")
	end
end

function ToggleLeftMouseClickThrough()
	if leftMouseClickThrough:isEnabled() then
		leftMouseClickThrough:stop()
		hs.alert.show("Left mouse click through disabled")
	else
		leftMouseClickThrough:start()
		hs.alert.show("Left mouse click through enabled")
	end
end

function ToggleMouseFollowFocus()
	if mouseFollowFocus.isEnabled then
		mouseFollowFocus:stop()
		hs.alert.show("Mouse follow focus disabled")
	else
		mouseFollowFocus:start()
		hs.alert.show("Mouse follow focus enabled")
	end
end

function PrintCurrentWindowInfo()
	local currentWindow = hs.window.focusedWindow()
	if not currentWindow then
		print("No window focused")
		return
	end

	print("id: ", currentWindow:id())
	print("title: ", currentWindow:title())
	print("isMinimized: ", currentWindow:isMinimized())
	print("isVisible: ", currentWindow:isVisible())
	print("isFullScreen: ", currentWindow:isFullScreen())
	print("screen: ", currentWindow:screen())
	print("frame: ", currentWindow:frame())
	print("isStandard: ", currentWindow:isStandard())
end
