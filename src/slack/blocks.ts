import type { KnownBlock } from "@slack/types";
import type { Conversation, ConversationItem, Employee, Project } from "../knowledge/types.js";

const section = (text: string): KnownBlock => ({
  type: "section",
  text: { type: "mrkdwn", text },
});

const context = (text: string): KnownBlock => ({
  type: "context",
  elements: [{ type: "mrkdwn", text }],
});

export function oooActivatedBlocks(employee: Employee, project: Project | null): KnownBlock[] {
  return [
    section(
      `🟢 *OOO Mode activated*\n\n*Employee:* ${employee.name}\n*Role:* ${employee.role ?? "—"}` +
        `\n*Project:* ${project?.name ?? "—"}`,
    ),
    section("*Knowledge sources*\n• Jira\n• OOO conversation history"),
    context(
      "Coworkers can `@OOO` me here, or reach the OOO line directly — I'll call them back with " +
        `${employee.name}'s latest verified context.`,
    ),
  ];
}

export function oooStatusBlocks(
  employee: Employee,
  enabled: boolean,
  startedAt: string | null,
  project: Project | null = null,
  stats: { conversations: number; followups: number } = { conversations: 0, followups: 0 },
): KnownBlock[] {
  if (!enabled) {
    return [section(`⚪ *${employee.name} is not out of office.* OOO-Pilot is idle.`)];
  }
  return [
    section(
      `🟢 *${employee.name} is out of office.*\n\n` +
        `*OOO since:* ${startedAt ? new Date(startedAt).toLocaleString() : "—"}\n` +
        `*Active project:* ${project?.name ?? "—"}\n` +
        `*Calls handled:* ${stats.conversations}   *Open follow-ups:* ${stats.followups}`,
    ),
    context("Mention me with a question and I'll call you to walk through the latest context."),
  ];
}

/** Offer to place the call, with the requester's number pre-filled. */
export function callOfferBlocks(input: {
  employeeName: string;
  requester: string;
  topic: string;
  phone: string;
}): KnownBlock[] {
  return [
    section(
      `📞 *I can call you and walk through ${input.employeeName}'s latest project context.*\n\n` +
        `*Requester:* ${input.requester}\n*Detected topic:* ${input.topic}\n*Number:* \`${input.phone}\``,
    ),
    {
      type: "actions",
      elements: [
        {
          type: "button",
          style: "primary",
          text: { type: "plain_text", text: "📞 Start Call", emoji: true },
          action_id: "start_ooo_call",
          value: JSON.stringify({ requester: input.requester, topic: input.topic, phone: input.phone }),
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Use a different number", emoji: true },
          action_id: "change_number",
          value: JSON.stringify({ requester: input.requester, topic: input.topic }),
        },
      ],
    },
    context("I'll identify myself as an AI assistant and won't speak as the employee."),
  ];
}

export function callStartedBlocks(input: {
  requester: string;
  topic: string;
  callId: string;
  inbound: boolean;
  warnings: string[];
}): KnownBlock[] {
  const blocks: KnownBlock[] = [
    section(
      `${input.inbound ? "📲 *Inbound request — calling back now*" : "☎️ *Calling now*"}\n\n` +
        `*Requester:* ${input.requester}\n*Topic:* ${input.topic}\n*Call status:* dialing`,
    ),
    context(`CALL-E call \`${input.callId}\` • I'll post the structured summary here when the call ends.`),
  ];
  if (input.warnings.length) {
    blocks.push(context(`🔒 Safety: ${input.warnings.join(" ")}`));
  }
  return blocks;
}

export function inboundReceivedBlocks(input: {
  requester: string;
  channel: string;
  topic: string;
  employeeName: string;
}): KnownBlock[] {
  return [
    section(
      `📲 *Inbound request on ${input.employeeName}'s OOO line*\n\n` +
        `*From:* ${input.requester}\n*Channel:* ${input.channel}\n*Topic:* ${input.topic}`,
    ),
    context("CALL-E is outbound-only, so OOO-Pilot is returning the call automatically."),
  ];
}

/** The post-call structured summary. */
export function conversationSummaryBlocks(
  conversation: Conversation,
  items: ConversationItem[],
): KnownBlock[] {
  const pick = (type: ConversationItem["type"]) =>
    items.filter((i) => i.type === type).map((i) => i);

  const blocks: KnownBlock[] = [
    section(
      `✅ *Call complete — ${conversation.requester}*\n` +
        `*Topic:* ${conversation.topic ?? "—"}` +
        (conversation.direction === "INBOUND_CALLBACK" ? "  _(inbound callback)_" : ""),
    ),
    section(`*Summary*\n${conversation.summary ?? "_No summary produced._"}`),
  ];

  const listBlock = (title: string, entries: ConversationItem[], render: (i: ConversationItem) => string) => {
    if (!entries.length) return;
    blocks.push(section(`*${title}*\n${entries.map((e) => `• ${render(e)}`).join("\n")}`));
  };

  listBlock("Questions asked", pick("QUESTION"), (i) => i.content);
  listBlock("Information communicated", pick("ANSWER"), (i) => i.content);
  listBlock(
    "New information (conversation-derived, unverified)",
    pick("NEW_INFORMATION"),
    (i) => `${i.content}${i.source ? `  _(per ${i.source})_` : ""}`,
  );
  listBlock("Follow-ups recorded", pick("FOLLOW_UP"), (i) => i.content);
  listBlock("Unresolved", pick("UNRESOLVED"), (i) => i.content);

  blocks.push(
    context(
      `Stored in SQLite as \`${conversation.id}\` • CALL-E call \`${conversation.call_id ?? "—"}\`` +
        (conversation.confidence != null ? ` • confidence ${conversation.confidence.toFixed(2)}` : ""),
    ),
  );
  return blocks;
}

export function returnSummaryBlocks(markdown: string): KnownBlock[] {
  // Slack section blocks cap at 3000 chars, so split on blank lines.
  const chunks: string[] = [];
  let current = "";
  for (const paragraph of markdown.split("\n\n")) {
    if ((current + "\n\n" + paragraph).length > 2800) {
      chunks.push(current);
      current = paragraph;
    } else {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    }
  }
  if (current) chunks.push(current);
  return chunks.map(section);
}
