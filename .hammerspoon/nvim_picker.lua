-- Launch the Neovim directory picker in WezTerm or Ghostty/tmux.
local M = {}

local hyper = { "cmd", "alt", "ctrl", "shift" }
local hotkeys = {}

local selectDirectoryScript = "/Users/duc.vu/configs/.config/zsh/scripts/select-directory-open-nvim.sh"
local tmuxOpenNvimScript = "/Users/duc.vu/configs/.config/zsh/scripts/tmux-open-neovim.sh"
local weztermExecutable = "/opt/homebrew/bin/wezterm"
local weztermAppName = "WezTerm"
local ghosttyAppName = "Ghostty"
local defaultBackend = "wezterm"

local focusRetryIntervalSeconds = 0.2
local focusRetryLimit = 20
local ghosttyCommandDelaySeconds = 0.15

local activeBackend = defaultBackend
local backends = {}

local function showError(message)
	hs.alert.show(message)
end

local function showWezTermLaunchError(exitCode, stdErr)
	local errorMessage = stdErr:gsub("%s+$", "")

	if errorMessage == "" then
		errorMessage = string.format("Failed to launch WezTerm (exit %d)", exitCode)
	end

	showError(errorMessage)
end

local function toAppleScriptString(value)
	local escapedValue = value:gsub("\\", "\\\\"):gsub('"', '\\"')
	return '"' .. escapedValue .. '"'
end

local function runAppleScript(script)
	local ok, result, errorObject = hs.osascript.applescript(script)

	if ok then
		return true, result
	end

	local errorMessage = type(errorObject) == "table" and errorObject.message or tostring(errorObject)
	return false, errorMessage
end

local function focusApplication(appName)
	local app = hs.application.get(appName)

	if app then
		app:activate()
		return
	end

	hs.application.launchOrFocus(appName)
end

local function focusWezTermWhenReady()
	local attempts = 0

	local function tryFocus()
		local app = hs.application.get(weztermAppName)
		local windowCount = app and #app:allWindows() or 0
		local hasWindow = windowCount > 0

		if hasWindow then
			app:activate()
			return
		end

		attempts = attempts + 1

		if attempts >= focusRetryLimit then
			focusApplication(weztermAppName)
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
		showError("Failed to create WezTerm task")
		return
	end

	if task:start() then
		return true
	end

	showError("Failed to start WezTerm task")
	return false
end

local function runWezTermPicker()
	if not hs.fs.attributes(weztermExecutable) then
		showError(string.format("WezTerm not found at %s", weztermExecutable))
		return
	end

	focusApplication(weztermAppName)

	runWezTerm({
		"cli",
		"spawn",
		"--",
		selectDirectoryScript,
		"--run",
	}, function(spawnExitCode, _, _)
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

			showWezTermLaunchError(startExitCode, startStdErr)
		end)

		if didStart then
			focusWezTermWhenReady()
		end
	end)
end

local function focusGhosttyTerminal()
	local script = [[
tell application "Ghostty"
	activate
	set term to focused terminal of selected tab of front window
	focus term
end tell
]]

	return runAppleScript(script)
end

local function buildGhosttyTmuxPickerCommand()
	return string.format("%s --run %s; exit", selectDirectoryScript, tmuxOpenNvimScript)
end

local function buildGhosttyTmuxAppleScript()
	local pickerCommand = buildGhosttyTmuxPickerCommand()

	return string.format(
		[[
tell application "Ghostty"
	activate
	set term to focused terminal of selected tab of front window
	focus term
	perform action ("text:" & (ASCII character 1) & "c") on term
	delay %.2f
	input text %s to term
	send key "enter" to term
end tell
]],
		ghosttyCommandDelaySeconds,
		toAppleScriptString(pickerCommand)
	)
end

local function runGhosttyTmuxPicker()

	focusApplication(ghosttyAppName)

	local didFocusTerminal, focusError = focusGhosttyTerminal()
	if not didFocusTerminal then
		showError(string.format("Failed to target Ghostty terminal: %s", focusError))
		return
	end

	local didRunCommand, runCommandError = runAppleScript(buildGhosttyTmuxAppleScript())
	if didRunCommand then
		return
	end

	showError(string.format("Failed to run picker in Ghostty: %s", runCommandError))
end

backends.wezterm = runWezTermPicker
backends["ghostty-tmux"] = runGhosttyTmuxPicker

local function openDirectoryPicker()
	backends[activeBackend]()
end

local function start(options)
	options = options or {}

	local backend = options.backend or defaultBackend
	local isSupportedBackend = backend == "wezterm" or backend == "ghostty-tmux"

	if not isSupportedBackend then
		error(string.format("Unsupported nvim picker backend: %s", backend))
	end

	activeBackend = backend

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
