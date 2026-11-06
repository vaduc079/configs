-- Rex configuration. Reload with `rex config reload`.

require("vim_navigation")
require("floating")
require("permission_dashboard")

local prefix = "ctrl+a>"
local directions = { h = "left", j = "down", k = "up", l = "right" }

rex.bind(prefix .. "ctrl+a", "pane.send_key", { key = "ctrl+a" })
rex.bind(prefix .. "ctrl+z", "pane.zoom")

rex.bind("alt+backspace", "pane.send_key", { key = "ctrl+w" })
rex.bind("ctrl+enter", "pane.split.auto")
rex.bind("cmd+p", "client.palette.toggle")
rex.unbind("cmd+n")
rex.bind("cmd+n", "session.new")
rex.unbind("cmd+shift+n")
rex.bind("cmd+shift+n", "client.window.new")

for index = 1, 9 do
	rex.bind("ctrl+" .. index, "client.tab.goto", { index = index })
end

-- Resize mode: h/j/k/l or arrows resize, = balances.
rex.mode("resize", { exclusive = true })
rex.bind(prefix .. "r", "client.mode.enter", { name = "resize" })

for key, direction in pairs(directions) do
	for _, resize_key in ipairs({ key, direction }) do
		rex.bind("resize/" .. resize_key, "pane.resize", { direction = direction })
	end
end

rex.bind("resize/=", "pane.balance")

-- Move mode: h/j/k/l or arrows move the focused pane.
rex.mode("move", { exclusive = true })
rex.bind(prefix .. "m", "client.mode.enter", { name = "move" })

for key, direction in pairs(directions) do
	for _, move_key in ipairs({ key, direction }) do
		rex.bind("move/" .. move_key, "pane.move", { direction = direction })
	end
end

-- Popups defined in floating.lua.
rex.bind(prefix .. "ctrl+g", "lazygit")
rex.bind(prefix .. "ctrl+f", "yazi")
