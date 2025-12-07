-- CLI functions for external control via IPC
local directionalFocus = require("directional_focus")
local focusFollowMouse = require("focus_follow_mouse")
local clickThrough = require("click_through")
local mouseFollowFocus = require("mouse_follow_focus")

-- Enable IPC for CLI access
require("hs.ipc")

-- Print information about the currently focused window
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

-- Set the focus follow mouse interval in milliseconds
function SetFocusFollowMouseInterval(intervalMs)
	focusFollowMouse.setInterval(intervalMs)
end

-- Toggle directional window focus
function ToggleDirectionalWindowFocus()
	directionalFocus.toggle()
end

-- Toggle focus follow mouse
function ToggleFocusFollowMouse()
	focusFollowMouse.toggle()
end

-- Toggle left mouse click through
function ToggleLeftMouseClickThrough()
	clickThrough.toggle()
end

-- Toggle mouse follow focus
function ToggleMouseFollowFocus()
	mouseFollowFocus.toggle()
end