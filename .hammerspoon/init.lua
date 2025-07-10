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

WindowFilter = createFocusableWindowsFilter()

-- Directional window focus

local function focusDirection(direction)
	local currentWindow = hs.window.focusedWindow()
	if not currentWindow then
		return
	end

	local strict = true
	local frontMost = true
	if direction == "left" then
		WindowFilter:focusWindowWest(currentWindow, frontMost, strict)
		return
	end

	if direction == "right" then
		WindowFilter:focusWindowEast(currentWindow, frontMost, strict)
		return
	end

	if direction == "up" then
		WindowFilter:focusWindowNorth(currentWindow, frontMost, strict)
		return
	end

	if direction == "down" then
		WindowFilter:focusWindowSouth(currentWindow, frontMost, strict)
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

	local candidateWindows = WindowFilter:getWindows()
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

	local candidateWindows = WindowFilter:getWindows()
	for _, window in ipairs(candidateWindows) do
		if isPointInFrame(point, window:frame()) then
			window:focus()
			return
		end
	end
end)


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
