-- Resume rules: programs Rex may restart after a server restart. Each program reports its own
-- resume command with OSC 7577; a rule here decides whether Rex trusts it.

-- pi: reported by the osc7577 pi extension (tools/pi-extensions).
rex.set("resume.trust.pi", {
	command = { "pi", "--session", rex.match.under("~/.pi/agent/sessions") },
})

-- Neovim: reported by lua/config/osc7577.lua in the nvim config.
rex.set("resume.trust.nvim", {
	command = { "nvim", "-S", rex.match.under("~/.local/state/nvim/osc7577-sessions") },
})
