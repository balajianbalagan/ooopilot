/**
 * Fetches the full CALL-E call record for debugging a failed/odd call.
 *
 *   npm run inspect:call -- call_u9SzmuxpP-XwahyG5XngfA
 */
import { CalleClient } from "@call-e/calle";
import { config } from "../src/config.js";

const callId = process.argv[2];
if (!callId) {
  console.error("Usage: npm run inspect:call -- <call_id>");
  process.exit(1);
}
if (!config.calle.apiKey) {
  console.error("CALLE_API_KEY is not set.");
  process.exit(1);
}

const client = new CalleClient({ apiKey: config.calle.apiKey, baseUrl: config.calle.baseUrl });
const call = await client.calls.get(callId);

console.log(`Call ${call.id}`);
console.log(`  status: ${call.status}`);
console.log(`  failureCode: ${call.failureCode}`);
console.log(`  failureMessage: ${call.failureMessage}`);
console.log(`  createdAt: ${call.createdAt}`);
console.log(`  completedAt: ${call.completedAt}`);
console.log("");

for (const recipient of call.recipients) {
  console.log(`Recipient ${recipient.id} (${recipient.phones.join(", ")}) — ${recipient.status}`);
  for (const attempt of recipient.attempts) {
    console.log(`  Attempt ${attempt.id}`);
    console.log(`    status: ${attempt.status}`);
    console.log(`    startedAt: ${attempt.startedAt}`);
    console.log(`    completedAt: ${attempt.completedAt}`);
    if (attempt.startedAt && attempt.completedAt) {
      const seconds = (new Date(attempt.completedAt).getTime() - new Date(attempt.startedAt).getTime()) / 1000;
      console.log(`    duration: ${seconds}s`);
    }
    console.log(`    providerCallId: ${attempt.providerCallId}`);
    console.log(`    failureCode: ${attempt.failureCode}`);
    console.log(`    failureMessage: ${attempt.failureMessage}`);
    console.log(`    transcript turns: ${attempt.transcriptTurns.length}`);
    for (const turn of attempt.transcriptTurns) {
      console.log(`      [${turn.offset_seconds}s] ${turn.speaker}: ${turn.text}`);
    }
  }
}
