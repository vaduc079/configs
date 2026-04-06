-- Launch the Neovim directory picker in WezTerm
local M = {}

local hyper = { "cmd", "alt", "ctrl", "shift" }
local hotkeys = {}
local selectDirectoryScript = "/Users/duc.vu/configs/.config/zsh/scripts/select-directory-open-nvim.sh"
local weztermExecutable = "/opt/homebrew/bin/wezterm"
local focusRetryIntervalSeconds = 0.2
local focusRetryLimit = 20

local function showLaunchError(exitCode, stdErr)
	local errorMessage = stdErr:gsub("%s+$", "")

	if errorMessage == "" then
		errorMessage = string.format("Failed to launch WezTerm (exit %d)", exitCode)
	end

	hs.alert.show(errorMessage)
end

local function focusWezTerm()
	local app = hs.application.get("WezTerm")

	if app then
		app:activate()
		return
	end

	hs.application.launchOrFocus("WezTerm")
end

local function focusWezTermWhenReady()
	local attempts = 0

	local function tryFocus()
		local app = hs.application.get("WezTerm")
		local windowCount = app and #app:allWindows() or 0
		local hasWindow = windowCount > 0

		if hasWindow then
			app:activate()
			return
		end

		attempts = attempts + 1

		if attempts >= focusRetryLimit then
			focusWezTerm()
			return
		end

		hs.timer.doAfter(focusRetryIntervalSeconds, tryFocus)
	end

	tryFocus()
end

local function runWezTerm(arguments, callback)
	local task = hs.task.new(weztermExecutable, function(exitCode, stdOut, stdErr)
		callback(exitCode, stdOut or "", stdErr or "")
	end, arguments)

	if not task then
		hs.alert.show("Failed to create WezTerm task")
		return
	end

	if task:start() then
		return true
	end

	hs.alert.show("Failed to start WezTerm task")
	return false
end

local function openDirectoryPicker()
	if not hs.fs.attributes(weztermExecutable) then
		hs.alert.show(string.format("WezTerm not found at %s", weztermExecutable))
		return
	end

	focusWezTerm()

	runWezTerm({
		"cli",
		"spawn",
		"--",
		selectDirectoryScript,
		"--run",
	}, function(spawnExitCode, _, spawnStdErr)
		if spawnExitCode == 0 then
			return
		end

		local didStart = runWezTerm({
			"start",
			"--",
			selectDirectoryScript,
			"--run",
		}, function(startExitCode, _, startStdErr)
			if startExitCode == 0 then
				return
			end

			showLaunchError(startExitCode, startStdErr)
		end)

		if didStart then
			focusWezTermWhenReady()
		end
	end)
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
