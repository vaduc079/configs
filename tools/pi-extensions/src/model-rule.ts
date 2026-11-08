// Per-model rules in extension configs: `{ "model": "anthropic/claude-*", ... }`, first match wins.

/** `provider/id`, the form a rule's `model` glob matches. */
export function modelRef(model: { provider: string; id: string }) {
  return `${model.provider}/${model.id}`;
}

/** The first rule whose `model` glob matches `ref`. In the glob, `*` matches any run of characters. */
export function findModelRule<Rule extends { model: string }>(rules: readonly Rule[], ref: string) {
  return rules.find((rule) => globToRegExp(rule.model).test(ref));
}

function globToRegExp(glob: string) {
  const pattern = glob.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  return new RegExp(`^${pattern}$`);
}
