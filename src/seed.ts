/**
 * Seeds the fictional Phoenix Mobile App Launch project.
 *
 * Timestamps are relative to "now" so the demo always looks fresh.
 * Note PHX-121: Jira says API migration testing is still in progress. During
 * the demo call Raj reports it is actually complete — that mismatch is what
 * the return-from-OOO discrepancy report surfaces.
 */
import { config } from "./config.js";
import { db, nowIso } from "./knowledge/sqlite.js";
import { upsertKnowledgeItem } from "./knowledge/repository.js";
import type { JiraIssue } from "./jira/client.js";
import { ingestIssue } from "./jira/sync.js";

const EMPLOYEE_ID = "arun";
const PROJECT_ID = "phoenix";

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

const JIRA_BASE = config.jira.baseUrl || "https://example.atlassian.net";
const browse = (key: string) => `${JIRA_BASE}/browse/${key}`;

export const DEMO_ISSUES: JiraIssue[] = [
  {
    key: "PHX-101",
    summary: "Android regression testing",
    description:
      "Full regression pass on Android ahead of the launch build. Covers onboarding, checkout and push notifications.",
    status: "In Progress",
    assignee: "Priya Menon",
    priority: "High",
    updated: hoursAgo(6),
    url: browse("PHX-101"),
    comments: [
      {
        id: "1001",
        author: "Priya Menon",
        body: "Regression suite is 78% complete. Three issues still open, including the payment flow defect tracked in PHX-108.",
        created: hoursAgo(6),
      },
      {
        id: "1002",
        author: "Arun",
        body: "Let's hold the release branch until the payment flow issue is cleared.",
        created: hoursAgo(30),
      },
    ],
  },
  {
    key: "PHX-108",
    summary: "Payment flow bug on checkout retry",
    description:
      "Retrying a failed card payment occasionally double-charges the customer on Android 13 devices.",
    status: "In Progress",
    assignee: "Karthik Rao",
    priority: "Highest",
    updated: hoursAgo(9),
    url: browse("PHX-108"),
    comments: [
      {
        id: "1003",
        author: "Karthik Rao",
        body: "Root cause identified: the retry handler is not idempotent. Fix is in review, expecting to merge tomorrow.",
        created: hoursAgo(9),
      },
    ],
  },
  {
    key: "PHX-115",
    summary: "Security review",
    description: "Pre-launch security review covering the mobile client and the new gateway endpoints.",
    status: "In Progress",
    assignee: "Security Guild",
    priority: "High",
    updated: hoursAgo(20),
    url: browse("PHX-115"),
    comments: [
      {
        id: "1004",
        author: "Divya Nair",
        body: "Review is blocked waiting on the updated API threat model from the platform team.",
        created: hoursAgo(20),
      },
    ],
  },
  {
    key: "PHX-121",
    summary: "API migration to v2 gateway",
    description:
      "Migrate all mobile clients from the legacy API to the v2 gateway. Includes a staged rollout behind a feature flag.",
    status: "In Progress",
    assignee: "Karthik Rao",
    priority: "High",
    updated: hoursAgo(28),
    url: browse("PHX-121"),
    comments: [
      {
        id: "1005",
        author: "Karthik Rao",
        body: "Migration testing is in progress on staging. Will confirm once the full suite passes.",
        created: hoursAgo(28),
      },
    ],
  },
  {
    key: "PHX-130",
    summary: "Release readiness checklist",
    description:
      "Sign-off checklist covering QA, security, rollback plan and store submission for the Phoenix launch.",
    status: "To Do",
    assignee: "Arun",
    priority: "Medium",
    updated: hoursAgo(48),
    url: browse("PHX-130"),
    comments: [
      {
        id: "1006",
        author: "Arun",
        body: "Cannot start sign-off until regression (PHX-101) and security review (PHX-115) are closed.",
        created: hoursAgo(48),
      },
    ],
  },
];

export function seed(): void {
  db.prepare(
    `INSERT INTO employees (id, name, role, phone, slack_user_id, ooo_enabled)
     VALUES (?,?,?,?,?,0)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, role = excluded.role, phone = excluded.phone`,
  ).run(EMPLOYEE_ID, "Arun", "Project Lead", config.phones.arun || null, null);

  db.prepare(
    `INSERT INTO projects (id, name, description, jira_project_key, owner_id)
     VALUES (?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description`,
  ).run(
    PROJECT_ID,
    "Phoenix Mobile App Launch",
    "Launch of the Phoenix mobile app across iOS and Android, including the v2 API gateway migration.",
    config.jira.projectKey || "PHX",
    EMPLOYEE_ID,
  );

  // With live Jira configured, the real project is the source of issues — seeding
  // the fictional PHX-* rows too would show two copies of every ticket.
  // SEED_FAKE_ISSUES=true forces them in anyway.
  const useFakeIssues =
    !config.jira.enabled || process.env.SEED_FAKE_ISSUES?.toLowerCase() === "true";

  let comments = 0;
  if (useFakeIssues) {
    for (const issue of DEMO_ISSUES) {
      comments += ingestIssue(issue, EMPLOYEE_ID, PROJECT_ID);
    }
  }

  // A little project-level narrative context that is not tied to one issue.
  upsertKnowledgeItem({
    employeeId: EMPLOYEE_ID,
    projectId: PROJECT_ID,
    type: "NOTE",
    title: "Phoenix launch plan",
    content:
      "Phoenix Mobile App Launch targets a staged Android rollout first, followed by iOS one week later. " +
      "Arun is the project lead and owns release readiness sign-off. The launch gate requires Android regression " +
      "(PHX-101) and the security review (PHX-115) to be closed.",
    sourceType: "MANUAL",
    sourceId: "phoenix-launch-plan",
    confidence: 1.0,
    verified: true,
    updatedAt: nowIso(),
  });

  console.log(
    useFakeIssues
      ? `Seeded ${DEMO_ISSUES.length} fictional Phoenix issues and ${comments} comments for Arun.`
      : `Seeded Arun and the Phoenix project. Live Jira (${config.jira.projectKey}) is configured — ` +
          "run `npm run sync:jira` to pull the real issues.",
  );
}

// Running `npm run seed` executes the seed directly.
seed();
