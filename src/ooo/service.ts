import type { Call } from "@call-e/calle";
import { config } from "../config.js";
import { buildCallBrief } from "../calle/call-builder.js";
import { getCall, placeCall, waitForCall } from "../calle/client.js";
import { parseCallResult } from "../calle/result-parser.js";
import {
  addConversationItem,
  createConversation,
  createFollowup,
  getConversation,
  getConversationByCallId,
  getPrimaryEmployee,
  getProjectForEmployee,
  listActiveConversations,
  updateConversation,
  upsertKnowledgeItem,
} from "../knowledge/repository.js";
import { nowIso } from "../knowledge/sqlite.js";
import type { Conversation, Employee } from "../knowledge/types.js";
import { isValidPhone, sanitizeCommitment } from "../safety/policy.js";
import { buildContext } from "./context-builder.js";
import { emitOooEvent } from "./state.js";

export interface StartCallInput {
  requester: string;
  requesterPhone: string;
  topic: string;
  /** True when the requester initiated contact and we are calling them back. */
  inbound?: boolean;
  origin?: string;
  employee?: Employee;
}

export interface StartCallResult {
  conversation: Conversation;
  callId: string;
  safetyViolations: string[];
}

/**
 * The core happy path: build context -> safety check -> CALL-E outbound call.
 *
 * Returns as soon as CALL-E accepts the call. The terminal result is handled by
 * `handleTerminalCall`, reached either by webhook or by the polling fallback.
 */
export async function startConversationCall(input: StartCallInput): Promise<StartCallResult> {
  const employee = input.employee ?? getPrimaryEmployee();

  if (!isValidPhone(input.requesterPhone)) {
    throw new Error(
      `"${input.requesterPhone}" is not a valid E.164 phone number (expected e.g. +14155550100).`,
    );
  }

  // CALL-E's shared outbound line permits one concurrent task per account, and
  // a rejected call still costs credits. Refuse locally rather than pay for a
  // call that cannot succeed. A dedicated number (after KYC) raises this to 10.
  if (!config.calle.dryRun) {
    // Ignore rows older than the window: if the server was killed mid-call the
    // conversation stays IN_PROGRESS forever, and a stale row must not
    // permanently block every future call.
    const STALE_AFTER_MS = 10 * 60_000;
    const current = listActiveConversations(employee.id).find(
      (c) => Date.now() - new Date(c.started_at ?? 0).getTime() < STALE_AFTER_MS,
    );
    if (current) {
      throw new Error(
        `A call with ${current.requester} is still in progress (${current.call_id ?? current.id}). ` +
          "CALL-E's shared line allows only one call at a time — wait for it to finish, then try again.",
      );
    }
  }

  const conversation = createConversation({
    employeeId: employee.id,
    requester: input.requester,
    requesterPhone: input.requesterPhone,
    topic: input.topic,
    direction: input.inbound ? "INBOUND_CALLBACK" : "OUTBOUND",
    origin: input.origin ?? "SLACK",
  });

  const context = await buildContext({ employee, requester: input.requester, topic: input.topic });
  const brief = buildCallBrief(context, { inbound: input.inbound });

  const call = await placeCall({
    phone: input.requesterPhone,
    task: brief.task,
    resultSchema: brief.resultSchema,
    metadata: {
      conversation_id: conversation.id,
      employee_id: employee.id,
      requester: input.requester,
      topic: input.topic,
      direction: input.inbound ? "inbound_callback" : "outbound",
    },
    idempotencyKey: `ooo:${conversation.id}`,
  });

  updateConversation(conversation.id, { call_id: call.id, status: "IN_PROGRESS" });

  emitOooEvent({
    type: "call_started",
    conversationId: conversation.id,
    requester: input.requester,
    callId: call.id,
    topic: input.topic,
    inbound: Boolean(input.inbound),
  });

  // Dry-run calls come back already terminal, so process them immediately.
  if (config.calle.dryRun) {
    void handleTerminalCall(call).catch((err) =>
      console.error("[ooo] dry-run processing failed:", (err as Error).message),
    );
  } else if (!config.calle.webhookUrl) {
    // No public webhook configured: poll for the terminal result instead.
    void pollForResult(call.id);
  }

  return { conversation: getConversation(conversation.id)!, callId: call.id, safetyViolations: brief.safetyViolations };
}

async function pollForResult(callId: string): Promise<void> {
  try {
    const call = await waitForCall(callId);
    await handleTerminalCall(call);
  } catch (err) {
    console.error("[ooo] polling for call result failed:", (err as Error).message);
    const conversation = getConversationByCallId(callId);
    if (conversation) {
      updateConversation(conversation.id, { status: "FAILED", ended_at: nowIso() });
      emitOooEvent({ type: "call_failed", conversationId: conversation.id, reason: (err as Error).message });
    }
  }
}

/**
 * Processes a terminal CALL-E call: extracts structured data and writes it to SQLite.
 *
 * Safe to call more than once for the same call (webhook plus polling); a
 * conversation already marked COMPLETED is skipped.
 */
