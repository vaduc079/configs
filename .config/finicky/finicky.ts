// ~/.config/finicky/finicky.ts
// `finicky` is a global declared by finicky.d.ts; the type import below is what makes it available.
import type { FinickyConfig } from "/Applications/Finicky.app/Contents/Resources/finicky.d.ts";
import {
  shopbackChromeHostnames,
  shopbackHostnames,
  shopbackUrlParts,
} from "./shopback";
import { slackHandler, slackRewriter } from "./slack";

const heliumShopBack = { name: "Helium", profile: "ShopBack" };
const heliumDic = { name: "Helium", profile: "Dic" };

// finicky.matchHostnames compares strings exactly, so "*.example.com" never matches.
// "*.example.com" here matches example.com and any subdomain of it.
const hosts = (patterns: string[]) => (url: URL) =>
  patterns.some((pattern) =>
    pattern.startsWith("*.")
      ? url.hostname === pattern.slice(2) || url.hostname.endsWith(pattern.slice(1))
      : url.hostname === pattern,
  );

const contains =
  (...parts: string[]) =>
    (url: URL) =>
      parts.some((part) => url.href.includes(part));

export default {
  defaultBrowser: heliumShopBack,
  options: {
    hideIcon: true,
    logRequests: false,
  },
  rewrite: [
    {
      // Unwrap https://www.google.com/url?q=<target> so handlers see the real URL
      match: (url) =>
        url.href.startsWith("https://www.google.com/url?") &&
        url.searchParams.has("q"),
      url: (url) => new URL(url.searchParams.get("q")!),
    },
    slackRewriter,
  ],
  handlers: [
    slackHandler,
    {
      match: hosts([
        "figma.com",
        "*.figma.com",
        "cursor.com",
        "*.cursor.com",
        "claude.ai",
        "*.claude.ai",
        "claude.com",
        "*.claude.com",
        "mcp.atlassian.com",
        "slack.com",
        "*.slack.com",
        "*.replit.app",
        "*.zscaler.com",
        "api.anthropic.com",
        "auth.openai.com",
        ...shopbackChromeHostnames,
      ]),
      browser: "com.google.Chrome",
    },
    {
      match: [
        hosts([
          "youtube.com",
          "*.youtube.com",
          "shopee.vn",
          "*.shopee.vn",
          "x.com",
          "tailscale.com",
          "*.tailscale.com"
        ]),
        contains("google.com/maps"),
      ],
      browser: heliumDic,
    },
    {
      match: [
        hosts(shopbackHostnames),
        contains(...shopbackUrlParts),
      ],
      browser: heliumShopBack,
    },
  ],
} satisfies FinickyConfig;
