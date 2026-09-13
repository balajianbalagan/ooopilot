import { Router } from "express";
import { config } from "../config.js";
import {
  deleteKnowledgeBySource,
  getPrimaryEmployee,
  getProjectForEmployee,
} from "../knowledge/repository.js";
import { JiraClient, adfToText, type RawIssue } from "./client.js";
import { ingestIssue } from "./sync.js";
import { upsertKnowledgeItem } from "../knowledge/repository.js";

export const jiraWebhookRouter: Router = Router();

/**
 * Jira Cloud webhook receiver.
 *
 * Register with a JQL filter (e.g. `project = PHX`) so only demo-project events
 * arrive. Events are normalized and upserted into SQLite, keeping the knowledge
 * store current between manual syncs.
 */
jiraWebhookRouter.post("/jira", async (req, res) => {
  // Acknowledge immediately; Jira retries on slow responses.
  res.json({ ok: true });

  try {
    const event = req.body ?? {};
    const eventType = String(event.webhookEvent ?? "");
    const employee = getPrimaryEmployee();
    const project = getProjectForEmployee(employee.id);
    const client = new JiraClient();

    if (eventType === "jira:issue_deleted") {
      const key = event.issue?.key;
      if (key) deleteKnowledgeBySource("JIRA", key);
      return;
    }

    if (eventType === "jira:issue_created" || eventType === "jira:issue_updated") {
      const raw = event.issue as RawIssue | undefined;
      if (!raw?.key) return;
      // The webhook payload omits comments, so re-fetch for the full picture.
      const issue = config.jira.enabled ? await client.getIssue(raw.key) : client.normalize(raw);
      ingestIssue(issue, employee.id, project?.id ?? null);
      console.log(`[jira-webhook] upserted ${issue.key} (${issue.status})`);
      return;
    }

    if (eventType.startsWith("comment_")) {
      const key = event.issue?.key;
      const comment = event.comment;
      if (!key || !comment?.id) return;

      if (eventType === "comment_deleted") {
        deleteKnowledgeBySource("JIRA", `${key}#comment-${comment.id}`);
        return;
      }
      upsertKnowledgeItem({
        employeeId: employee.id,
        projectId: project?.id ?? null,
        type: "COMMENT",
        title: `${key} comment by ${comment.author?.displayName ?? "Unknown"}`,
        content: `On ${key}, ${comment.author?.displayName ?? "someone"} wrote: ${adfToText(comment.body).trim()}`,
        sourceType: "JIRA",
        sourceId: `${key}#comment-${comment.id}`,
        sourceUrl: `${config.jira.baseUrl}/browse/${key}`,
        confidence: 1.0,
        verified: true,
        updatedAt: comment.updated ?? comment.created ?? new Date().toISOString(),
      });
      console.log(`[jira-webhook] upserted comment on ${key}`);
    }
  } catch (err) {
    console.error("[jira-webhook] failed:", (err as Error).message);
  }
});
