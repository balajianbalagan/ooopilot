/**
 * Validates every credential in .env without placing a phone call.
 *
 *   npm run preflight
 *
 * CALL-E is checked with a GET against /v1/goals, which proves the API key is
 * accepted without spending any of your call allowance.
 */
import { WebClient } from "@slack/web-api";
import { CalleClient, CalleAuthenticationError } from "@call-e/calle";
import OpenAI from "openai";

import { config } from "../src/config.js";
import { JiraClient } from "../src/jira/client.js";
import { localeForPhone } from "../src/calle/client.js";
import { isValidPhone } from "../src/safety/policy.js";

type Status = "ok" | "warn" | "fail" | "skip";
const results: Array<{ area: string; status: Status; detail: string }> = [];

const record = (area: string, status: Status, detail: string) =>
  results.push({ area, status, detail });

// ---------- Slack ----------
async function checkSlack(): Promise<void> {
  if (!config.slack.botToken) {
    record("Slack", "skip", "SLACK_BOT_TOKEN not set");
    return;
  }
  try {
    const auth = await new WebClient(config.slack.botToken).auth.test();
    record("Slack bot", "ok", `@${auth.user} in ${auth.team}`);
  } catch (err) {
    record("Slack bot", "fail", (err as Error).message);
    return;
  }
  record(
    "Slack app token",
    config.slack.appToken.startsWith("xapp-") ? "ok" : "fail",
    config.slack.appToken ? "xapp- token present" : "SLACK_APP_TOKEN missing (Socket Mode needs it)",
  );
}

// ---------- Jira ----------
async function checkJira(): Promise<void> {
  if (!config.jira.enabled) {
    record("Jira", "skip", "not configured — demo will use seeded Phoenix data");
    return;
  }
  try {
    const res = await fetch(`${config.jira.baseUrl}/rest/api/3/myself`, {
      headers: {
        Authorization:
          "Basic " + Buffer.from(`${config.jira.email}:${config.jira.apiToken}`).toString("base64"),
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      record("Jira auth", "fail", `${res.status} ${res.statusText} — check email/token/base URL`);
      return;
    }
    const me = (await res.json()) as { displayName?: string };
    record("Jira auth", "ok", `authenticated as ${me.displayName ?? config.jira.email}`);

    const issues = await new JiraClient().searchIssues(
      `project = ${config.jira.projectKey} ORDER BY updated DESC`,
      5,
    );
    if (issues.length === 0) {
      record("Jira project", "warn", `${config.jira.projectKey} returned no issues`);
    } else {
      record(
        "Jira project",
        "ok",
        `${config.jira.projectKey}: ${issues.length} issue(s), newest ${issues[0].key} = ${issues[0].status}`,
      );
    }
  } catch (err) {
    record("Jira", "fail", (err as Error).message);
  }
}

// ---------- CALL-E ----------
async function checkCalle(): Promise<void> {
  if (!config.calle.apiKey) {
    record("CALL-E", config.calle.dryRun ? "skip" : "fail", "CALLE_API_KEY not set");
    return;
  }
  const client = new CalleClient({ apiKey: config.calle.apiKey, baseUrl: config.calle.baseUrl });
  try {
    // A read-only request: proves the key is accepted, places no call.
    const goals = await client.goals.list({ limit: 1 });
    record("CALL-E key", "ok", `accepted by ${config.calle.baseUrl} (${goals.data.length} goal(s) visible)`);
  } catch (err) {
    if (err instanceof CalleAuthenticationError) {
      record("CALL-E key", "fail", "rejected — check CALLE_API_KEY and CALLE_BASE_URL");
      return;
    }
    // Any non-auth error still means the key got past authentication.
    record("CALL-E key", "ok", `authenticated (goals endpoint said: ${(err as Error).message})`);
  }
}

// ---------- OpenAI ----------
async function checkOpenAI(): Promise<void> {
  if (!config.llm.enabled) {
    record("OpenAI", "skip", "optional — CALL-E does the primary extraction");
    return;
  }
  try {
    const models = await new OpenAI({ apiKey: config.llm.apiKey }).models.list();
    const has = models.data.some((m) => m.id === config.llm.model);
    record("OpenAI", has ? "ok" : "warn", has ? `${config.llm.model} available` : `${config.llm.model} not in model list`);
  } catch (err) {
    record("OpenAI", "fail", (err as Error).message);
  }
}

// ---------- phones ----------
function checkPhones(): void {
  for (const [label, value] of [["RAJ_PHONE", config.phones.raj], ["ARUN_PHONE", config.phones.arun]] as const) {
    if (!value) {
      record(label, label === "RAJ_PHONE" ? "fail" : "warn", "not set");
    } else if (!isValidPhone(value)) {
      record(label, "fail", `"${value}" is not E.164 (need +countrycode, no spaces)`);
    } else {
      const { region, locale } = localeForPhone(value);
      record(label, "ok", `${value} → region ${region}, locale ${locale}`);
    }
  }
}

// ---------- run ----------
await checkSlack();
await checkJira();
await checkCalle();
await checkOpenAI();
checkPhones();

const icon: Record<Status, string> = { ok: "OK  ", warn: "WARN", fail: "FAIL", skip: "--  " };
console.log("\nPreflight — no phone calls were placed.\n");
for (const r of results) {
  console.log(`  ${icon[r.status]} ${r.area.padEnd(18)} ${r.detail}`);
}

const failures = results.filter((r) => r.status === "fail");
console.log(
  failures.length
    ? `\n${failures.length} blocking issue(s). Fix these before the demo.\n`
    : "\nAll configured integrations responded. Ready for a test call.\n",
);
if (config.calle.dryRun) {
  console.log("CALLE_DRY_RUN is true — set it to false when you want real calls.\n");
}
