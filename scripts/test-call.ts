/**
 * Places ONE short real CALL-E call to prove the account can dial your number.
 *
 *   npm run test:call -- +919876543210
 *
 * This spends one call from your allowance. It is deliberately minimal: a
 * ~20 second courtesy call, no project context, no database writes. Use it to
 * confirm region support (e.g. +91) and audio quality before the real demo.
 */
import { CalleClient } from "@call-e/calle";
import { config } from "../src/config.js";
import { localeForPhone } from "../src/calle/client.js";
import { isValidPhone } from "../src/safety/policy.js";

const phone = process.argv[2] ?? config.phones.raj;

if (!config.calle.apiKey) {
  console.error("CALLE_API_KEY is not set in .env");
  process.exit(1);
}
if (!isValidPhone(phone)) {
  console.error(`"${phone}" is not a valid E.164 number. Example: +919876543210`);
  process.exit(1);
}

const { region, locale } = localeForPhone(phone);
console.log(`\nPlacing ONE test call to ${phone} (region ${region}, locale ${locale}).`);
console.log("This uses one call from your CALL-E allowance.\n");

const client = new CalleClient({ apiKey: config.calle.apiKey, baseUrl: config.calle.baseUrl });

try {
  const call = await client.calls.createAndWait(
    {
      task:
        "This is a short connectivity test. Say: 'Hi, this is a test call from the OOO-Pilot setup check. " +
        "Can you hear me clearly?' Wait for a yes or no, thank them, and end the call. " +
        "Keep it under twenty seconds. Do not ask for any personal or sensitive information.",
      recipient: { phone, region, locale },
      resultSchema: {
        type: "object",
        required: ["heard_clearly"],
        properties: {
          heard_clearly: { type: "string", enum: ["yes", "no", "unknown"] },
        },
      },
      metadata: { purpose: "ooo_pilot_setup_check" },
    },
    { idempotencyKey: `ooo-test-call:${phone}:${new Date().toISOString().slice(0, 13)}`, timeoutMs: 10 * 60_000 },
  );

  console.log(`Call ${call.id} finished with status: ${call.status}`);
  console.log(`Summary: ${call.summary ?? "(none)"}`);
  console.log(`Structured result: ${JSON.stringify(call.structuredResult)}`);
  if (call.failureCode) console.log(`Failure: ${call.failureCode} — ${call.failureMessage}`);
  console.log("\nIf your phone rang, your account can dial this number. You're clear for the demo.\n");
} catch (err) {
  const message = (err as Error).message;
  console.error(`\nTest call failed: ${message}\n`);
  if (/unsupported_region/i.test(message)) {
    console.error(
      "CALL-E rejected this country. Ask the CALL-E team to enable it, or demo with a supported number.",
    );
  } else if (/insufficient_balance/i.test(message)) {
    console.error("Out of call credits — request more via the hackathon form.");
  } else if (/invalid_phone|invalid_recipient/i.test(message)) {
    console.error("The number was rejected. Check the country code and E.164 formatting.");
  }
  process.exit(1);
}
