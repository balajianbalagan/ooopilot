import {
  getEmployee,
  listConversationItemsForEmployee,
  listConversations,
  listInboundRequests,
  listKnowledge,
  listOpenFollowups,
} from "../knowledge/repository.js";
import type { Employee, KnowledgeItem } from "../knowledge/types.js";

export interface Discrepancy {
  issueKey: string;
  jiraStatus: string;
  reported: string;
  reportedBy: string | null;
}

export interface ReturnSummary {
  employee: Employee;
  periodStart: string | null;
  periodEnd: string;
  conversationCount: number;
  inboundCount: number;
  updatesCommunicated: string[];
  newInformation: Array<{ content: string; source: string | null }>;
  followUps: Array<{ content: string; requester: string | null; priority: string }>;
  unresolved: string[];
  decisions: string[];
  discrepancies: Discrepancy[];
}

/** Words that signal a coworker claimed something finished. */
const COMPLETION_WORDS = /\b(complete|completed|done|finished|shipped|closed|signed off|passed)\b/i;
const DONE_STATUSES = /\b(done|closed|resolved|complete)\b/i;

/** Common issue-title words that carry no matching signal on their own. */
const STOPWORDS = new Set(["the", "and", "for", "with", "from", "into", "app", "new", "all"]);

/**
 * Finds places where a coworker's phone report contradicts authoritative Jira state.
 *
 * Deliberately conservative: it only flags a mismatch it can tie to a specific
 * issue key, and it never changes Jira.
 */
export function findDiscrepancies(employeeId: string, since: string | null): Discrepancy[] {
  const jiraItems = listKnowledge({ employeeId, sourceType: "JIRA", limit: 200 })
    .filter((item) => item.type === "ISSUE");

  const jiraByKey = new Map<string, KnowledgeItem>();
  for (const item of jiraItems) {
    if (item.source_id) jiraByKey.set(item.source_id.toUpperCase(), item);
  }

  const reports = listConversationItemsForEmployee(employeeId, "NEW_INFORMATION", since);
  const discrepancies: Discrepancy[] = [];
  const seen = new Set<string>();

  for (const report of reports) {
    if (!COMPLETION_WORDS.test(report.content)) continue;

    // Match an explicit issue key first, then fall back to issue-title keywords.
    const keys = new Set<string>();
    for (const match of report.content.matchAll(/\b([A-Z][A-Z0-9]+-\d+)\b/g)) {
      keys.add(match[1].toUpperCase());
    }
    if (keys.size === 0) {
      // No explicit key spoken on the call, so match on the issue subject.
      // Words of 3+ chars keep short but distinguishing terms like "API".
      const haystack = report.content.toLowerCase();
      for (const [key, item] of jiraByKey) {
        const subject = (item.title ?? "").replace(/^\S+\s+—\s+/, "").toLowerCase();
        const words = subject.split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOPWORDS.has(w));
        const overlap = words.filter((w) => haystack.includes(w)).length;
        if (overlap >= 2) keys.add(key);
      }
    }

    for (const key of keys) {
      const jira = jiraByKey.get(key);
      if (!jira?.status) continue;
      if (DONE_STATUSES.test(jira.status)) continue; // Jira agrees; nothing to flag
      const dedupeKey = `${key}:${report.content}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      discrepancies.push({
        issueKey: key,
        jiraStatus: jira.status,
        reported: report.content,
        reportedBy: report.source,
      });
    }
  }
  return discrepancies;
}

export function buildReturnSummary(input: Employee): ReturnSummary {
  // Re-read so the OOO window reflects the row as it stands now, not a snapshot
  // taken before /ooo on was processed.
  const employee = getEmployee(input.id) ?? input;
  const since = employee.ooo_started_at;
  const conversations = listConversations(employee.id, since).filter((c) => c.status === "COMPLETED");

  const answers = listConversationItemsForEmployee(employee.id, "ANSWER", since);
  const newInfo = listConversationItemsForEmployee(employee.id, "NEW_INFORMATION", since);
  const unresolved = listConversationItemsForEmployee(employee.id, "UNRESOLVED", since);
  const decisions = listConversationItemsForEmployee(employee.id, "DECISION", since);

  return {
    employee,
    periodStart: since,
    periodEnd: new Date().toISOString(),
    conversationCount: conversations.length,
    inboundCount: listInboundRequests(employee.id, since).length,
    updatesCommunicated: dedupe(answers.map((a) => a.content)).slice(0, 8),
    newInformation: newInfo.map((n) => ({ content: n.content, source: n.source })),
    followUps: listOpenFollowups(employee.id, since).map((f) => ({
      content: f.content,
      requester: f.requester,
      priority: f.priority,
    })),
    unresolved: dedupe(unresolved.map((u) => u.content)),
    decisions: dedupe(decisions.map((d) => d.content)),
    discrepancies: findDiscrepancies(employee.id, since),
  };
}

function dedupe(items: string[]): string[] {
  return [...new Set(items.map((i) => i.trim()).filter(Boolean))];
}

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—";

/** Renders the summary as Slack-flavoured markdown. */
export function renderReturnSummary(summary: ReturnSummary): string {
  const lines: string[] = [];
  const s = summary;

  lines.push(`*Welcome back, ${s.employee.name}.*`);
  lines.push("");
  lines.push(`*OOO period:* ${fmtDate(s.periodStart)} → ${fmtDate(s.periodEnd)}`);
  lines.push(
    `*Conversations handled:* ${s.conversationCount}` +
      (s.inboundCount ? `  (${s.inboundCount} started by an inbound request)` : ""),
  );
  lines.push("");

  const section = (title: string, items: string[], empty: string) => {
    lines.push(`*${title}*`);
    if (items.length === 0) lines.push(`_${empty}_`);
    for (const item of items) lines.push(`• ${item}`);
    lines.push("");
  };

  section("Project updates communicated", s.updatesCommunicated, "Nothing communicated.");
  section(
    "New information received",
    s.newInformation.map((n) => `${n.content}${n.source ? `  _(reported by ${n.source} — unverified)_` : ""}`),
    "No new information was reported.",
  );
  section(
    "Follow-ups requested",
    s.followUps.map((f) => `${f.content}${f.requester ? `  _(from ${f.requester})_` : ""}${f.priority === "high" ? "  *[high]*" : ""}`),
    "No follow-ups were requested.",
  );
  section("Unresolved items", s.unresolved, "Nothing was left unresolved.");
  if (s.decisions.length) section("Decisions", s.decisions, "");

  lines.push("*Important discrepancies*");
  if (s.discrepancies.length === 0) {
    lines.push("_No conflicts between Jira and what was reported on calls._");
  }
  for (const d of s.discrepancies) {
    lines.push(
      `⚠️ Jira still shows *${d.issueKey}* as *${d.jiraStatus}*, but ${d.reportedBy ?? "a coworker"} ` +
        `reported during an OOO call: "${d.reported}" — verify this before updating Jira.`,
    );
  }

  return lines.join("\n");
}
