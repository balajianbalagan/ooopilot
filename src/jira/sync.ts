import { config } from "../config.js";
import { getPrimaryEmployee, getProjectForEmployee, upsertKnowledgeItem } from "../knowledge/repository.js";
import { JiraClient, type JiraIssue } from "./client.js";

export interface SyncResult {
  source: "jira" | "seed";
  issues: number;
  comments: number;
  message: string;
}

/**
 * Normalize one Jira issue (plus its comments) into SQLite knowledge items.
 * Issues and comments become separate items so the context builder can rank
 * a fresh comment above a stale issue body.
 */
export function ingestIssue(issue: JiraIssue, employeeId: string, projectId: string | null): number {
  upsertKnowledgeItem({
    employeeId,
    projectId,
    type: "ISSUE",
    title: `${issue.key} — ${issue.summary}`,
    content: [
      `${issue.key}: ${issue.summary}`,
      `Status: ${issue.status}`,
      issue.assignee ? `Assignee: ${issue.assignee}` : null,
      issue.priority ? `Priority: ${issue.priority}` : null,
      issue.description ? `Details: ${issue.description}` : null,
    ]
      .filter(Boolean)
      .join("\n"),
    sourceType: "JIRA",
    sourceId: issue.key,
    sourceUrl: issue.url,
    status: issue.status,
    confidence: 1.0,
    verified: true,
    updatedAt: issue.updated,
  });

  for (const comment of issue.comments) {
    upsertKnowledgeItem({
      employeeId,
      projectId,
      type: "COMMENT",
      title: `${issue.key} comment by ${comment.author}`,
      content: `On ${issue.key} (${issue.summary}), ${comment.author} wrote: ${comment.body}`,
      sourceType: "JIRA",
      sourceId: `${issue.key}#comment-${comment.id}`,
      sourceUrl: issue.url,
      status: issue.status,
      confidence: 1.0,
      verified: true,
      updatedAt: comment.created,
    });
  }
  return issue.comments.length;
}

/**
 * Pull the demo project from Jira into SQLite.
 * When Jira credentials are absent the seeded demo data already in SQLite is
 * used instead, so the CALL-E happy path is never blocked on Jira setup.
 */
export async function syncJiraProject(projectKey = config.jira.projectKey): Promise<SyncResult> {
  const employee = getPrimaryEmployee();
  const project = getProjectForEmployee(employee.id);

  if (!config.jira.enabled) {
    return {
      source: "seed",
      issues: 0,
      comments: 0,
      message: "Jira credentials not configured — using seeded Phoenix demo data already in SQLite.",
    };
  }

  const client = new JiraClient();
  const jql = config.jira.jql || `project = ${projectKey} ORDER BY updated DESC`;
  const issues = await client.searchIssues(jql, 50);

  let comments = 0;
  for (const issue of issues) {
    comments += ingestIssue(issue, employee.id, project?.id ?? null);
  }

  return {
    source: "jira",
    issues: issues.length,
    comments,
    message: `Synced ${issues.length} issues and ${comments} comments from ${projectKey}.`,
  };
}
