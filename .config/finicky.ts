// ~/.finicky.ts
import type { FinickyConfig } from "/Applications/Finicky.app/Contents/Resources/finicky.d.ts";

export default {
  defaultBrowser: "company.thebrowser.Browser",
  options: {
    hideIcon: true,
  },
  handlers: [
    {
      match: (url) =>
        url.hostname.includes("figma.com") ||
        url.hostname.includes("cursor.com") ||
        url.hostname.includes("mcp.atlassian.com") ||
        url.hostname.includes(".slack.com") ||
        url.hostname.includes("n8n.svc.shopback.com"),
      browser: "com.google.Chrome",
    },
  ],
} satisfies FinickyConfig;
