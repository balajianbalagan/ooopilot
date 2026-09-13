/**
 * One-shot rehearsal: resets demo state to a known-good starting point.
 *
 * Run this once before every real take (and before the dry run), then start
 * the server separately and drive the rest from Slack.
 *
 *   npm run rehearse
 *
 * What it does:
 *   1. Wipes the SQLite database (fresh start — no leftover conversations,
 *      follow-ups, or OOO state from a previous take).
 *   2. Re-seeds Arun + the Phoenix project.
 *   3. Syncs the live Jira issues (KAN-9..13) if Jira is configured, else
 *      keeps the fictional seed data.
 *   4. Confirms the finale issue (API migration) is still "In Progress" —
 *      if someone accidentally closed it, the discrepancy won't fire.
 *   5. Runs the same checks as `npm run preflight` so a dead credential is
 *      caught now, not mid-recording.
 *
 * Runs everything in-process (no shelling out to npx) so it works the same
 * way on Windows and POSIX shells.
 */
import { existsSync, rmSync } from "node:fs";
import { config } from "../src/config.js";

console.log("=== OOO-Pilot rehearsal reset ===\n");

console.log("1. Clearing previous demo data...");
for (const suffix of ["", "-journal", "-wal", "-shm"]) {
  const path = `${config.dbPath}${suffix}`;
  if (existsSync(path)) rmSync(path);
}
console.log("   done.\n");

console.log("2. Seeding Arun + Phoenix project...");
await import("../src/seed.js");
console.log("");

if (config.jira.enabled) {
  console.log("3. Syncing live Jira issues...");
  const { syncJiraProject } = await import("../src/jira/sync.js");
  const result = await syncJiraProject();
  console.log(`   ${result.message}\n`);

  console.log("4. Checking the finale issue is still In Progress...");
  const { db } = await import("../src/knowledge/sqlite.js");
  const migration = db
    .prepare(
      "SELECT source_id, status FROM knowledge_items WHERE type = 'ISSUE' AND title LIKE '%API migration%'",
    )
    .get() as { source_id: string; status: string } | undefined;
  if (!migration) {
    console.log("   ⚠️  Could not find the API migration issue. The discrepancy finale may not fire.\n");
  } else if (migration.status.toLowerCase() === "in progress") {
    console.log(`   OK — ${migration.source_id} is "In Progress". The finale will fire as expected.\n`);
  } else {
    console.log(
      `   ⚠️  ${migration.source_id} is "${migration.status}", not "In Progress". ` +
        "Transition it back in Jira or the discrepancy will NOT appear.\n",
    );
  }
} else {
  console.log("3. Jira not configured — using fictional seed data (discrepancy still works).\n");
}

console.log("5. Running credential preflight...\n");
await import("./preflight.js");

console.log("\n=== Reset complete. Start the server with `npm start` and drive the rest from Slack. ===");
