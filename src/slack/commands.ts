import type { App as BoltApp } from "@slack/bolt";

import { config } from "../config.js";
import {
  getPrimaryEmployee,
  getProjectForEmployee,
  listConversations,
  listOpenFollowups,
} from "../knowledge/repository.js";
import { activateOoo, deactivateOoo, getOooStatus } from "../ooo/state.js";
import { buildReturnSummary, renderReturnSummary } from "../ooo/return-summary.js";
import { syncJiraProject } from "../jira/sync.js";
import { log } from "../ooo/activity-log.js";
import { oooActivatedBlocks, oooStatusBlocks, returnSummaryBlocks } from "./blocks.js";
import { rememberDestination } from "./app.js";

export function registerCommands(app: BoltApp): void {
  app.command("/ooo", async ({ command, ack, respond }) => {
    await ack();

    const sub = (command.text ?? "").trim().toLowerCase().split(/\s+/)[0] || "status";
    const employee = getPrimaryEmployee();
    const project = getProjectForEmployee(employee.id) ?? null;

    // Remember this channel so inbound (non-Slack) callbacks have somewhere to report.
    rememberDestination(`channel:${command.channel_id}`, { channel: command.channel_id });

    if (sub === "on") {
      activateOoo(employee.id);
      log(`${employee.name} activated OOO mode via Slack.`);

      // Refresh Jira in the background so the first call has current context.
      void syncJiraProject()
        .then((r) => log(r.message))
        .catch((e) => log(`Jira sync failed: ${e.message}`, "error"));

      await respond({
        response_type: "in_channel",
        blocks: oooActivatedBlocks(employee, project),
        text: `OOO Mode activated for ${employee.name}`,
      });
      return;
    }

    if (sub === "off") {
      const summary = buildReturnSummary(employee);
      deactivateOoo(employee.id);
      log(
        `${employee.name} returned from OOO via Slack — ${summary.conversationCount} conversation(s), ` +
          `${summary.discrepancies.length} discrepancy(ies) flagged.`,
      );
      const markdown = renderReturnSummary(summary);
      await respond({
        response_type: "in_channel",
        blocks: returnSummaryBlocks(markdown),
        text: `Welcome back, ${employee.name}`,
      });
      return;
    }

    if (sub === "sync") {
      const result = await syncJiraProject();
      log(result.message);
      await respond({ response_type: "ephemeral", text: `🔄 ${result.message}` });
      return;
    }

    const status = getOooStatus(employee.id);
    await respond({
      response_type: "ephemeral",
      blocks: oooStatusBlocks(employee, status.enabled, status.startedAt, project, {
        conversations: listConversations(employee.id, status.startedAt).filter(
          (c) => c.status === "COMPLETED",
        ).length,
        followups: listOpenFollowups(employee.id, status.startedAt).length,
      }),
      text: `OOO status for ${employee.name}`,
    });
  });

  /** Lets a coworker register the number OOO-Pilot should ring. */
  app.command("/ooo-callme", async ({ command, ack, respond }) => {
    await ack();
    const phone = (command.text ?? "").trim() || config.phones.raj;
    await respond({
      response_type: "ephemeral",
      text: phone
        ? `I'll use \`${phone}\` when you ask for a call. Mention me with your question to start.`
        : "Set RAJ_PHONE in .env or pass a number: `/ooo-callme +14155550100`",
    });
  });
}
