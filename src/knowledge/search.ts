import { config } from "../config.js";
import { JiraClient } from "../jira/client.js";
import { getProjectForEmployee, searchKnowledge } from "./repository.js";
import type { KnowledgeItem, KnowledgeProvider } from "./types.js";

/** Everything already normalized into SQLite: Jira syncs, notes, conversation-derived facts. */
export class SQLiteKnowledgeProvider implements KnowledgeProvider {
  readonly name = "sqlite";

  async search(employeeId: string, query: string): Promise<KnowledgeItem[]> {
    return searchKnowledge(employeeId, query, 12);
  }
}

/**
 * Live Jira lookup at call time so the brief reflects Jira *now*, not at last sync.
 * Failures are non-fatal: the SQLite mirror still carries the last known state.
 */
export class JiraKnowledgeProvider implements KnowledgeProvider {
  readonly name = "jira";

  async search(employeeId: string, _query: string): Promise<KnowledgeItem[]> {
    if (!config.jira.enabled) return [];
    const project = getProjectForEmployee(employeeId);
    const projectKey = project?.jira_project_key ?? config.jira.projectKey;
    if (!projectKey) return [];

    try {
      const client = new JiraClient();
      const jql = config.jira.jql || `project = ${projectKey} ORDER BY updated DESC`;
      const issues = await client.searchIssues(jql, 20);
      return issues.map((issue) => ({
        id: `live:${issue.key}`,
        employee_id: employeeId,
        project_id: project?.id ?? null,
        type: "ISSUE",
        title: `${issue.key} — ${issue.summary}`,
        content:
          `${issue.key}: ${issue.summary}\nStatus: ${issue.status}` +
          (issue.comments[0] ? `\nLatest update: ${issue.comments[0].body}` : ""),
        source_type: "JIRA" as const,
        source_id: issue.key,
        source_url: issue.url,
        status: issue.status,
        confidence: 1.0,
        verified: 1,
        created_at: issue.updated,
        updated_at: issue.updated,
      }));
    } catch (err) {
      console.warn("[jira] live search failed, falling back to SQLite mirror:", (err as Error).message);
      return [];
    }
  }
}

/**
 * Combines both providers. Jira wins on conflict for Jira-derived facts, since
 * Jira is the authoritative work source.
 */
export async function searchAllProviders(employeeId: string, query: string): Promise<KnowledgeItem[]> {
  const providers: KnowledgeProvider[] = [new JiraKnowledgeProvider(), new SQLiteKnowledgeProvider()];
  const results = await Promise.all(providers.map((p) => p.search(employeeId, query)));

  const merged = new Map<string, KnowledgeItem>();
  for (const item of results.flat()) {
    const key = `${item.source_type}:${item.source_id}`;
    const existing = merged.get(key);
    // Live Jira entries are inserted first and must not be overwritten by the mirror.
    if (!existing) merged.set(key, item);
  }
  return [...merged.values()];
}
