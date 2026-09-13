import { renderContext, type OooContext } from "../ooo/context-builder.js";
import { checkOutboundBrief, SAFETY_RULES } from "../safety/policy.js";

export interface CallBrief {
  task: string;
  resultSchema: Record<string, unknown>;
  safetyViolations: string[];
}

/**
 * JSON Schema for the structured result CALL-E extracts from the conversation.
 * Keep it flat and required-light: over-constrained schemas fail to materialize.
 */
export const OOO_RESULT_SCHEMA: Record<string, unknown> = {
  type: "object",
  required: ["summary"],
  properties: {
    summary: {
      type: "string",
      description: "Two to four sentence summary of what was discussed and agreed.",
    },
    questions_asked: {
      type: "array",
      description: "Questions the requester asked during the call.",
      items: { type: "string" },
    },
    answers_given: {
      type: "array",
      description: "Answers the assistant provided, drawn from supplied context.",
      items: { type: "string" },
    },
    new_information: {
      type: "array",
      description: "Facts the requester reported that were NOT in the supplied context.",
      items: {
        type: "object",
        required: ["content"],
        properties: {
          content: { type: "string" },
          source_person: { type: "string", description: "Who the requester attributed this to." },
        },
      },
    },
    follow_ups: {
      type: "array",
      description: "Things the requester wants the employee to do or review on return.",
      items: {
        type: "object",
        required: ["content"],
        properties: {
          content: { type: "string" },
          priority: { type: "string", enum: ["low", "normal", "high"] },
        },
      },
    },
    decisions: {
      type: "array",
      description: "Decisions stated during the call.",
      items: { type: "string" },
    },
    commitments: {
      type: "array",
      description: "Commitments the requester made themselves. Never commitments for the absent employee.",
      items: { type: "string" },
    },
    unresolved_items: {
      type: "array",
      description: "Questions that could not be answered from the supplied context.",
      items: { type: "string" },
    },
    confidence: {
      type: "number",
      description: "0 to 1 confidence that the conversation goal was met.",
    },
  },
};

/**
 * Builds the CALL-E task instruction.
 *
 * `inbound` flips the opening line: on a callback the requester asked us to
 * ring them, so the agent acknowledges that instead of cold-opening.
 */
export function buildCallBrief(ctx: OooContext, opts: { inbound?: boolean } = {}): CallBrief {
  const employeeName = ctx.employee.name;
  const requester = ctx.requester;
  const contextText = renderContext(ctx);
  const safety = checkOutboundBrief(contextText);

  const opening = opts.inbound
    ? `${requester} just reached out to ${employeeName}'s line asking for an update, so you are calling them straight back.`
    : `${requester} asked in Slack for an update, so you are calling them.`;

  const task = `You are ${employeeName}'s OOO-Pilot, an AI assistant that covers for ${employeeName} while they are out of office.

You are speaking with ${requester}, a coworker on ${ctx.project?.name ?? "the project"}.
${opening}

Open the call by saying you are an AI assistant calling on behalf of ${employeeName}, who is currently out of office. You are NOT ${employeeName}.

YOUR JOB
1. Explain ${employeeName}'s latest verified project status clearly and conversationally.
2. Answer follow-up questions, but ONLY using the context below.
3. If something is not covered by the context, say you do not have a verified answer and offer to record it for ${employeeName}.
4. Before wrapping up, ask: "Before we wrap up, is there anything you want ${employeeName} to know or follow up on when he returns?"
5. If ${requester} reports something new, acknowledge it as their report — not as confirmed project truth.
6. If ${requester} asks for an action or commitment, do NOT say ${employeeName} agreed. Say you will record it as a follow-up.
7. Read important follow-ups back to confirm them before ending the call.

SAFETY RULES
${SAFETY_RULES.map((r) => `- ${r}`).join("\n")}

TOPIC RAISED: ${ctx.topic}

--- CONTEXT (the only facts you may state as confirmed) ---
${safety.redactedText}
--- END CONTEXT ---

Keep the call under about four minutes. Be warm, concise and specific.`;

  return { task, resultSchema: OOO_RESULT_SCHEMA, safetyViolations: safety.violations };
}
