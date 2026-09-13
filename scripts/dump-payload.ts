/**
 * Prints the EXACT payload the pipeline would send to CALL-E, without sending it.
 * Costs zero credits. Use it to compare a failing pipeline call against the
 * known-good payload from scripts/test-call.ts.
 *
 *   npm run dump:payload
 */
import { config } from "../src/config.js";
import { getPrimaryEmployee } from "../src/knowledge/repository.js";
import { buildContext } from "../src/ooo/context-builder.js";
import { buildCallBrief } from "../src/calle/call-builder.js";
import { localeForPhone } from "../src/calle/client.js";

const employee = getPrimaryEmployee();
const ctx = await buildContext({
  employee,
  requester: "Balaji",
  topic: "I need an update on the phoenix launch, can we get on a call?",
});
const brief = buildCallBrief(ctx);
const phone = config.phones.raj;

console.log("=".repeat(70));
console.log("TASK TEXT");
console.log("=".repeat(70));
console.log(brief.task);
console.log("");
console.log("=".repeat(70));
console.log(`task length:        ${brief.task.length} characters`);
console.log(`recipient:          ${JSON.stringify({ phone, ...localeForPhone(phone) })}`);
console.log(`resultSchema keys:  ${Object.keys(brief.resultSchema.properties ?? {}).join(", ")}`);
console.log(`resultSchema bytes: ${JSON.stringify(brief.resultSchema).length}`);
console.log(`safety warnings:    ${brief.safetyViolations.length ? brief.safetyViolations.join("; ") : "none"}`);
console.log("=".repeat(70));
