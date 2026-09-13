import { App } from "@slack/bolt";
type BoltApp = App;

import type { KnownBlock } from "@slack/types";
import { config } from "../config.js";
import { getConversation, listConversationItems, getPrimaryEmployee } from "../knowledge/repository.js";
import { onOooEvent } from "../ooo/state.js";
import { completeInboundForConversation } from "../inbound/intake.js";
import { callStartedBlocks, conversationSummaryBlocks, inboundReceivedBlocks } from "./blocks.js";
import { registerCommands } from "./commands.js";
import { registerEvents } from "./events.js";

let app: BoltApp | null = null;

/** Where to post updates for a given conversation. */
interface Destination {
  channel: string;
  threadTs?: string;
}
const destinations = new Map<string, Destination>();

/** Channel used for inbound requests that did not originate in Slack. */
let defaultChannel: string | null = null;

export function rememberDestination(conversationId: string, dest: Destination): void {
  destinations.set(conversationId, dest);
  defaultChannel ??= dest.channel;
}

export function getSlackApp(): BoltApp | null {
  return app;
}

async function post(conversationId: string, blocks: KnownBlock[], fallback: string): Promise<void> {
  if (!app) return;
  const dest = destinations.get(conversationId) ?? (defaultChannel ? { channel: defaultChannel } : null);
  if (!dest) {
    console.log(`[slack] no channel known for ${conversationId}; skipping post.`);
    return;
  }
  try {
    await app.client.chat.postMessage({
      channel: dest.channel,
      thread_ts: dest.threadTs,
      blocks,
      text: fallback,
    });
  } catch (err) {
    console.warn("[slack] post failed:", (err as Error).message);
  }
}

/** Posts to whatever channel the bot last interacted in (for non-Slack inbound). */
async function postLoose(blocks: KnownBlock[], fallback: string): Promise<void> {
  if (!app || !defaultChannel) return;
  try {
    await app.client.chat.postMessage({ channel: defaultChannel, blocks, text: fallback });
  } catch (err) {
    console.warn("[slack] post failed:", (err as Error).message);
  }
}

/** Mirrors OOO lifecycle events into Slack so the channel is the live dashboard. */
function wireEvents(): void {
  onOooEvent(async (event) => {
    switch (event.type) {
      case "inbound_received": {
        const employee = getPrimaryEmployee();
        await postLoose(
          inboundReceivedBlocks({
            requester: event.requester,
            channel: event.channel,
            topic: event.topic,
            employeeName: employee.name,
          }),
          `Inbound request from ${event.requester}`,
        );
        break;
      }
      case "call_started": {
        await post(
          event.conversationId,
          callStartedBlocks({
            requester: event.requester,
            topic: event.topic,
            callId: event.callId,
            inbound: event.inbound,
            warnings: [],
          }),
          `Calling ${event.requester}`,
        );
        break;
      }
      case "call_completed": {
        completeInboundForConversation(event.conversationId);
        const conversation = getConversation(event.conversationId);
        if (!conversation) return;
        await post(
          event.conversationId,
          conversationSummaryBlocks(conversation, listConversationItems(event.conversationId)),
          `Call complete with ${conversation.requester}`,
        );
        break;
      }
      case "call_failed": {
        await post(
          event.conversationId,
          [{ type: "section", text: { type: "mrkdwn", text: `⚠️ *Call could not be completed.*\n${event.reason}` } }],
          "Call failed",
        );
        break;
      }
    }
  });
}

export async function startSlack(): Promise<void> {
  wireEvents();

  if (!config.slack.enabled) {
    console.log("[slack] disabled (set SLACK_BOT_TOKEN and SLACK_APP_TOKEN to enable).");
    return;
  }

  app = new App({
    token: config.slack.botToken,
    appToken: config.slack.appToken,
    signingSecret: config.slack.signingSecret || undefined,
    socketMode: true,
  });

  // Logs the type of every payload Socket Mode delivers, before any specific
  // handler runs. Definitive proof of whether Slack is reaching this process
  // at all — if a mention produces no "incoming:" line here, the problem is
  // on Slack's Event Subscriptions config, not this code.
  app.use(async ({ payload, next }) => {
    const type = (payload as { type?: string })?.type ?? "unknown";
    console.log(`[bolt] incoming: ${type}`);
    await next();
  });

  registerCommands(app);
  registerEvents(app);

  await app.start();
  console.log("[slack] connected in Socket Mode.");
}
