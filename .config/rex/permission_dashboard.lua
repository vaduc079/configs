-- Permission evaluator dashboard (~/configs/tools/permission-evaluator). The dashboard starts a
-- detached server and opens the browser, so these actions return as soon as it is up.

local home = os.getenv("HOME")
local bun = home .. "/.bun/bin/bun"
local evaluator_dir = home .. "/configs/tools/permission-evaluator"

local function define_dashboard_action(name, title, flag)
	rex.action({
		name = name,
		title = title,
		run = function()
			local result, err = rex.exec({ bun, "dashboard.js", flag }, { cwd = evaluator_dir, timeout = 15 })
			if result == nil then
				error(err, 0)
			end
			if not result.ok then
				error(result.stderr ~= "" and result.stderr or result.stdout, 0)
			end
			return { output = result.stdout }
		end,
	})
end

define_dashboard_action("permission_dashboard", "Permission Evaluator Dashboard", "--background")
define_dashboard_action("permission_dashboard_stop", "Stop Permission Evaluator Dashboard", "--stop")
