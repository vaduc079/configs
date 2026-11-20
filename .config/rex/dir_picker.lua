local M = {}

-- exclude: folder-name globs, matched with find's -name (e.g. { "archives", ".*" }).
local function list_dirs(root, exclude)
	local argv = { "find", root, "-mindepth", "1", "-maxdepth", "1", "-type", "d" }
	for _, pattern in ipairs(exclude or {}) do
		table.insert(argv, "!")
		table.insert(argv, "-name")
		table.insert(argv, pattern)
	end
	local result, err = rex.exec(argv)
	if result == nil then
		error(err, 0)
	end
	if not result.ok then
		error(result.stderr, 0)
	end

	local dirs = {}
	for path in result.stdout:gmatch("[^\n]+") do
		table.insert(dirs, path)
	end
	-- Reverse name order, so date-prefixed names such as 2026-11-18-topic come newest first.
	table.sort(dirs, function(a, b)
		return a > b
	end)
	return dirs
end

local default_bounds = { 0.05, 0.05, 0.9, 0.9 }

local function shell_in(dir)
	return rex.layout.block({
		flavor = "com.superlogical.terminal.shell",
		options = { cwd = dir },
	})
end

-- focus = true loses to the palette restoring focus as it closes; queued client
-- actions run after the action returns, once the palette is gone, so the app
-- re-selects the window and takes its focused block from the server.
-- https://discord.com/channels/1546797889009881158/1572841696285298688
local function select_window(ctx, window_id)
	rex.client.queue("session.select", { session_id = ctx.session_id, window_id = window_id })
end

local function open_tab(ctx, dir)
	local window, err = rex.session.new_window({
		layout = shell_in(dir),
	})
	if err then
		error(err, 0)
	end
	select_window(ctx, window.window_id)
end

local function open_float(ctx, dir, bounds)
	local view, view_err = rex.session.view({})
	if view_err then
		error(view_err, 0)
	end
	local _, err = rex.session.new_layer({
		window_id = view.active_window_id,
		bounds = bounds or default_bounds,
		focus = true,
		layout = shell_in(dir),
	})
	if err then
		error(err, 0)
	end
end

local function open_split(ctx, dir)
	local _, err = rex.session.new_split({
		anchor_id = ctx.block_id,
		direction = "horizontal",
		side = "after",
		focus = true,
		layout = shell_in(dir),
	})
	if err then
		error(err, 0)
	end
end

function M.define(opts)
	rex.action({
		name = opts.name,
		title = opts.title,
		run = function(ctx)
			local items = {}
			for _, path in ipairs(list_dirs(opts.root, opts.exclude)) do
				table.insert(items, { id = path, title = path:match("[^/]+$"), subtitle = path, icon = "folder" })
			end

			local dir = rex.ui.pick({
				title = opts.prompt or opts.title,
				placeholder = opts.placeholder or ("Filter " .. opts.root),
				items = items,
			})
			if dir == nil then
				return
			end

			if opts.open == "float" then
				open_float(ctx, dir, opts.bounds)
			elseif opts.open == "split" then
				open_split(ctx, dir)
			else
				open_tab(ctx, dir)
			end
		end,
	})
end

return M
