/**
 * Lists channels the bot is actually a member of.
 *
 * app_mention events ONLY fire in channels the bot has been invited to
 * (`/invite @YourBot`). Slash commands work everywhere regardless, because
 * they use a response_url rather than channel membership — so `/ooo on`
 * succeeding does not prove the bot can see @mentions in that channel.
 *
 *   npm run check:channels
 */
import { WebClient } from "@slack/web-api";
import { config } from "../src/config.js";

if (!config.slack.botToken) {
  console.error("SLACK_BOT_TOKEN is not set.");
  process.exit(1);
}

const client = new WebClient(config.slack.botToken);
// Private channels need groups:read, which this app does not request — the
// demo only needs public channels the bot has been @invited to.
const res = await client.conversations.list({
  types: "public_channel",
  exclude_archived: true,
  limit: 200,
});

const channels = res.channels ?? [];
const member = channels.filter((c) => c.is_member);
const notMember = channels.filter((c) => !c.is_member);

console.log(`Bot is a member of ${member.length} channel(s):\n`);
for (const c of member) console.log(`  ✓ #${c.name}`);

if (notMember.length) {
  console.log(`\nVisible but NOT a member of ${notMember.length} channel(s) (mentions here won't fire):\n`);
  for (const c of notMember) console.log(`  ✗ #${c.name}`);
}

if (member.length === 0) {
  console.log(
    "\nThe bot is not in any channel. Run `/invite @OOO-Pilot` in the channel you're " +
      "testing in, then mention it again.",
  );
}
