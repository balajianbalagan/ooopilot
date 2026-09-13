/**
 * Checks which OAuth scopes are actually granted to SLACK_BOT_TOKEN.
 *
 * `auth.test` only proves the token is valid — it says nothing about scopes.
 * Slack returns the granted scopes in the `x-oauth-scopes` response header on
 * every API call, so this reads that header directly.
 *
 *   npm run check:scopes
 */
import { config } from "../src/config.js";

const REQUIRED = ["chat:write", "commands", "app_mentions:read", "users:read"];

if (!config.slack.botToken) {
  console.error("SLACK_BOT_TOKEN is not set.");
  process.exit(1);
}

const res = await fetch("https://slack.com/api/auth.test", {
  method: "POST",
  headers: { Authorization: `Bearer ${config.slack.botToken}` },
});
const body = (await res.json()) as { ok: boolean; error?: string; team?: string; user?: string };
const granted = (res.headers.get("x-oauth-scopes") ?? "").split(",").map((s) => s.trim()).filter(Boolean);

if (!body.ok) {
  console.error(`auth.test failed: ${body.error}`);
  process.exit(1);
}

console.log(`Bot: @${body.user} in workspace ${body.team}\n`);
console.log("Granted scopes:", granted.length ? granted.join(", ") : "(none returned)");
console.log("");

let missing = 0;
for (const scope of REQUIRED) {
  const has = granted.includes(scope);
  console.log(`  ${has ? "OK  " : "FAIL"} ${scope}`);
  if (!has) missing++;
}

if (missing > 0) {
  console.log(
    `\n${missing} required scope(s) missing. In api.slack.com/apps → your app → ` +
      "OAuth & Permissions → Bot Token Scopes, add them, then click the " +
      '"reinstall your app" banner that appears (adding a scope alone does nothing ' +
      "until you reinstall).",
  );
  process.exit(1);
}
console.log("\nAll required scopes are granted.");
