// ~/.finicky.ts
import type { FinickyConfig } from "/Applications/Finicky.app/Contents/Resources/finicky.d.ts";

export default {
  defaultBrowser: "company.thebrowser.Browser",
  // defaultBrowser: "com.google.Chrome",
  options: {
    hideIcon: true,
  },
  handlers: [
    {
      match: (url) =>
        url.hostname.includes("figma.com") ||
        url.hostname.includes("cursor.com") ||
        url.hostname.includes(".openai.com") ||
        url.hostname.includes("mcp.atlassian.com") ||
        url.hostname.includes("https://slack.com") ||
        url.hostname.includes(".slack.com") ||
        // url.hostname.includes("console.jumpcloud.com") ||
        url.hostname.includes(".zscaler.com") ||
        url.hostname.includes("n8n.svc.shopback.com"),
      browser: "com.google.Chrome",
    },
  ],
} satisfies FinickyConfig;
