-- Window utilities and helper functions
local M = {}

-- Check if a window can be focused (visible, standard, not minimized/fullscreen)
local function isWindowFocusable(window)
	return window:isStandard() and window:isVisible() and not (window:isMinimized() or window:isFullScreen())
end

-- Check if a point is within a window frame
local function isPointInFrame(point, frame)
	return point.x >= frame.x and point.x <= frame.x + frame.w and
			point.y >= frame.y and point.y <= frame.y + frame.h
end

-- Cached window filters for performance
local FocusableWindowFilter = nil
local StandardWindowFilter = nil

-- Get or create focusable windows filter (cached)
local function getFocusableWindowsFilter()
	if FocusableWindowFilter then
		return FocusableWindowFilter
	end

	FocusableWindowFilter = hs.window.filter
			.new(function(window)
				return isWindowFocusable(window)
			end)
			:setCurrentSpace(true)

	return FocusableWindowFilter
end

-- Get or create standard windows filter (cached)
local function getStandardWindowsFilter()
	if StandardWindowFilter then
		return StandardWindowFilter
	end

	StandardWindowFilter = hs.window.filter
			.new(function(window)
				return window:isStandard()
			end)

	return StandardWindowFilter
end

-- Focus a window in the specified direction
local function focusDirection(direction)
	local currentWindow = hs.window.focusedWindow()
	if not currentWindow then
		return
	end

	local strict = false
	local frontMost = true
	local focusableFilter = getFocusableWindowsFilter()

	if direction == "left" then
		focusableFilter:focusWindowWest(currentWindow, frontMost, strict)
	elseif direction == "right" then
		focusableFilter:focusWindowEast(currentWindow, frontMost, strict)
	elseif direction == "up" then
		focusableFilter:focusWindowNorth(currentWindow, frontMost, strict)
	elseif direction == "down" then
		focusableFilter:focusWindowSouth(currentWindow, frontMost, strict)
	end
end

-- Public API
M.isWindowFocusable = isWindowFocusable
M.isPointInFrame = isPointInFrame
M.getFocusableWindowsFilter = getFocusableWindowsFilter
M.getStandardWindowsFilter = getStandardWindowsFilter
M.focusDirection = focusDirection

return M