-- Rex configuration. Reload with `rex config reload`.

require("vim_navigation")
require("floating")
require("permission_dashboard")
local dir_picker = require("dir_picker")

local prefix = "ctrl+a>"
local directions = { h = "left", j = "down", k = "up", l = "right" }

rex.bind(prefix .. "ctrl+a", "pane.send_key", { key = "ctrl+a" })
rex.bind(prefix .. "ctrl+z", "pane.zoom")

rex.bind("alt+backspace", "pane.send_key", { key = "ctrl+w" })
rex.bind("cmd+p", "client.palette.toggle")
rex.unbind("cmd+n")
rex.bind("cmd+n", "session.new")
rex.unbind("cmd+shift+n")
rex.bind("cmd+shift+n", "client.window.new")

-- ctrl stuffs
-- rex.bind("ctrl+enter", "pane.split.auto")
-- for index = 1, 9 do
-- 	rex.bind("ctrl+" .. index, "client.tab.goto", { index = index })
-- end

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

-- Resume pi after a server restart; the osc7577 pi extension reports `pi --session <file>`.
-- Under ~ rather than ~/.pi/agent/sessions: ~/.pi is a symlink, and Rex re-checks the path after
-- resolving it.
rex.set("resume.trust.pi", {
	command = { "pi", "--session", rex.match.under("~") },
})

-- Machine-specific values (gitignored machine.lua); features that need one are skipped when it's missing.
local ok, machine = pcall(require, "machine")
if not ok then
	machine = {}
end

if machine.workspace_root then
	dir_picker.define({
		name = "open_workspace",
		title = "Open Workspace",
		root = machine.workspace_root,
		prompt = "Open workspace",
		placeholder = "Filter workspaces",
		open = "split",
		exclude = { "archives" },
	})
end
