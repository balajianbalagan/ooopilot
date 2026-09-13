import {
  getProjectForEmployee,
  listConversations,
  listKnowledge,
  listOpenFollowups,
} from "../knowledge/repository.js";
import { searchAllProviders } from "../knowledge/search.js";
import type { Employee, Followup, KnowledgeItem, Project } from "../knowledge/types.js";

export interface OooContext {
  employee: Employee;
  project: Project | null;
  requester: string;
  topic: string;
  latestJiraContext: KnowledgeItem[];
  recentGitContext: KnowledgeItem[];
  recentConversationContext: KnowledgeItem[];
  relevantKnowledge: KnowledgeItem[];
  openFollowups: Followup[];
  recentConversationSummaries: Array<{ requester: string; summary: string; at: string }>;
}

const MAX_JIRA_ITEMS = 10;
const MAX_GIT_ITEMS = 6;
const MAX_CONVERSATION_ITEMS = 5;
const MAX_OTHER_ITEMS = 4;

/**
 * Builds the bounded context handed to CALL-E.
 *
 * Priority: newest Jira updates > verified knowledge > recent conversation-derived
 * knowledge > older project context. We never dump the whole database into the model.
 */
export async function buildContext(input: {
  employee: Employee;
  requester: string;
  topic: string;
}): Promise<OooContext> {
  const { employee, requester, topic } = input;
  const project = getProjectForEmployee(employee.id) ?? null;

  const found = await searchAllProviders(employee.id, topic);

  const byRecency = (a: KnowledgeItem, b: KnowledgeItem) =>
    (b.updated_at ?? "").localeCompare(a.updated_at ?? "");

  const latestJiraContext = found
    .filter((i) => i.source_type === "JIRA")
    .sort(byRecency)
    .slice(0, MAX_JIRA_ITEMS);

  // Recent local commits — "what changed in code while the employee was away."
  // Verified (it's a real commit), but kept in its own section: a code change
  // is not the same kind of fact as a tracked Jira decision.
  const recentGitContext = listKnowledge({
    employeeId: employee.id,
    sourceType: "GIT",
    limit: MAX_GIT_ITEMS,
  });

  // Conversation-derived knowledge is always unverified until a human confirms it.
  const recentConversationContext = listKnowledge({
    employeeId: employee.id,
    sourceType: "CONVERSATION",
    limit: MAX_CONVERSATION_ITEMS,
  });

  const relevantKnowledge = found
    .filter((i) => i.source_type !== "JIRA" && i.source_type !== "CONVERSATION" && i.source_type !== "GIT")
    .sort(byRecency)
    .slice(0, MAX_OTHER_ITEMS);

  // Only completed calls carry real conversation content. A failed call stores
  // its telephony error in `summary`, which must never be fed back into the
  // next call's brief as if it were something a coworker said.
  const recentConversationSummaries = listConversations(employee.id)
    .filter((c) => c.status === "COMPLETED" && c.summary)
    .slice(0, 3)
    .map((c) => ({ requester: c.requester, summary: c.summary!, at: c.started_at ?? "" }));

  return {
    employee,
    project,
    requester,
    topic,
    latestJiraContext,
    recentGitContext,
    recentConversationContext,
    relevantKnowledge,
    openFollowups: listOpenFollowups(employee.id),
    recentConversationSummaries,
  };
}

/** Renders the context as the compact briefing text embedded in the CALL-E task. */
export function renderContext(ctx: OooContext): string {
  const lines: string[] = [];

  lines.push(`PROJECT: ${ctx.project?.name ?? "Unknown project"}`);
  if (ctx.project?.description) lines.push(ctx.project.description);
  lines.push("");

  lines.push("VERIFIED JIRA STATUS (authoritative):");
  if (ctx.latestJiraContext.length === 0) {
    lines.push("- No Jira context available.");
  }
  for (const item of ctx.latestJiraContext) {
    lines.push(`- ${item.content.replace(/\n/g, " | ")}`);
  }
  lines.push("");

  if (ctx.relevantKnowledge.length) {
    lines.push("PROJECT BACKGROUND:");
    for (const item of ctx.relevantKnowledge) lines.push(`- ${item.content}`);
    lines.push("");
  }

  if (ctx.recentGitContext.length) {
    lines.push("RECENT CODE CHANGES (from local git history):");
    for (const item of ctx.recentGitContext) lines.push(`- ${item.content.replace(/\n/g, " | ")}`);
    lines.push("");
  }

  if (ctx.recentConversationContext.length) {
    lines.push("REPORTED IN EARLIER OOO CALLS (unverified, not confirmed in Jira):");
    for (const item of ctx.recentConversationContext) lines.push(`- ${item.content}`);
    lines.push("");
  }

  if (ctx.openFollowups.length) {
    lines.push("ALREADY-RECORDED FOLLOW-UPS FOR THE EMPLOYEE:");
    for (const f of ctx.openFollowups.slice(0, 5)) {
      lines.push(`- (from ${f.requester ?? "someone"}) ${f.content}`);
    }
    lines.push("");
  }

  if (ctx.recentConversationSummaries.length) {
    lines.push("RECENT OOO CONVERSATIONS:");
    for (const c of ctx.recentConversationSummaries) {
      lines.push(`- With ${c.requester}: ${c.summary}`);
    }
  }

  return lines.join("\n").trim();
}
