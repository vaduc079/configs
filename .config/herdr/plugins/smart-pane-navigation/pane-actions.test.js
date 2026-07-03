import { describe, expect, test } from "bun:test";

import {
  cellHeightWidthRatio,
  processControlsNavigation,
  splitDirection,
} from "./pane-actions.js";

describe("splitDirection", () => {
  test("splits a visually tall pane downward", () => {
    expect(splitDirection(80, 50, 2)).toBe("down");
  });

  test("splits a visually wide pane to the right", () => {
    expect(splitDirection(120, 40, 2)).toBe("right");
  });
});

describe("cellHeightWidthRatio", () => {
  test("uses two when no override is configured", () => {
    expect(cellHeightWidthRatio()).toBe(2);
  });

  test("accepts a positive numeric override", () => {
    expect(cellHeightWidthRatio("1.75")).toBe(1.75);
  });

  test("rejects invalid overrides", () => {
    expect(() => cellHeightWidthRatio("wide")).toThrow();
    expect(() => cellHeightWidthRatio("0")).toThrow();
  });
});

describe("processControlsNavigation", () => {
  test("recognizes Vim-family and interactive picker processes", () => {
    for (const name of ["vim", "nvim", "nvimdiff", "fzf", "lumen"]) {
      expect(processControlsNavigation([{ name }])).toBeTrue();
    }
  });

  test("ignores unrelated foreground processes", () => {
    expect(processControlsNavigation([{ name: "zsh" }, { name: "codex" }])).toBeFalse();
  });
});
