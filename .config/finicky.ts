// ~/.finicky.ts
import type { FinickyConfig } from "/Applications/Finicky.app/Contents/Resources/finicky.d.ts";

function shouldRedirectToChrome(hostname: string): boolean {
  return (
    hostname.includes("figma.com") ||
    hostname.includes("cursor.com") ||
    hostname.includes("claude.ai") ||
    hostname.includes("mcp.atlassian.com") ||
    hostname.includes("https://slack.com") ||
    hostname.includes(".slack.com") ||
    hostname.includes("shopback.slack.com") ||
    hostname.includes(".replit.app") ||
    // hostname.includes("console.jumpcloud.com") ||
    hostname.includes(".zscaler.com") ||
    hostname.includes("n8n.svc.shopback.com")
  );
}

export default {
  defaultBrowser: "company.thebrowser.Browser",
  // defaultBrowser: "com.google.Chrome",
  options: {
    hideIcon: true,
  },
  handlers: [
    {
      match: (url) => {
        const isGoogleRedirect = url.href.startsWith(
          "https://www.google.com/url?q=",
        );
        if (isGoogleRedirect) {
          const redirectUrlStr = url.searchParams.get("q");
          if (!redirectUrlStr) return false;

          const redirectURL = new URL(redirectUrlStr);
          return shouldRedirectToChrome(redirectURL.hostname);
        }

        return shouldRedirectToChrome(url.hostname);
      },
      browser: "com.google.Chrome",
    },
  ],
} satisfies FinickyConfig;
