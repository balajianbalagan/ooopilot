import "dotenv/config";

function opt(name: string, fallback = ""): string {
  return process.env[name]?.trim() || fallback;
}

export const config = {
  port: Number(opt("PORT", "3000")),

  slack: {
    botToken: opt("SLACK_BOT_TOKEN"),
    appToken: opt("SLACK_APP_TOKEN"),
    signingSecret: opt("SLACK_SIGNING_SECRET"),
    get enabled() {
      return Boolean(this.botToken && this.appToken);
    },
  },

  jira: {
    baseUrl: opt("JIRA_BASE_URL").replace(/\/+$/, ""),
    email: opt("JIRA_EMAIL"),
    apiToken: opt("JIRA_API_TOKEN"),
    projectKey: opt("JIRA_PROJECT_KEY", "PHX"),
    // Optional JQL override to scope the sync (e.g. exclude unrelated issues).
    jql: opt("JIRA_JQL"),
    get enabled() {
      return Boolean(this.baseUrl && this.email && this.apiToken);
    },
  },

  calle: {
    apiKey: opt("CALLE_API_KEY"),
    baseUrl: opt("CALLE_BASE_URL", "https://api.heycall-e.com"),
    webhookUrl: opt("CALLE_WEBHOOK_URL"),
    dryRun: opt("CALLE_DRY_RUN", "false").toLowerCase() === "true",
    // Optional overrides; otherwise derived from the number's country code.
    region: opt("CALLE_REGION"),
    locale: opt("CALLE_LOCALE"),
    get enabled() {
      return Boolean(this.apiKey);
    },
  },

  llm: {
    // OPENAI_API_KEY is accepted as an alias so either name works.
    apiKey: opt("LLM_API_KEY") || opt("OPENAI_API_KEY"),
    model: opt("LLM_MODEL", "gpt-4o-mini"),
    get enabled() {
      return Boolean(this.apiKey);
    },
  },

  phones: {
    arun: opt("ARUN_PHONE"),
    raj: opt("RAJ_PHONE"),
  },

  dbPath: "data/ooo.sqlite",
} as const;

/** Human-readable startup report so the demo never fails silently on a missing key. */
export function describeConfig(): string {
  const row = (label: string, ok: boolean, note = "") =>
    `  ${ok ? "OK  " : "--  "} ${label.padEnd(10)} ${note}`;
  return [
    row("slack", config.slack.enabled, config.slack.enabled ? "socket mode" : "set SLACK_BOT_TOKEN + SLACK_APP_TOKEN"),
    row("jira", config.jira.enabled, config.jira.enabled ? config.jira.baseUrl : "using seeded demo data only"),
    row("calle", config.calle.enabled, config.calle.dryRun ? "DRY RUN (no real calls)" : config.calle.baseUrl),
    row("llm", config.llm.enabled, config.llm.enabled ? config.llm.model : "falling back to rule-based extraction"),
  ].join("\n");
}
