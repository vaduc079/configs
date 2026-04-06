-- Launch the Neovim directory picker in a transient Terminal.app session
local M = {}

local hyper = { "cmd", "alt", "ctrl", "shift" }
local hotkeys = {}
local selectDirectoryScript = "/Users/duc.vu/configs/.config/zsh/scripts/select-directory-open-nvim.sh"
local windowWidth = 750
local windowHeight = 475
local verticalOffsetRatio = -0.165

local function escapeAppleScriptString(value)
	return value:gsub("\\", "\\\\"):gsub('"', '\\"')
end

local function openDirectoryPicker()
	local screenFrame = hs.screen.mainScreen():frame()
	local verticalOffset = math.floor(screenFrame.h * verticalOffsetRatio)
	local targetLeft = math.floor(screenFrame.x + ((screenFrame.w - windowWidth) / 2))
	local targetTop = math.floor(screenFrame.y + ((screenFrame.h - windowHeight) / 2) + verticalOffset)
	local minTop = math.floor(screenFrame.y)
	local command = string.format("%q; exit", selectDirectoryScript)
	local script = string.format(
		[[
		tell application "Terminal"
			do script "%s"
			set bounds of front window to {%d, %d, %d, %d}
			activate
		end tell
	]],
		escapeAppleScriptString(command),
		targetLeft,
		math.max(targetTop, minTop),
		targetLeft + windowWidth,
		math.max(targetTop, minTop) + windowHeight
	)
	local ok, _, errorMessage = hs.osascript.applescript(script)

	if not ok then
		hs.alert.show(errorMessage or "Failed to launch Terminal")
	end
end

local function start()
	if hotkeys.openPicker then
		return
	end

	hotkeys.openPicker = hs.hotkey.bind(hyper, "e", openDirectoryPicker)
end

local function stop()
	if not hotkeys.openPicker then
		return
	end

	hotkeys.openPicker:delete()
	hotkeys.openPicker = nil
end

M.start = start
M.stop = stop

return M
