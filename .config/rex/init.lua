-- Rex configuration. Reload with `rex config reload`.

require("vim_navigation")
require("popups")
require("permission_dashboard")

local prefix = "ctrl+a>"
local directions = { h = "left", j = "down", k = "up", l = "right" }

rex.bind(prefix .. "ctrl+a", "pane.send_key", { key = "ctrl+a" })
rex.bind(prefix .. "ctrl+z", "pane.zoom")

rex.bind("alt+backspace", "pane.send_key", { key = "ctrl+w" })
rex.bind("ctrl+enter", "pane.split.auto")

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

-- Popups defined in popups.lua.
rex.bind(prefix .. "ctrl+g", "lazygit")
rex.bind(prefix .. "ctrl+f", "yazi")
