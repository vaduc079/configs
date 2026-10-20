-- Popups: run a program in a new pane that is zoomed to fill the tab and closes when the
-- program exits. A zoomed pane instead of a floating layer, since Rex doesn't fully
-- support floating layers in the app yet.

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
			local split, err = rex.session.new_split({
				anchor_id = ctx.block_id,
				direction = "vertical",
				side = "after",
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

			local popup_block_id = split.block_ids[1]
			rex.session.zoom_block({ block_id = popup_block_id, zoom = true })
		end,
	})
end

define_popup("lazygit", "Lazygit", { "env", "MISE_OFFLINE=1", "mise", "exec", "node", "--", "lazygit" })
define_popup("yazi", "Yazi", { "yazi" })
