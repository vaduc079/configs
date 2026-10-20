-- Vim-aware navigation: Ctrl+h/j/k/l passes through to programs that navigate
-- their own splits (Neovim falls back to `rex focus` at its edge), otherwise
-- focuses the adjacent Rex pane. Mirrors herdr's smart-pane-navigation.

local terminal = "com.superlogical.terminal"
local directions = { h = "left", j = "down", k = "up", l = "right" }

-- Programs that use Ctrl+h/j/k/l themselves, so Rex must not take those keys from them.
local passthrough_programs = {
	vim = true,
	nvim = true,
	view = true,
	vimdiff = true,
	nvimdiff = true,
	fzf = true,
	lumen = true,
	lazygit = true,
	herdr = true,
}

-- Reduces a process name to the bare program name: "/usr/bin/nvim" -> "nvim",
-- "-zsh" (login shell) -> "zsh", ".nvim-wrapped" (Nix wrapper) -> "nvim".
local function program_name(name)
	local basename = (name or ""):match("([^/]+)$") or ""
	return (basename:gsub("^%-", ""):gsub("^%.", ""):gsub("%-wrapped$", ""))
end

-- `name` is the executable's file name, which is a version number for some installs,
-- so `argv0` is checked as well.
local function is_passthrough_program(block_id)
	local process = rex.block.call(terminal, "process", { block_id = block_id })
	if process == nil or process.foreground == nil then
		return false
	end

	local foreground = process.foreground
	return passthrough_programs[program_name(foreground.name)] == true
		or passthrough_programs[program_name(foreground.argv0)] == true
end

for key, direction in pairs(directions) do
	rex.bind("ctrl+" .. key, function(ctx)
		if is_passthrough_program(ctx.block_id) then
			return false
		end

		rex.session.focus_direction({ direction = direction })
		return true
	end)
end
