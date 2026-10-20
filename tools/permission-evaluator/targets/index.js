// Supported multiplexer targets. Add one by writing a driver with the same shape as herdr.js
// and registering it here; `fromEnvironment` decides whether a hook is running inside it.

import { herdr } from "./herdr.js";
import { rex } from "./rex.js";

// Detection follows this order. Herdr comes first: a Herdr pane inside a Rex block sees both
// environments, and the agent runs in the pane.
export const TARGETS = { [herdr.type]: herdr, [rex.type]: rex };

export function detectTarget(env) {
  for (const driver of Object.values(TARGETS)) {
    const target = driver.fromEnvironment(env);
    if (target) return { driver, target };
  }
  return null;
}
