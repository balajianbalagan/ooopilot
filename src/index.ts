import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Call } from "@call-e/calle";

import { config, describeConfig } from "./config.js";
import { claimEvent } from "./knowledge/sqlite.js";
import {
  deleteKnowledgeBySource,
  getConversation,
  getPrimaryEmployee,
  getProjectForEmployee,
  listConversationItems,
  listConversations,
  listInboundRequests,
  listKnowledge,
  listOpenFollowups,
  upsertKnowledgeItem,
} from "./knowledge/repository.js";
import { syncJiraProject } from "./jira/sync.js";
import { jiraWebhookRouter } from "./jira/webhook.js";
import { syncGitRepo } from "./git/sync.js";
import { inboundRouter } from "./inbound/routes.js";
import { handleTerminalCall, refreshCall, startConversationCall } from "./ooo/service.js";
import { activateOoo, deactivateOoo, getOooStatus, onOooEvent } from "./ooo/state.js";
import { buildReturnSummary, renderReturnSummary } from "./ooo/return-summary.js";
import { startSlack } from "./slack/app.js";
import { listLogs, log } from "./ooo/activity-log.js";

const here = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

// The inbound "OOO line" demo page.
app.use("/", express.static(join(here, "..", "public")));

app.get("/health", (_req, res) => {
  const employee = getPrimaryEmployee();
  res.json({
    ok: true,
    employee: employee.name,
    ooo: getOooStatus(employee.id).enabled,
    calleDryRun: config.calle.dryRun,
  });
});

// ---------- Admin console feed ----------
// Translates OOO lifecycle events into the activity log so the console shows
// every call and inbound contact, not just what happens to reach Slack.
onOooEvent((event) => {
  switch (event.type) {
    case "inbound_received":
      log(`Inbound request from ${event.requester} via ${event.channel} — "${event.topic}"`);
      break;
    case "call_started":
      log(
        `${event.inbound ? "Calling back" : "Calling"} ${event.requester} about "${event.topic}" (call ${event.callId})`,
        "call",
      );
      break;
    case "call_completed":
      log(`Call with conversation ${event.conversationId} completed — summary stored in SQLite.`, "call");
      break;
    case "call_failed":
      log(`Call for conversation ${event.conversationId} failed: ${event.reason}`, "error");
      break;
  }
});

app.get("/logs", (req, res) => {
  const after = Number(req.query.after ?? 0) || 0;
  res.json(listLogs(after));
});

/** Non-secret snapshot of system + OOO state for the admin console. */
app.get("/admin/overview", (_req, res) => {
  const employee = getPrimaryEmployee();
  const project = getProjectForEmployee(employee.id) ?? null;
  const status = getOooStatus(employee.id);
  res.json({
    employee: { name: employee.name, role: employee.role },
    project: project ? { name: project.name, jiraKey: project.jira_project_key } : null,
    ooo: { enabled: status.enabled, startedAt: status.startedAt },
    integrations: {
      slack: config.slack.enabled,
      jira: config.jira.enabled,
      calle: config.calle.enabled,
      calleDryRun: config.calle.dryRun,
      llm: config.llm.enabled,
    },
    counts: {
      conversations: listConversations(employee.id).length,
      openFollowups: listOpenFollowups(employee.id).length,
      knowledgeItems: listKnowledge({ employeeId: employee.id, limit: 1000 }).length,
      inboundRequests: listInboundRequests(employee.id).length,
    },
  });
});

// ---------- CALL-E webhook ----------
/**
 * CALL-E posts the terminal call task here once the outcome and structured
 * result are final. Deliveries are unsigned, so we de-duplicate on the event id
 * (which must match the CALL-E-Event-Id header).
 */
app.post("/webhooks/calle", async (req, res) => {
  const event = req.body ?? {};
  const headerId = req.header("CALL-E-Event-Id");

  if (headerId && event.id && headerId !== event.id) {
    res.status(400).json({ error: "event id mismatch" });
    return;
  }
  res.json({ ok: true }); // acknowledge fast

  try {
    if (event.id && !claimEvent(String(event.id))) return; // already processed
    const call = event.data as Call | undefined;
    if (call?.id) {
      log(`CALL-E webhook delivered terminal result for call ${call.id}`, "call");
      await handleTerminalCall(normalizeWebhookCall(call));
    }
  } catch (err) {
    log(`CALL-E webhook processing failed: ${(err as Error).message}`, "error");
  }
});

/**
 * Webhook payloads use the API's snake_case field names, while the SDK's `Call`
 * type is camelCase. Map the fields the pipeline reads.
 */
function normalizeWebhookCall(raw: Record<string, any>): Call {
  return {
    ...raw,
    structuredResult: raw.structuredResult ?? raw.structured_result ?? null,
    taskCompleted: raw.taskCompleted ?? raw.task_completed ?? null,
    failureCode: raw.failureCode ?? raw.failure_code ?? null,
    failureMessage: raw.failureMessage ?? raw.failure_message ?? null,
    recipients: (raw.recipients ?? []).map((r: Record<string, any>) => ({
      ...r,
      structuredResult: r.structuredResult ?? r.structured_result ?? null,
      attempts: (r.attempts ?? []).map((a: Record<string, any>) => ({
        ...a,
        transcriptTurns: a.transcriptTurns ?? a.transcript_turns ?? [],
      })),
    })),
  } as Call;
}

