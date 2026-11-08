// Links the packages pi provides to extensions into node_modules, one package at a time, from the
// installed pi release, so tests and tsc use the same versions that load the extensions.
// Link single packages only: linking a whole scope directory lets `npm install` delete through it.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { HOST_PACKAGES } from "../lint/boundaries.ts";

const install = path.join(os.homedir(), ".pi/agent/install");
const version = fs.readFileSync(path.join(install, "current-version"), "utf8").trim();
const release = path.join(install, "releases", version, "node_modules");
const pkg = path.join(import.meta.dirname, "..");
const root = path.join(pkg, "node_modules");
const own = path.join(fs.realpathSync(pkg), "node_modules");

HOST_PACKAGES.forEach((name) => {
  const link = path.join(root, name);
  fs.mkdirSync(path.dirname(link), { recursive: true });
  // rmSync follows a symlinked parent folder, so a parent that leads out of this package would delete inside pi's install.
  const parent = fs.realpathSync(path.dirname(link));
  if (parent !== own && !parent.startsWith(own + path.sep)) {
    throw new Error(`${path.dirname(link)} resolves to ${parent}, outside this package's node_modules; remove the symlink`);
  }
  fs.rmSync(link, { force: true, recursive: true });
  fs.symlinkSync(path.join(release, name), link);
});
console.log(`linked pi ${version}: ${HOST_PACKAGES.join(", ")}`);
