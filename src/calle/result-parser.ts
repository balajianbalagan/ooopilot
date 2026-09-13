import type { Call } from "@call-e/calle";
import { extractStructuredResult, flattenTranscript } from "./client.js";
import { extractFromTranscript, normalizeResult, type ExtractedConversation } from "../conversation/extractor.js";

/**
 * Turns a terminal CALL-E call into the normalized conversation record.
 *
 * Preference order: CALL-E's own structured result, then a transcript-based
 * LLM extraction, then whatever summary text the call carries.
 */
export async function parseCallResult(input: {
  call: Call;
  conversationId: string;
  employeeId: string;
  employeeName: string;
  requester: string;
  topic: string;
}): Promise<ExtractedConversation> {
  const transcript = flattenTranscript(input.call);
  let raw = extractStructuredResult(input.call);

  const isThin = !raw || Object.keys(raw).length === 0 || !raw.summary;
  if (isThin) {
    const recovered = await extractFromTranscript({
      transcript,
      requester: input.requester,
      employeeName: input.employeeName,
      topic: input.topic,
    });
    if (recovered) raw = { ...(raw ?? {}), ...recovered };
  }

  return normalizeResult({
    raw,
    conversationId: input.conversationId,
    employeeId: input.employeeId,
    requester: input.requester,
    topic: input.topic,
    callId: input.call.id,
    transcript,
    fallbackSummary: input.call.summary,
  });
}
