// Oxlint JS plugin `local`: the rules oxlint has no built-in for. Each one encodes a principle; see AGENTS.md.
import { type Context, definePlugin, defineRule, type ESTree } from "@oxlint/plugins";
import { importProblem } from "./boundaries.ts";

const boundaries = defineRule({
  meta: { type: "problem", docs: { description: "Extensions import their own folder, src/, and packages; src/ never imports an extension." } },
  create(context: Context) {
    const check = (node: ESTree.Node, source: unknown) => {
      if (typeof source !== "string") return;
      const problem = importProblem(context.filename, source);
      if (problem) context.report({ node, message: problem });
    };
    return {
      ImportDeclaration: (node) => check(node, node.source.value),
      ExportNamedDeclaration: (node) => check(node, node.source?.value),
      ExportAllDeclaration: (node) => check(node, node.source.value),
      ImportExpression: (node) => check(node, node.source.type === "Literal" ? node.source.value : undefined),
    };
  },
});

const noExtends = defineRule({
  meta: { type: "suggestion", docs: { description: "Prefer composition over inheritance." } },
  create(context: Context) {
    const message = "Prefer composition over inheritance (duc-principle-write-code): hold the other object as a field, use functions, or implement an interface.";
    const check = (node: ESTree.Class) => {
      if (node.superClass) context.report({ node, message });
    };
    return { ClassDeclaration: check, ClassExpression: check };
  },
});

// Rules correct code almost never breaks. A disable here teaches the next agent to copy it, so none is allowed.
const undisableable = ["boundaries", "disable-reason", "no-explicit-any", "no-unsafe-argument", "no-unsafe-assignment", "no-unsafe-call", "no-unsafe-member-access", "no-unsafe-return"];

/** The problem with a lint-directive comment, or undefined when the comment is fine. `commentText` is the comment without its comment markers. */
export function directiveProblem(commentText: string): string | undefined {
  const text = commentText.trim();
  // oxlint ignores eslint directives here (respectEslintDisableDirectives: false), so one would silently do nothing.
  if (text.startsWith("eslint-disable")) return "Use `oxlint-disable`; eslint directives are ignored.";
  const directive = /^oxlint-(disable|enable)(-next-line|-line)?(\s|$)/.exec(text);
  if (!directive) return undefined;
  const [rulesText = "", reason = ""] = text.replace(/^\S+\s*/, "").split(/(?:^|\s)--(?:\s+|$)(.*)/s);
  const names = rulesText.split(/[\s,]+/).filter(Boolean).map((name) => name.split("/").pop());
  const protectedRule = undisableable.find((rule) => names.includes(rule));
  if (protectedRule) return `${protectedRule} cannot be disabled: fix the code (AGENTS.md).`;
  // A file-wide disable is the spam pattern; each exception sits on the line it excuses.
  if (!directive[2]) return "Disable one line only: `// oxlint-disable-next-line <rule> -- <why>`.";
  if (directive[1] === "disable" && (names.length === 0 || !reason.trim())) {
    return "Name the rule and give the reason: `// oxlint-disable-next-line <rule> -- <why>`.";
  }
  return undefined;
}

const disableReason = defineRule({
  meta: { type: "suggestion", docs: { description: "Every lint disable is an oxlint directive that names the rule and says why after ` -- `; some rules cannot be disabled." } },
  create(context: Context) {
    return {
      Program() {
        context.sourceCode.getAllComments().forEach((comment) => {
          const message = directiveProblem(comment.value);
          if (message) context.report({ loc: comment.loc, message });
        });
      },
    };
  },
});

export default definePlugin({
  meta: { name: "local" },
  rules: {
    boundaries,
    "disable-reason": disableReason,
    "no-extends": noExtends,
  },
});
