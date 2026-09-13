import type { App as BoltApp } from "@slack/bolt";

import { config } from "../config.js";
import { getPrimaryEmployee } from "../knowledge/repository.js";
import { detectTopic, startConversationCall } from "../ooo/service.js";
import { getOooStatus } from "../ooo/state.js";
import { log } from "../ooo/activity-log.js";
import { callOfferBlocks } from "./blocks.js";
import { rememberDestination } from "./app.js";

/** Pulls an E.164 number out of free text, if the requester typed one. */
function findPhone(text: string): string | null {
  const match = text.match(/\+[1-9]\d{6,14}/);
  return match ? match[0] : null;
}

export function registerEvents(app: BoltApp): void {
  app.event("app_mention", async ({ event, client }) => {
    const text = (event as { text?: string }).text ?? "";
    const channel = (event as { channel: string }).channel;
    const threadTs = (event as { thread_ts?: string; ts: string }).thread_ts ?? (event as { ts: string }).ts;
    const userId = (event as { user?: string }).user ?? "coworker";

    log(`Received @mention from <@${userId}>: "${text}"`);

    const employee = getPrimaryEmployee();
    const status = getOooStatus(employee.id);

    if (!status.enabled) {
      await client.chat.postMessage({
        channel,
        thread_ts: threadTs,
        text: `${employee.name} is not out of office right now — you can reach them directly.`,
      });
      return;
    }

    // Resolve a friendly requester name for the call.
    let requester = `<@${userId}>`;
    let displayName = "your coworker";
    try {
      const info = await client.users.info({ user: userId });
      displayName = info.user?.profile?.first_name || info.user?.real_name || info.user?.name || displayName;
      requester = displayName;
    } catch {
      /* falls back to the mention */
    }

    const topic = detectTopic(text, employee.id);
    const phone = findPhone(text) ?? config.phones.raj;

    rememberDestination(`channel:${channel}`, { channel });

    try {
      if (!phone) {
        await client.chat.postMessage({
          channel,
          thread_ts: threadTs,
          text:
            "📞 I can call you and walk through the latest project context — " +
            "reply with your number in E.164 format (e.g. `+14155550100`).",
        });
        return;
      }

      await client.chat.postMessage({
        channel,
        thread_ts: threadTs,
        blocks: callOfferBlocks({ employeeName: employee.name, requester, topic, phone }),
        text: `I can call you about ${topic}`,
      });
    } catch (err) {
      // Surfaced here (not just thrown) so a missing chat:write scope or bad
      // channel shows up in the activity log instead of failing silently.
      log(`Failed to respond to @mention: ${(err as Error).message}`, "error");
    }
  });

  app.action("start_ooo_call", async ({ ack, body, client, action }) => {
    await ack();

    const payload = JSON.parse((action as { value: string }).value) as {
      requester: string;
      topic: string;
      phone: string;
    };
    const container = (body as { container?: { channel_id?: string; thread_ts?: string } }).container;
    const channel = container?.channel_id ?? (body as { channel?: { id: string } }).channel?.id ?? "";
    const threadTs = container?.thread_ts;

    log(`"Start Call" clicked for ${payload.requester} (${payload.phone}) — topic: ${payload.topic}`, "call");

    try {
      const result = await startConversationCall({
        requester: payload.requester,
        requesterPhone: payload.phone,
        topic: payload.topic,
        origin: "SLACK",
      });
      // Route call progress and the post-call summary back to this thread.
      rememberDestination(result.conversation.id, { channel, threadTs });
    } catch (err) {
      log(`Failed to start call: ${(err as Error).message}`, "error");
      await client.chat.postMessage({
        channel,
        thread_ts: threadTs,
        text: `⚠️ Could not start the call: ${(err as Error).message}`,
      });
    }
  });

  app.action("change_number", async ({ ack, body, client }) => {
    await ack();
    const channel =
      (body as { container?: { channel_id?: string } }).container?.channel_id ??
      (body as { channel?: { id: string } }).channel?.id ??
      "";
    await client.chat.postMessage({
      channel,
      text: "Mention me again with the number you'd like me to call, e.g. `@OOO update on Phoenix +14155550100`",
    });
  });
}
