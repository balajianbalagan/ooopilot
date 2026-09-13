import { config } from "../config.js";

export interface JiraComment {
  id: string;
  author: string;
  body: string;
  created: string;
}

export interface JiraIssue {
  key: string;
  summary: string;
  description: string;
  status: string;
  assignee: string | null;
  priority: string | null;
  updated: string;
  url: string;
  comments: JiraComment[];
}

/** Atlassian Document Format (or plain string) -> plain text. */
export function adfToText(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(adfToText).join("");

  const obj = node as Record<string, unknown>;
  if (obj.type === "text" && typeof obj.text === "string") return obj.text;

  const inner = adfToText(obj.content);
  // Block-level nodes get a newline so paragraphs do not run together.
  if (obj.type === "paragraph" || obj.type === "heading" || obj.type === "listItem") {
    return inner + "\n";
  }
  return inner;
}

export class JiraClient {
  private readonly authHeader: string;

  constructor(
    private readonly baseUrl = config.jira.baseUrl,
    email = config.jira.email,
    apiToken = config.jira.apiToken,
  ) {
    this.authHeader = "Basic " + Buffer.from(`${email}:${apiToken}`).toString("base64");
  }

  private async request<T>(path: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(params ?? {})) url.searchParams.set(key, value);

    const res = await fetch(url, {
      headers: { Authorization: this.authHeader, Accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(`Jira ${res.status} ${res.statusText} for ${path}: ${await res.text()}`);
    }
    return (await res.json()) as T;
  }

  /**
   * Search issues with JQL.
   *
   * Uses `/rest/api/3/search/jql`. The older `/rest/api/3/search` endpoint was
   * removed by Atlassian (CHANGE-2046) and now returns 410 Gone. The replacement
   * still honours `fields`, so comments come back inline and no per-issue
   * follow-up request is needed.
   */
  async searchIssues(jql: string, maxResults = 50): Promise<JiraIssue[]> {
    const data = await this.request<{ issues: RawIssue[]; isLast?: boolean }>(
      "/rest/api/3/search/jql",
      {
        jql,
        maxResults: String(maxResults),
        fields: "summary,description,status,assignee,priority,updated,comment",
      },
    );
    return (data.issues ?? []).map((issue) => this.normalize(issue));
  }

  async getIssue(key: string): Promise<JiraIssue> {
    const issue = await this.request<RawIssue>(`/rest/api/3/issue/${key}`, {
      fields: "summary,description,status,assignee,priority,updated,comment",
    });
    return this.normalize(issue);
  }

  normalize(issue: RawIssue): JiraIssue {
    const f = issue.fields ?? {};
    return {
      key: issue.key,
      summary: f.summary ?? "",
      description: adfToText(f.description).trim(),
      status: f.status?.name ?? "Unknown",
      assignee: f.assignee?.displayName ?? null,
      priority: f.priority?.name ?? null,
      updated: f.updated ?? new Date().toISOString(),
      url: `${this.baseUrl}/browse/${issue.key}`,
      comments: (f.comment?.comments ?? []).map((c) => ({
        id: c.id,
        author: c.author?.displayName ?? "Unknown",
        body: adfToText(c.body).trim(),
        created: c.created,
      })),
    };
  }
}

export interface RawIssue {
  key: string;
  fields?: {
    summary?: string;
    description?: unknown;
    status?: { name?: string };
    assignee?: { displayName?: string };
    priority?: { name?: string };
    updated?: string;
    comment?: { comments?: Array<{ id: string; author?: { displayName?: string }; body?: unknown; created: string }> };
  };
}
