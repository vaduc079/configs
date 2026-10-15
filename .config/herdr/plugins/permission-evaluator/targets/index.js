// Supported multiplexer targets. Add one by writing a driver with the same shape as herdr.js
// and registering it here; `fromEnvironment` decides whether a hook is running inside it.

import { herdr } from "./herdr.js";

export const TARGETS = { [herdr.type]: herdr };

export function detectTarget(env) {
  for (const driver of Object.values(TARGETS)) {
    const target = driver.fromEnvironment(env);
    if (target) return { driver, target };
  }
  return null;
}
