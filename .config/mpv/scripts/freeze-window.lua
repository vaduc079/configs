local windowSizeMode = {
	DEFAULT = "default",
	FREEZE = "freeze",
	UNFREEZE = "unfreeze",
}
local enabledMode = { windowSizeMode.FREEZE, windowSizeMode.DEFAULT, windowSizeMode.UNFREEZE }
local currentMode = 1

local function show_osd_msg(width, height)
	local message
	if width and height then
		message = string.format("Window mode: %s (%dx%d)", enabledMode[currentMode], width, height)
	else
		message = "Window mode: " .. enabledMode[currentMode]
	end
	mp.osd_message(message)
end

local function set_geometry(width, height)
	local geometry_value = width and height and string.format("%dx%d", width, height) or ""
	mp.set_property("geometry", geometry_value)
end

local function freeze_current_size()
	local ww, wh = mp.get_osd_size()
	set_geometry(ww, wh)
	show_osd_msg(ww, wh)
end

local function freeze_default_size(width, height)
	width = width or 1600
	height = height or 900
	set_geometry(width, height)
	show_osd_msg(width, height)
end

local function unfreeze_size()
	set_geometry()
	show_osd_msg()
end

local function frezze_window()
	local mode = enabledMode[currentMode]
	if mode == windowSizeMode.DEFAULT then
		freeze_default_size()
	elseif mode == windowSizeMode.FREEZE then
		freeze_current_size()
	elseif mode == windowSizeMode.UNFREEZE then
		unfreeze_size()
	end

	currentMode = currentMode < #enabledMode and currentMode + 1 or 1
end

mp.add_key_binding("ctrl+d", "frezze_window", frezze_window)
