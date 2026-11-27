-- Resume rules: programs Rex may restart after a server restart. Each program reports its own
-- resume command with OSC 7577; a rule here decides whether Rex trusts it.

-- pi: reported by pi itself (1.7.0+) as `pi --session <id>`. Each flag combination pi is
-- started with (-t, --no-extensions, -e, ...) needs its own rule; see pi docs/terminal-setup.md.
rex.set("resume.trust.pi", {
	command = { "pi", "--session", rex.match.uuid },
})

-- Neovim: reported by lua/config/osc7577.lua in the nvim config.
rex.set("resume.trust.nvim", {
	command = { "nvim", "-S", rex.match.under("~/.local/state/nvim/osc7577-sessions") },
})
