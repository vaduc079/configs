-- Vim-aware navigation: Ctrl+h/j/k/l (or Ctrl+arrows) passes through to programs that navigate
-- their own splits (Neovim falls back to `rex focus` at its edge), otherwise
-- focuses the adjacent Rex pane. Mirrors herdr's smart-pane-navigation.

local terminal = "com.superlogical.terminal"
local direction_keys = {
	left = { "ctrl+h", "ctrl+left" },
	down = { "ctrl+j", "ctrl+down" },
	up = { "ctrl+k", "ctrl+up" },
	right = { "ctrl+l", "ctrl+right" },
}

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

-- Returning false lets the key through to the program.
local function navigate(direction)
	return function(ctx)
		if is_passthrough_program(ctx.block_id) then
			return false
		end

		rex.session.focus_direction({ direction = direction })
		return true
	end
end

for direction, keys in pairs(direction_keys) do
	for _, key in ipairs(keys) do
		rex.bind(key, navigate(direction))
	end
end
