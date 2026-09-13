import { CalleClient, type Call, type CreateCallInput } from "@call-e/calle";
import { config } from "../config.js";

let cached: CalleClient | null = null;

export function calle(): CalleClient {
  if (!config.calle.enabled) {
    throw new Error("CALLE_API_KEY is not set. Add it to .env or enable CALLE_DRY_RUN=true.");
  }
  cached ??= new CalleClient({ apiKey: config.calle.apiKey, baseUrl: config.calle.baseUrl });
  return cached;
}

/**
 * Region/locale for a recipient, derived from the number's country code.
 *
 * CALL-E uses these to pick voice and dialing behaviour, so a hardcoded "US"
 * would be wrong for an Indian demo number. CALLE_REGION / CALLE_LOCALE
 * override the derived values when needed.
 */
export function localeForPhone(phone: string): { region: string; locale: string } {
  const byPrefix: Array<[string, string, string]> = [
    ["+91", "IN", "en-IN"],
    ["+44", "GB", "en-GB"],
    ["+61", "AU", "en-AU"],
    ["+65", "SG", "en-SG"],
    ["+1", "US", "en-US"],
  ];
  const match = byPrefix.find(([prefix]) => phone.startsWith(prefix));
  return {
    region: config.calle.region || match?.[1] || "US",
    locale: config.calle.locale || match?.[2] || "en-US",
  };
}

export interface PlaceCallInput {
  phone: string;
  task: string;
  resultSchema: Record<string, unknown>;
  metadata: Record<string, unknown>;
  idempotencyKey: string;
}

/**
 * Places one outbound CALL-E call and returns immediately.
 *
 * The terminal result arrives either through the CALL-E webhook (when
 * CALLE_WEBHOOK_URL is public) or through `waitForCall` polling. Both paths are
 * de-duplicated downstream by conversation status.
 */
export async function placeCall(input: PlaceCallInput): Promise<Call> {
  if (config.calle.dryRun) return dryRunCall(input);

  const payload: CreateCallInput = {
    task: input.task,
    recipient: { phone: input.phone, ...localeForPhone(input.phone) },
    resultSchema: input.resultSchema,
    metadata: input.metadata,
  };
  if (config.calle.webhookUrl) payload.webhookUrl = config.calle.webhookUrl;

  return calle().calls.create(payload, { idempotencyKey: input.idempotencyKey });
}

/** Polls until CALL-E finalizes the call. Used when no public webhook URL is set. */
export async function waitForCall(callId: string, timeoutMs = 15 * 60_000): Promise<Call> {
  return calle().calls.waitForResult(callId, { intervalMs: 5_000, timeoutMs });
}

export async function getCall(callId: string): Promise<Call> {
  return calle().calls.get(callId);
}

/** Flattens CALL-E transcript turns across recipient attempts into readable text. */
export function flattenTranscript(call: Call): string {
  const lines: string[] = [];
  for (const recipient of call.recipients ?? []) {
    for (const attempt of recipient.attempts ?? []) {
      for (const turn of attempt.transcriptTurns ?? []) {
        const who = turn.speaker === "bot" ? "OOO-Pilot" : turn.speaker === "user" ? "Requester" : "…";
        lines.push(`${who}: ${turn.text}`);
      }
    }
  }
  return lines.join("\n");
}

/** The structured result, preferring the task-level object and falling back per recipient. */
export function extractStructuredResult(call: Call): Record<string, unknown> | null {
  if (call.structuredResult) return call.structuredResult;
  for (const recipient of call.recipients ?? []) {
    if (recipient.structuredResult) return recipient.structuredResult;
  }
  return null;
}

/**
 * Offline stand-in used when CALLE_DRY_RUN=true, so the full pipeline
 * (context -> call -> extraction -> SQLite -> summary) can be demoed and tested
 * without spending CALL-E credits.
 */
function dryRunCall(input: PlaceCallInput): Call {
  const id = `call_dryrun_${Date.now().toString(36)}`;
  const requester = String(input.metadata.requester ?? "the requester");
  const structured = {
    summary:
      "Explained that Android regression testing is still in progress with three open issues, and that the " +
      "security review is waiting on the updated API threat model. Recorded a follow-up about the Wednesday " +
      "client expectation and a report that API migration testing is already complete.",
    questions_asked: ["What's the latest on Android?", "Is the security review done?"],
    answers_given: [
      "Android regression testing is In Progress with three issues still open, including the payment flow defect PHX-108.",
      "The security review (PHX-115) is In Progress and blocked on the updated API threat model.",
    ],
    new_information: [
      { content: "Karthik reported that the API migration testing (PHX-121) is actually complete.", source_person: "Karthik" },
    ],
    follow_ups: [
      { content: `Review release readiness against the client's Wednesday Android expectation (raised by ${requester}).`, priority: "high" },
    ],
    decisions: [],
    commitments: [],
    unresolved_items: ["Whether the Wednesday date is achievable given the open regression issues."],
    confidence: 0.82,
  };

  return {
    id,
    object: "call_task",
    status: "completed",
    task: input.task,
    recipients: [
      {
        id: "rcpt_dryrun",
        phones: [input.phone],
        locale: "en-US",
        region: "US",
        status: "completed",
        structuredResult: structured,
        summary: structured.summary,
        attempts: [
          {
            id: "att_dryrun",
            phone: input.phone,
            status: "completed",
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            summary: structured.summary,
            providerCallId: null,
            failureCode: null,
            failureMessage: null,
            transcriptTurns: [
              { offset_seconds: 0, speaker: "bot", text: `Hi ${requester}, this is an AI assistant calling on behalf of Arun, who is out of office.` },
              { offset_seconds: 6, speaker: "user", text: "What's the latest on Android?" },
              { offset_seconds: 9, speaker: "bot", text: "Jira shows Android regression testing is still in progress, with three issues open including a payment flow defect." },
              { offset_seconds: 20, speaker: "user", text: "Is the security review done?" },
              { offset_seconds: 23, speaker: "bot", text: "Jira shows the security review as in progress, waiting on the updated API threat model." },
              { offset_seconds: 33, speaker: "user", text: "Karthik told me the migration testing is actually complete. And tell Arun the client expects the Android release by Wednesday." },
              { offset_seconds: 42, speaker: "bot", text: "I'll record both for Arun. To confirm, you want Arun to review release readiness against the Wednesday client expectation?" },
              { offset_seconds: 52, speaker: "user", text: "Yes." },
              { offset_seconds: 54, speaker: "bot", text: "Got it. I'll record that for Arun. Thanks!" },
            ],
          },
        ],
      },
    ],
    structuredResult: structured,
    summary: structured.summary,
    taskCompleted: true,
    completionConfidence: { score: 0.82, label: "high" },
    evidence: ["Requester confirmed the follow-up before the call ended."],
    metadata: input.metadata,
    failureCode: null,
    failureMessage: null,
    createdAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  } as Call;
}
