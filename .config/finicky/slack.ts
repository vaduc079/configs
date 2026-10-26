// Open Slack links in the Slack app.
// Based on https://github.com/johnste/finicky/wiki/Configuration-ideas#open-slack-link-in-slack-app
// Rewrites https://<workspace>.slack.com/... to slack://<kind>?team=...&id=... and
// opens slack: URLs in the Slack app. Links it can't convert fall through to later handlers.
import { slackTeams } from "./shopback";

const isSlackWebUrl = (url: URL) =>
  url.hostname === "slack.com" || url.hostname.endsWith(".slack.com");

// Each pattern captures [team?, id, message?] in that order; `hasTeam` says whether
// the first group is the team (app.slack.com) or absent (workspace subdomain).
type Pattern = { kind: string; regex: RegExp; hasTeam: boolean; hasMessage: boolean };

const workspacePatterns: Pattern[] = [
  { kind: "file", regex: /\/messages\/\w+\/files\/(\w+)/, hasTeam: false, hasMessage: false },
  { kind: "team", regex: /(?:\/messages\/\w+)?\/team\/(\w+)/, hasTeam: false, hasMessage: false },
  { kind: "channel", regex: /\/(?:messages|archives)\/(\w+)(?:\/(p\d+))?/, hasTeam: false, hasMessage: true },
];

const appPatterns: Pattern[] = [
  { kind: "file", regex: /\/client\/(\w+)\/\w+\/files\/(\w+)/, hasTeam: true, hasMessage: false },
  { kind: "file", regex: /\/docs\/(\w+)\/(\w+)/, hasTeam: true, hasMessage: false },
  { kind: "team", regex: /\/client\/(\w+)\/\w+\/user_profile\/(\w+)/, hasTeam: true, hasMessage: false },
  { kind: "channel", regex: /\/client\/(\w+)\/(\w+)(?:\/([\d.]+))?/, hasTeam: true, hasMessage: true },
];

// p1791886262718759 -> 1791886262.718759
const toTimestamp = (message: string) =>
  message.charAt(0) === "p" ? message.slice(1, 11) + "." + message.slice(11) : message;

const toDeepLink = (url: URL): string | undefined => {
  const subdomain = url.hostname.slice(0, -".slack.com".length);
  const isApp = subdomain === "app";
  const workspaceTeam = slackTeams[subdomain];
  if (!isApp && !workspaceTeam) return undefined;

  for (const { kind, regex, hasTeam, hasMessage } of isApp ? appPatterns : workspacePatterns) {
    const match = regex.exec(url.pathname);
    if (!match) continue;

    const team = hasTeam ? match[1] : workspaceTeam;
    const id = hasTeam ? match[2] : match[1];
    const message = hasMessage ? match[hasTeam ? 3 : 2] : undefined;

    let deepLink = "slack://" + kind + "?team=" + team + "&id=" + id;
    if (message) deepLink += "&message=" + toTimestamp(message);
    return deepLink;
  }
  return undefined;
};

export const slackRewriter = {
  match: isSlackWebUrl,
  url: (url: URL) => toDeepLink(url) ?? url.href,
};

export const slackHandler = {
  match: (url: URL) => url.protocol === "slack:",
  browser: "Slack",
};