// ---------- Jira ----------
app.post("/sync/jira", async (_req, res) => {
  try {
    const result = await syncJiraProject();
    log(result.message);
    res.json(result);
  } catch (err) {
    log(`Jira sync failed: ${(err as Error).message}`, "error");
    res.status(500).json({ error: (err as Error).message });
  }
});
app.use("/webhooks", jiraWebhookRouter);

// ---------- Git ----------
/**
 * Syncs a local git repo into the knowledge store — "local changes the
 * employee made while OOO should also become knowledge." Read-only: runs
 * `git log` on disk, no push/pull, no credentials, no remote API calls.
 */
app.post("/sync/git", async (req, res) => {
  const repoPath = String(req.body?.repoPath ?? "").trim();
  if (!repoPath) {
    res.status(400).json({ error: "repoPath is required (an absolute path to a local git working tree)." });
    return;
  }
  try {
    const result = await syncGitRepo(repoPath, req.body?.since ?? null);
    log(result.message);
    res.json(result);
  } catch (err) {
    log(`Git sync failed: ${(err as Error).message}`, "error");
    res.status(400).json({ error: (err as Error).message });
  }
});

// ---------- Knowledge (custom / manual) ----------
app.get("/knowledge", (req, res) => {
  const employee = getPrimaryEmployee();
  res.json(listKnowledge({ employeeId: employee.id, sourceType: req.query.sourceType as string | undefined, limit: 200 }));
});

/** Adds a manually-authored knowledge item — the "add custom knowledge" page. */
app.post("/knowledge", (req, res) => {
  const { title, content, type } = req.body ?? {};
  if (!String(content ?? "").trim()) {
    res.status(400).json({ error: "content is required." });
    return;
  }
  const employee = getPrimaryEmployee();
  const project = getProjectForEmployee(employee.id);
  const id = `manual-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  upsertKnowledgeItem({
    employeeId: employee.id,
    projectId: project?.id ?? null,
    type: String(type ?? "NOTE"),
    title: String(title ?? "Manual note"),
    content: String(content).trim(),
    sourceType: "MANUAL",
    sourceId: id,
    confidence: 1.0,
    verified: true,
  });
  log(`Custom knowledge added: "${String(title ?? content).slice(0, 60)}"`);
  res.status(201).json({ ok: true, sourceId: id });
});

app.delete("/knowledge/:sourceId", (req, res) => {
  deleteKnowledgeBySource("MANUAL", req.params.sourceId);
  res.json({ ok: true });
});

// ---------- Inbound ----------
app.use("/inbound", inboundRouter);

// ---------- OOO control (HTTP mirror of the Slack commands) ----------
app.post("/ooo/on", (_req, res) => {
  const employee = getPrimaryEmployee();
  log(`${employee.name} activated OOO mode.`);
  res.json(activateOoo(employee.id));
});

app.post("/ooo/off", (_req, res) => {
  const employee = getPrimaryEmployee();
  const summary = buildReturnSummary(employee);
  deactivateOoo(employee.id);
  log(
    `${employee.name} returned from OOO — ${summary.conversationCount} conversation(s), ` +
      `${summary.discrepancies.length} discrepancy(ies) flagged.`,
  );
  res.json({ summary, markdown: renderReturnSummary(summary) });
});

app.get("/ooo/status", (_req, res) => {
  res.json(getOooStatus(getPrimaryEmployee().id));
});

app.get("/ooo/summary", (_req, res) => {
  const employee = getPrimaryEmployee();
  const summary = buildReturnSummary(employee);
  res.json({ summary, markdown: renderReturnSummary(summary) });
});

// ---------- Calls ----------
app.post("/calls", async (req, res) => {
  try {
    const { requester, phone, topic, inbound } = req.body ?? {};
    const result = await startConversationCall({
      requester: requester ?? "Coworker",
      requesterPhone: phone ?? config.phones.raj,
      topic: topic ?? "project update",
      inbound: Boolean(inbound),
      origin: "API",
    });
    res.status(202).json(result);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.post("/calls/:id/refresh", async (req, res) => {
  try {
    await refreshCall(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.get("/conversations", (_req, res) => {
  const employee = getPrimaryEmployee();
  res.json(listConversations(employee.id));
});

app.get("/conversations/:id", (req, res) => {
  const conversation = getConversation(req.params.id);
  if (!conversation) {
    res.status(404).json({ error: "not found" });
    return;
  }
  res.json({ conversation, items: listConversationItems(conversation.id) });
});

app.get("/followups", (_req, res) => {
  res.json(listOpenFollowups(getPrimaryEmployee().id));
});

// ---------- start ----------
async function main(): Promise<void> {
  app.listen(config.port, () => {
    console.log(`\nOOO-Pilot listening on http://localhost:${config.port}`);
    console.log(`Inbound OOO line demo: http://localhost:${config.port}/inbound.html`);
    console.log(`Admin console:         http://localhost:${config.port}/admin.html\n`);
    console.log(describeConfig());
    console.log("");
    log("OOO-Pilot server started.");
  });

  await startSlack();
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
