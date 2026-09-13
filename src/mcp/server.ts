/**
 * MCP server for OOO-Pilot.
 *
 * Exposes semantic work operations (not CRUD) over the same SQLite store, so any
 * MCP client — Claude, an IDE agent, another CALL-E agent — can read an absent
 * employee's context, record what it learned, and trigger a callback.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import {
  addConversationItem,
  createConversation,
  createFollowup,
  getPrimaryEmployee,
  getProjectForEmployee,
  listConversationItems,
  listConversations,
  listKnowledge,
  listOpenFollowups,
  updateConversation,
  upsertKnowledgeItem,
} from "../knowledge/repository.js";
import { searchAllProviders } from "../knowledge/search.js";
import { buildContext, renderContext } from "../ooo/context-builder.js";
import { buildReturnSummary, renderReturnSummary } from "../ooo/return-summary.js";
import { syncJiraProject } from "../jira/sync.js";
import { syncGitRepo } from "../git/sync.js";
import { handleInboundRequest } from "../inbound/intake.js";
import { nowIso } from "../knowledge/sqlite.js";

const server = new McpServer({ name: "ooo-pilot", version: "1.0.0" });

const text = (value: unknown) => ({
  content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
});

server.tool(
  "search_employee_context",
  "Search everything known about the out-of-office employee's work — Jira issues, comments, notes, and facts learned during OOO calls.",
  { query: z.string().describe("What to look for, e.g. 'android regression status'") },
  async ({ query }) => {
    const employee = getPrimaryEmployee();
    const items = await searchAllProviders(employee.id, query);
    return text(
      items.map((i) => ({
        title: i.title,
        content: i.content,
        source: i.source_type,
        status: i.status,
        verified: Boolean(i.verified),
        updatedAt: i.updated_at,
      })),
    );
  },
);

server.tool(
  "get_project_context",
  "Build the full briefing an OOO proxy would use before speaking to a coworker about a topic.",
  {
    topic: z.string().describe("Topic the coworker wants to discuss"),
    requester: z.string().optional().describe("Who is asking"),
  },
  async ({ topic, requester }) => {
    const employee = getPrimaryEmployee();
    const ctx = await buildContext({ employee, requester: requester ?? "a coworker", topic });
    return text(renderContext(ctx));
  },
);

server.tool(
  "get_recent_updates",
  "List the most recent work updates for the employee, newest first.",
  { limit: z.number().optional().describe("How many items (default 10)") },
  async ({ limit }) => {
    const employee = getPrimaryEmployee();
    return text(
      listKnowledge({ employeeId: employee.id, limit: limit ?? 10 }).map((i) => ({
        title: i.title,
        content: i.content,
        source: i.source_type,
        status: i.status,
        updatedAt: i.updated_at,
      })),
    );
  },
);

server.tool(
  "get_open_followups",
  "List follow-ups coworkers requested while the employee has been out of office.",
  {},
  async () => {
    const employee = getPrimaryEmployee();
    return text(
      listOpenFollowups(employee.id).map((f) => ({
        content: f.content,
        requester: f.requester,
        priority: f.priority,
        createdAt: f.created_at,
      })),
    );
  },
);

server.tool(
  "record_conversation",
  "Record a completed conversation held on the employee's behalf, including its summary and transcript.",
  {
    requester: z.string(),
    topic: z.string(),
    summary: z.string(),
    transcript: z.string().optional(),
    callId: z.string().optional(),
  },
  async ({ requester, topic, summary, transcript, callId }) => {
    const employee = getPrimaryEmployee();
    const conversation = createConversation({
      employeeId: employee.id,
      requester,
      topic,
      origin: "API",
    });
    updateConversation(conversation.id, {
      status: "COMPLETED",
      summary,
      transcript: transcript ?? null,
      call_id: callId ?? null,
      ended_at: nowIso(),
    });
    return text({ conversationId: conversation.id, recorded: true });
  },
);

server.tool(
  "record_new_information",
  "Record a fact a coworker reported. Always stored as conversation-derived and unverified — it never overwrites Jira.",
  {
    content: z.string(),
    sourcePerson: z.string().describe("Who reported it"),
    conversationId: z.string().optional(),
    confidence: z.number().optional(),
  },
  async ({ content, sourcePerson, conversationId, confidence }) => {
    const employee = getPrimaryEmployee();
    const project = getProjectForEmployee(employee.id);

    if (conversationId) {
      addConversationItem({
        conversationId,
        type: "NEW_INFORMATION",
        content,
        source: sourcePerson,
        confidence: confidence ?? 0.5,
      });
    }
    upsertKnowledgeItem({
      employeeId: employee.id,
      projectId: project?.id ?? null,
      type: "NOTE",
      title: `Reported by ${sourcePerson}`,
      content: `${content} (reported by ${sourcePerson}; not confirmed in Jira)`,
      sourceType: "CONVERSATION",
      sourceId: `mcp:${sourcePerson}:${content.slice(0, 40)}`,
      confidence: confidence ?? 0.5,
      verified: false,
    });
    return text({ recorded: true, verified: false, sourceType: "CONVERSATION" });
  },
);

server.tool(
  "record_followup",
  "Record something the employee should do or review when they return.",
  {
    content: z.string(),
    requester: z.string().optional(),
    priority: z.enum(["low", "normal", "high"]).optional(),
    conversationId: z.string().optional(),
  },
  async ({ content, requester, priority, conversationId }) => {
    const employee = getPrimaryEmployee();
    const project = getProjectForEmployee(employee.id);
    const followup = createFollowup({
      employeeId: employee.id,
      conversationId: conversationId ?? null,
      requester: requester ?? null,
      projectId: project?.id ?? null,
      content,
      priority: priority ?? "normal",
    });
    return text({ followupId: followup.id, status: followup.status });
  },
);

server.tool(
  "get_return_summary",
  "Generate the return-from-OOO handoff: conversations handled, information learned, follow-ups, and Jira-vs-conversation discrepancies.",
  {},
  async () => {
    const employee = getPrimaryEmployee();
    return text(renderReturnSummary(buildReturnSummary(employee)));
  },
);

server.tool(
  "request_callback",
  "Ask the OOO-Pilot to phone someone back about a topic. This is how an inbound request reaches the employee's proxy.",
  {
    phone: z.string().describe("E.164 number to call back, e.g. +14155550100"),
    requesterName: z.string().optional(),
    topic: z.string().optional(),
  },
  async ({ phone, requesterName, topic }) => {
    const outcome = await handleInboundRequest({
      channel: "API",
      from: phone,
      requesterName,
      topic,
    });
    return text(outcome);
  },
);

server.tool(
  "sync_jira_project",
  "Re-sync the Jira project into the local knowledge store.",
  {},
  async () => text(await syncJiraProject()),
);

server.tool(
  "sync_git_repo",
  "Pull recent commits from a local git repo into the knowledge store, so code changes made while the employee was away become part of the context.",
  {
    repoPath: z.string().describe("Absolute path to a local git working tree"),
    since: z.string().optional().describe("Only commits after this (defaults to when OOO started)"),
  },
  async ({ repoPath, since }) => text(await syncGitRepo(repoPath, since ?? null)),
);

server.tool(
  "record_custom_knowledge",
  "Add a custom, manually-authored knowledge item (a fact, note, or context CALL-E should know that isn't in Jira or git).",
  {
    title: z.string(),
    content: z.string(),
    type: z.string().optional().describe("Free-form category, e.g. NOTE, DECISION, CONTEXT"),
  },
  async ({ title, content, type }) => {
    const employee = getPrimaryEmployee();
    const project = getProjectForEmployee(employee.id);
    const id = `manual-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    upsertKnowledgeItem({
      employeeId: employee.id,
      projectId: project?.id ?? null,
      type: type ?? "NOTE",
      title,
      content,
      sourceType: "MANUAL",
      sourceId: id,
      confidence: 1.0,
      verified: true,
    });
    return text({ recorded: true, sourceId: id });
  },
);

server.tool(
  "list_conversations",
  "List OOO conversations with their summaries.",
  {},
  async () => {
    const employee = getPrimaryEmployee();
    return text(
      listConversations(employee.id).map((c) => ({
        id: c.id,
        requester: c.requester,
        topic: c.topic,
        direction: c.direction,
        status: c.status,
        summary: c.summary,
        items: listConversationItems(c.id).length,
      })),
    );
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[mcp] ooo-pilot server ready on stdio.");
