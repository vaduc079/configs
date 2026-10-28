-- Popups: run a program in a floating layer over the current tab. The layer closes when
-- the program exits.

local terminal = "com.superlogical.terminal"

-- Reads the directory from the foreground process, since the shell doesn't report
-- OSC 7 to Rex.
local function foreground_cwd(block_id)
	local process = rex.block.call(terminal, "process", { block_id = block_id })
	return process and process.foreground and process.foreground.cwd
end

local function define_popup(name, title, command)
	rex.action({
		name = name,
		title = title,
		run = function(ctx)
			local _, err = rex.session.new_layer({
				session_id = ctx.session_id,
				bounds = { 0.05, 0.05, 0.9, 0.9 },
				focus = true,
				layout = rex.layout.block({
					flavor = "com.superlogical.terminal.shell",
					options = {
						shell = "zsh",
						command = command,
						cwd = foreground_cwd(ctx.block_id),
					},
				}),
			})
			if err then
				error(err, 0)
			end
		end,
	})
end

define_popup("lazygit", "Lazygit", { "env", "MISE_OFFLINE=1", "mise", "exec", "node", "--", "lazygit" })
define_popup("yazi", "Yazi", { "yazi" })
