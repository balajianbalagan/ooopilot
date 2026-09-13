/**
 * Inbound handling for OOO-Pilot.
 *
 * CALL-E is an outbound calling platform: there is no API to answer a ringing
 * phone. So "inbound" here is implemented the way contact centres implement
 * deflection — capture the inbound request, then immediately call the person
 * back with an agent that already has their context loaded.
 *
 * From the coworker's point of view they contacted Arun's OOO line and got a
 * phone conversation about it seconds later. Every inbound channel normalizes
 * into the same `InboundRequest`, so a native CALL-E inbound endpoint (or a
 * telephony DID webhook) can be added as one more channel without touching the
 * rest of the pipeline.
 */
import {
  createInboundRequest,
  getPrimaryEmployee,
  updateInboundRequest,
} from "../knowledge/repository.js";
import { db, nowIso } from "../knowledge/sqlite.js";
import type { InboundRequest } from "../knowledge/types.js";
import { isValidPhone } from "../safety/policy.js";
import { startConversationCall } from "../ooo/service.js";
import { emitOooEvent, getOooStatus } from "../ooo/state.js";

export type InboundChannel = "PHONE_INTAKE" | "SMS" | "WEB" | "SLACK" | "API";

export interface InboundPayload {
  channel: InboundChannel;
  /** Phone number to call back, in E.164. */
  from: string;
  requesterName?: string;
  topic?: string;
}

export interface InboundOutcome {
  accepted: boolean;
  request: InboundRequest | null;
  conversationId?: string;
  callId?: string;
  message: string;
}

/** Two inbound requests from the same number inside this window reuse the first callback. */
const DEDUPE_WINDOW_MS = 60_000;
const recentCallbacks = new Map<string, number>();

export async function handleInboundRequest(payload: InboundPayload): Promise<InboundOutcome> {
  const employee = getPrimaryEmployee();
  const status = getOooStatus(employee.id);

  const from = payload.from?.trim() ?? "";
  const requesterName = payload.requesterName?.trim() || from;
  const topic = payload.topic?.trim() || "project status update";

  // If the employee is not out of office, there is nothing to proxy.
  if (!status.enabled) {
    return {
      accepted: false,
      request: null,
      message: `${employee.name} is not currently out of office — please contact them directly.`,
    };
  }

  if (!isValidPhone(from)) {
    return {
      accepted: false,
      request: null,
      message: `"${from}" is not a valid E.164 phone number (expected e.g. +14155550100).`,
    };
  }

  const request = createInboundRequest({
    employeeId: employee.id,
    channel: payload.channel,
    fromIdentifier: from,
    requesterName,
    topic,
  });

  emitOooEvent({
    type: "inbound_received",
    requestId: request.id,
    requester: requesterName,
    channel: payload.channel,
    topic,
  });

  const lastCallback = recentCallbacks.get(from);
  if (lastCallback && Date.now() - lastCallback < DEDUPE_WINDOW_MS) {
    updateInboundRequest(request.id, { status: "REJECTED" });
    return {
      accepted: false,
      request,
      message: "A callback to this number is already on its way.",
    };
  }
  recentCallbacks.set(from, Date.now());

  try {
    updateInboundRequest(request.id, { status: "CALLING_BACK" });

    const result = await startConversationCall({
      employee,
      requester: requesterName,
      requesterPhone: from,
      topic,
      inbound: true,
      origin: payload.channel,
    });

    updateInboundRequest(request.id, {
      status: "CALLING_BACK",
      conversationId: result.conversation.id,
      answeredAt: nowIso(),
    });

    return {
      accepted: true,
      request,
      conversationId: result.conversation.id,
      callId: result.callId,
      message: `${employee.name} is out of office. Their OOO-Pilot is calling you back right now on ${from}.`,
    };
  } catch (err) {
    recentCallbacks.delete(from);
    updateInboundRequest(request.id, { status: "FAILED" });
    return {
      accepted: false,
      request,
      message: `Could not start the callback: ${(err as Error).message}`,
    };
  }
}

/** Marks the inbound request complete once its conversation finishes. */
export function completeInboundForConversation(conversationId: string): void {
  db.prepare(
    "UPDATE inbound_requests SET status = 'COMPLETED' WHERE conversation_id = ? AND status != 'COMPLETED'",
  ).run(conversationId);
}
