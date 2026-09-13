/**
 * One-time setup: creates the Phoenix demo issues in your real Jira project.
 *
 *   npm run seed:jira            # create them
 *   npm run seed:jira -- --clean # delete ones this script created earlier
 *
 * This is SETUP tooling, run by you, and is the only code in the repo that
 * writes to Jira. The OOO-Pilot runtime stays strictly read-only — a coworker's
 * phone claim never mutates Jira, it only raises a flagged discrepancy.
 *
 * Jira assigns issue numbers itself, so the created keys will be e.g. KAN-4
 * rather than PHX-121. The created keys are printed at the end.
 */
import { config } from "../src/config.js";

const AUTH =
  "Basic " + Buffer.from(`${config.jira.email}:${config.jira.apiToken}`).toString("base64");
const BASE = config.jira.baseUrl;
const KEY = config.jira.projectKey;
/** Label applied to created issues so sync and cleanup can find them without
 * putting marker text into the summary the voice agent reads aloud. */
const LABEL = "ooo-pilot-demo";

if (!config.jira.enabled) {
  console.error("Jira is not configured in .env (need JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN).");
  process.exit(1);
}

async function api(path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: AUTH,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} on ${path}: ${await res.text()}`);
  return res.status === 204 ? null : res.json().catch(() => null);
}

/** Plain text -> minimal Atlassian Document Format. */
const adf = (text: string) => ({
  type: "doc",
  version: 1,
  content: text.split("\n").map((line) => ({
    type: "paragraph",
    content: line ? [{ type: "text", text: line }] : [],
  })),
});

interface Spec {
  summary: string;
  description: string;
  /** Target status name; the script finds a matching transition. */
  status: "To Do" | "In Progress" | "Done";
  comments: string[];
}

const SPECS: Spec[] = [
  {
    summary: "Android regression testing",
    description:
      "Full regression pass on Android ahead of the launch build. Covers onboarding, checkout and push notifications.",
    status: "In Progress",
    comments: [
      "Regression suite is 78% complete. Three issues still open, including the payment flow defect.",
      "Holding the release branch until the payment flow issue is cleared.",
    ],
  },
  {
    summary: "Payment flow bug on checkout retry",
    description:
      "Retrying a failed card payment occasionally double-charges the customer on Android 13 devices.",
    status: "In Progress",
    comments: [
      "Root cause identified: the retry handler is not idempotent. Fix is in review, expecting to merge tomorrow.",
    ],
  },
  {
    summary: "Security review",
    description: "Pre-launch security review covering the mobile client and the new gateway endpoints.",
    status: "In Progress",
    comments: ["Review is blocked waiting on the updated API threat model from the platform team."],
  },
  {
    summary: "API migration to v2 gateway",
    description:
      "Migrate all mobile clients from the legacy API to the v2 gateway. Includes a staged rollout behind a feature flag.",
    // Must stay In Progress: the demo's discrepancy depends on Jira disagreeing
    // with what Raj reports on the phone.
    status: "In Progress",
    comments: [
      "Migration testing is in progress on staging. Will confirm once the full suite passes.",
    ],
  },
  {
    summary: "Release readiness checklist",
    description:
      "Sign-off checklist covering QA, security, rollback plan and store submission for the Phoenix launch.",
    status: "To Do",
    comments: ["Cannot start sign-off until regression and security review are closed."],
  },
];

async function findDemoIssues(): Promise<Array<{ key: string; summary: string }>> {
  const url = `/rest/api/3/search/jql?jql=${encodeURIComponent(
    `project = ${KEY} AND labels = "${LABEL}" ORDER BY created ASC`,
  )}&fields=summary&maxResults=50`;
  const data = await api(url);
  return (data.issues ?? []).map((i: any) => ({ key: i.key, summary: i.fields.summary }));
}

async function clean(): Promise<void> {
  const existing = await findDemoIssues();
  if (!existing.length) {
    console.log("No demo issues found to clean up.");
    return;
  }
  for (const issue of existing) {
    await api(`/rest/api/3/issue/${issue.key}`, { method: "DELETE" });
    console.log(`  deleted ${issue.key}`);
  }
  console.log(`\nRemoved ${existing.length} demo issue(s).`);
}

async function create(): Promise<void> {
  const existing = await findDemoIssues();
  if (existing.length) {
    console.log(`${existing.length} demo issue(s) already exist:`);
    for (const i of existing) console.log(`  ${i.key}  ${i.summary}`);
    console.log("\nRun with --clean first if you want to recreate them.");
    return;
  }

  // Pick a task-like issue type available in this project.
  const meta = await api(`/rest/api/3/issue/createmeta/${KEY}/issuetypes`);
  const types: Array<{ id: string; name: string; subtask?: boolean }> =
    meta.issueTypes ?? meta.values ?? [];
  const type =
    types.find((t) => t.name === "Task" && !t.subtask) ??
    types.find((t) => t.name === "Story" && !t.subtask) ??
    types.find((t) => !t.subtask);
  if (!type) throw new Error("No usable issue type found in this project.");
  console.log(`Creating ${SPECS.length} issues in ${KEY} as "${type.name}"...\n`);

  const created: Array<{ key: string; summary: string; status: string }> = [];

  for (const spec of SPECS) {
    const issue = await api("/rest/api/3/issue", {
      method: "POST",
      body: JSON.stringify({
        fields: {
          project: { key: KEY },
          issuetype: { id: type.id },
          summary: spec.summary,
          description: adf(spec.description),
          labels: [LABEL],
        },
      }),
    });

    for (const body of spec.comments) {
      await api(`/rest/api/3/issue/${issue.key}/comment`, {
        method: "POST",
        body: JSON.stringify({ body: adf(body) }),
      });
    }

    let status = "To Do";
    if (spec.status !== "To Do") {
      const { transitions } = await api(`/rest/api/3/issue/${issue.key}/transitions`);
      const target = (transitions ?? []).find(
        (t: any) => t.to?.name?.toLowerCase() === spec.status.toLowerCase(),
      );
      if (target) {
        await api(`/rest/api/3/issue/${issue.key}/transitions`, {
          method: "POST",
          body: JSON.stringify({ transition: { id: target.id } }),
        });
        status = spec.status;
      } else {
        console.warn(
          `  ! ${issue.key}: no transition to "${spec.status}" (available: ` +
            `${(transitions ?? []).map((t: any) => t.to?.name).join(", ")}). Left as To Do.`,
        );
      }
    }

    created.push({ key: issue.key, summary: spec.summary, status });
    console.log(`  ${issue.key.padEnd(8)} ${spec.summary.padEnd(36)} ${status}`);
  }

  const migration = created.find((c) => c.summary.startsWith("API migration"));
  console.log(`\nCreated ${created.length} issues in ${KEY}.`);
  if (migration) {
    console.log(
      `\nDemo finale depends on ${migration.key} ("API migration to v2 gateway") staying ` +
        `"${migration.status}".\nOn the call, have Raj say the migration testing is already complete.`,
    );
  }
  console.log("\nNext: npm run sync:jira");
}

await (process.argv.includes("--clean") ? clean() : create());
