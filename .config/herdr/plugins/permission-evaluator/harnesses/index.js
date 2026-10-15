// Supported agent harnesses. Add one by writing an adapter with the same shape as claude.js
// (`name`, `promptGuide`, `parseHookInput`) and registering its permission hook to run
// `queue.js enqueue --harness <name>`.

import { claude } from "./claude.js";

export const HARNESSES = { [claude.name]: claude };
