// Shared contract between rules.ts, classify.ts, shell/commands.ts, and index.ts.

export type Effect = "allow" | "ask" | "deny";

/**
 * One rule from permissions.json. OpenCode format; `reason` is shown to the model on deny.
 * `input` (allow rules only): the rule matches only when every named tool-input field is a string matching one of its patterns.
 */
export interface Rule {
  action: string;
  resource: string;
  effect: Effect;
  reason?: string;
  input?: Record<string, string[]>;
}

/**
 * One question asked of the rules for a tool call.
 * Every resource is evaluated on its own; the strictest result wins.
 * `denyOnly`: only a deny result counts; ask and allow results of this check are ignored.
 * Used for path-like words found in shell commands.
 */
export interface Check {
  action: string;
  resources: string[];
  denyOnly?: boolean;
}

/** Result of evaluating all checks of one tool call. On allow, `rule`, `check`, `resource` are unset. */
export interface Decision {
  effect: Effect;
  /** The rule that produced a deny or ask (a synthetic `{action, resource: "*", effect: "ask"}` when nothing matched). */
  rule?: Rule;
  check?: Check;
  resource?: string;
}

/** What classify needs to know about where pi runs. All paths absolute, no trailing slash. */
export interface Location {
  cwd: string;
  /** Git top-level of cwd, if any. Paths under cwd or root are "inside". */
  root?: string;
  home: string;
}

/** Output of shell/commands.ts for one bash command string. */
export interface ShellParse {
  /** Each simple command as text, e.g. "glab mr approve 1". The raw command alone when the scanner cannot read it. */
  commands: string[];
  /** `cd`/`pushd`/`chdir` targets, as written (may start with ~ or be relative). */
  directories: string[];
  /**
   * Words that may name files: from scanned commands only (never heredoc bodies or an unreadable command),
   * no whitespace inside, not starting with "-"; for "--opt=value" the value. Includes redirect targets.
   * As written (may start with ~ or be relative). Checked against read and edit rules.
   */
  pathWords: string[];
  /**
   * Same kind of words, but only read: arguments and `<` targets in a line where every command is a known
   * read-only command (`ls`, `cat`, `rg`, ...) run as written. Checked against read rules only.
   */
  readPathWords: string[];
}
