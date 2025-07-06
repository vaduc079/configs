-- Hammerspoon script for directional window focus

local function focusDirection(direction)
	local currentWindow = hs.window.focusedWindow()
	if not currentWindow then
		return
	end

	local windowFilter = hs.window.filter
		.new(function(window)
			if window:id() == currentWindow:id() then
				return false
			end

			return window:isVisible() and not (window:isMinimized() or window:isFullScreen())
		end)
		:setCurrentSpace(true)
		:setScreens(currentWindow:screen():id())

	local strict = true
	local frontMost = true
	if direction == "left" then
		windowFilter:focusWindowWest(currentWindow, frontMost, strict)
		return
	end

	if direction == "right" then
		windowFilter:focusWindowEast(currentWindow, frontMost, strict)
		return
	end

	if direction == "up" then
		windowFilter:focusWindowNorth(currentWindow, frontMost, strict)
		return
	end

	if direction == "down" then
		windowFilter:focusWindowSouth(currentWindow, frontMost, strict)
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