export async function handleTerminalCall(call: Call): Promise<void> {
  const conversation =
    getConversationByCallId(call.id) ??
    (typeof call.metadata?.conversation_id === "string"
      ? getConversation(call.metadata.conversation_id)
      : undefined);

  if (!conversation) {
    console.warn(`[ooo] no conversation found for call ${call.id}; ignoring.`);
    return;
  }
  if (conversation.status === "COMPLETED") return; // already processed

  if (call.status === "failed") {
    // Per-attempt codes carry the real telephony reason (e.g. SIP 408), which
    // the task-level failureMessage flattens into "NO ANSWER".
    const attempts = call.recipients?.flatMap((r) => r.attempts ?? []) ?? [];
    const detail = attempts
      .map((a) => `attempt ${a.status}${a.failureCode ? ` code=${a.failureCode}` : ""}`)
      .join("; ");

    updateConversation(conversation.id, {
      status: "FAILED",
      ended_at: nowIso(),
      // Deliberately NOT written to `summary`: that field feeds the next call's
      // context, and a telephony error is not conversation content.
      raw_result: JSON.stringify({ failureCode: call.failureCode, failureMessage: call.failureMessage, attempts }),
    });
    emitOooEvent({
      type: "call_failed",
      conversationId: conversation.id,
      reason: `${call.failureMessage ?? call.failureCode ?? "unknown"}${detail ? ` [${detail}]` : ""}`,
    });
    return;
  }

  const employee = getPrimaryEmployee();
  const project = getProjectForEmployee(employee.id);

  const extracted = await parseCallResult({
    call,
    conversationId: conversation.id,
    employeeId: conversation.employee_id,
    employeeName: employee.name,
    requester: conversation.requester,
    topic: conversation.topic ?? "project update",
  });

  updateConversation(conversation.id, {
    status: "COMPLETED",
    ended_at: nowIso(),
    summary: extracted.summary,
    transcript: extracted.transcript,
    confidence: extracted.confidence,
    raw_result: JSON.stringify(extracted),
  });

  for (const q of extracted.questions) {
    addConversationItem({ conversationId: conversation.id, type: "QUESTION", content: q, source: conversation.requester });
  }
  for (const a of extracted.answers) {
    addConversationItem({ conversationId: conversation.id, type: "ANSWER", content: a, source: "OOO-Pilot" });
  }
  for (const d of extracted.decisions) {
    addConversationItem({ conversationId: conversation.id, type: "DECISION", content: d, source: conversation.requester });
  }
  for (const c of extracted.commitments) {
    addConversationItem({
      conversationId: conversation.id,
      type: "COMMITMENT",
      content: sanitizeCommitment(c),
      source: conversation.requester,
    });
  }
  for (const u of extracted.unresolvedItems) {
    addConversationItem({ conversationId: conversation.id, type: "UNRESOLVED", content: u, source: "OOO-Pilot" });
  }

  // Coworker-reported facts are stored as CONVERSATION-sourced and unverified.
  for (const info of extracted.newInformation) {
    addConversationItem({
      conversationId: conversation.id,
      type: "NEW_INFORMATION",
      content: info.content,
      source: info.sourcePerson,
      confidence: info.confidence,
    });
    upsertKnowledgeItem({
      employeeId: conversation.employee_id,
      projectId: project?.id ?? null,
      type: "NOTE",
      title: `Reported by ${info.sourcePerson} during an OOO call`,
      content: `${info.content} (reported by ${info.sourcePerson} on a call with ${conversation.requester}; not confirmed in Jira)`,
      sourceType: "CONVERSATION",
      sourceId: `${conversation.id}:${info.content.slice(0, 40)}`,
      confidence: info.confidence,
      verified: false,
    });
  }

  for (const followUp of extracted.followUps) {
    addConversationItem({
      conversationId: conversation.id,
      type: "FOLLOW_UP",
      content: followUp.content,
      source: conversation.requester,
    });
    createFollowup({
      employeeId: conversation.employee_id,
      conversationId: conversation.id,
      requester: conversation.requester,
      projectId: project?.id ?? null,
      content: followUp.content,
      priority: followUp.priority,
    });
  }

  emitOooEvent({ type: "call_completed", conversationId: conversation.id });
}

/** Manual refresh path used by `POST /calls/:id/refresh` when a webhook is missed. */
export async function refreshCall(callId: string): Promise<void> {
  const call = config.calle.dryRun ? null : await getCall(callId);
  if (call) await handleTerminalCall(call);
}

/**
 * Very small topic detector. Good enough for the MVP: the project name is the
 * default topic, and we only strip the Slack mention noise.
 */
export function detectTopic(text: string, employeeId?: string): string {
  const cleaned = text.replace(/<@[^>]+>/g, "").trim();
  if (cleaned.length > 3) return cleaned;
  const project = getProjectForEmployee(employeeId ?? getPrimaryEmployee().id);
  return project?.name ?? "project update";
}
