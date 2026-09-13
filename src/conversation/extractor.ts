import OpenAI from "openai";
import { config } from "../config.js";
import { OOO_RESULT_SCHEMA } from "../calle/call-builder.js";

/** The normalized conversation record stored in SQLite. */
export interface ExtractedConversation {
  conversationId: string;
  employeeId: string;
  requester: string;
  topic: string;
  questions: string[];
  answers: string[];
  newInformation: Array<{
    content: string;
    sourceType: "CONVERSATION";
    sourcePerson: string;
    verified: false;
    confidence: number;
  }>;
  followUps: Array<{ content: string; priority: string }>;
  decisions: string[];
  commitments: string[];
  unresolvedItems: string[];
  summary: string;
  confidence: number;
  callId: string;
  transcript: string;
}

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((v) => (typeof v === "string" ? v : JSON.stringify(v))).filter(Boolean) : [];

/**
 * Normalizes CALL-E's structured result into the conversation record.
 *
 * Everything a coworker says on the phone is recorded as CONVERSATION-sourced
 * and unverified. It never becomes Jira-confirmed truth here.
 */
export function normalizeResult(input: {
  raw: Record<string, unknown> | null;
  conversationId: string;
  employeeId: string;
  requester: string;
  topic: string;
  callId: string;
  transcript: string;
  fallbackSummary?: string | null;
}): ExtractedConversation {
  const raw = input.raw ?? {};

  const newInformation = (Array.isArray(raw.new_information) ? raw.new_information : []).map((item) => {
    const obj = (typeof item === "object" && item !== null ? item : {}) as Record<string, unknown>;
    return {
      content: String(obj.content ?? item ?? "").trim(),
      sourceType: "CONVERSATION" as const,
      sourcePerson: String(obj.source_person ?? input.requester),
      verified: false as const,
      confidence: typeof obj.confidence === "number" ? obj.confidence : 0.5,
    };
  }).filter((i) => i.content.length > 0);

  const followUps = (Array.isArray(raw.follow_ups) ? raw.follow_ups : []).map((item) => {
    const obj = (typeof item === "object" && item !== null ? item : {}) as Record<string, unknown>;
    return {
      content: String(obj.content ?? item ?? "").trim(),
      priority: String(obj.priority ?? "normal"),
    };
  }).filter((f) => f.content.length > 0);

  return {
    conversationId: input.conversationId,
    employeeId: input.employeeId,
    requester: input.requester,
    topic: input.topic,
    questions: asStringArray(raw.questions_asked),
    answers: asStringArray(raw.answers_given),
    newInformation,
    followUps,
    decisions: asStringArray(raw.decisions),
    commitments: asStringArray(raw.commitments),
    unresolvedItems: asStringArray(raw.unresolved_items),
    summary: String(raw.summary ?? input.fallbackSummary ?? "Call completed; no summary was produced.").trim(),
    confidence: typeof raw.confidence === "number" ? raw.confidence : 0.5,
    callId: input.callId,
    transcript: input.transcript,
  };
}

/**
 * Second-pass extraction from the raw transcript.
 *
 * Used when CALL-E could not materialize a schema-valid structured result
 * (for example the call ended early). Returns null when no LLM key is set, and
 * the caller keeps whatever CALL-E did return.
 */
export async function extractFromTranscript(input: {
  transcript: string;
  requester: string;
  employeeName: string;
  topic: string;
}): Promise<Record<string, unknown> | null> {
  if (!config.llm.enabled || !input.transcript.trim()) return null;

  const client = new OpenAI({ apiKey: config.llm.apiKey });
  const prompt = `You are extracting structured data from a phone call transcript.

${input.employeeName} is out of office. An AI OOO assistant called ${input.requester} about "${input.topic}".

Extract the data described by this JSON Schema and return ONLY the JSON object:
${JSON.stringify(OOO_RESULT_SCHEMA, null, 2)}

Rules:
- new_information means facts the requester stated that the assistant did not already know.
- follow_ups means things the requester wants ${input.employeeName} to do when back.
- Never record a commitment as coming from ${input.employeeName}.
- Use empty arrays when a category has nothing.

TRANSCRIPT:
${input.transcript}`;

  try {
    const res = await client.chat.completions.create({
      model: config.llm.model,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0,
    });
    const text = res.choices[0]?.message?.content;
    return text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch (err) {
    console.warn("[extractor] transcript extraction failed:", (err as Error).message);
    return null;
  }
}
