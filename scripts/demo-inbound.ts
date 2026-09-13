/**
 * End-to-end rehearsal of the whole pipeline without Slack.
 *
 * Run with CALLE_DRY_RUN=true to exercise context -> call -> extraction ->
 * SQLite -> return summary using the built-in stand-in call, or with a real
 * CALLE_API_KEY to place an actual phone call.
 *
 *   npm run demo:inbound
 */
import { config } from "../src/config.js";
import { handleInboundRequest } from "../src/inbound/intake.js";
import { getPrimaryEmployee, listConversationItems, listConversations } from "../src/knowledge/repository.js";
import { activateOoo } from "../src/ooo/state.js";
import { buildReturnSummary, renderReturnSummary } from "../src/ooo/return-summary.js";

const phone = process.argv[2] ?? config.phones.raj ?? "+14155550100";

const employee = getPrimaryEmployee();
activateOoo(employee.id);
console.log(`🟢 OOO activated for ${employee.name}\n`);

console.log(`📲 Simulating an inbound call to ${employee.name}'s OOO line from ${phone}...`);
const outcome = await handleInboundRequest({
  channel: "PHONE_INTAKE",
  from: phone,
  requesterName: "Raj",
  topic: "Phoenix launch status",
});
console.log(`   -> ${outcome.message}`);

if (!outcome.accepted) process.exit(1);

// Give the dry-run / real call time to finalize.
const waitMs = config.calle.dryRun ? 500 : 10 * 60_000;
await new Promise((resolve) => setTimeout(resolve, config.calle.dryRun ? waitMs : 5_000));

if (!config.calle.dryRun) {
  console.log("\nA real call is in flight. Watch the server logs; the summary lands when it ends.");
  process.exit(0);
}

const conversation = listConversations(employee.id)[0];
console.log(`\n📝 Conversation ${conversation.id} (${conversation.direction}) — ${conversation.status}`);
console.log(`   Summary: ${conversation.summary}\n`);

console.log("   Extracted items:");
for (const item of listConversationItems(conversation.id)) {
  console.log(`   [${item.type}] ${item.content}${item.source ? `  (${item.source})` : ""}`);
}

console.log("\n" + "=".repeat(70));
console.log(renderReturnSummary(buildReturnSummary(employee)).replace(/\*/g, ""));
