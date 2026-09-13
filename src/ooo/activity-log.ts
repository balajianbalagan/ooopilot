/**
 * In-memory activity feed for the admin console.
 *
 * Not persisted — restarting the server clears it, which is fine: this is a
 * live "what is happening right now" trail for the demo, not an audit log.
 * SQLite remains the durable record.
 */
export interface LogEntry {
  id: number;
  ts: string;
  level: "info" | "call" | "warn" | "error";
  message: string;
}

const MAX_ENTRIES = 500;
const entries: LogEntry[] = [];
let seq = 0;

export function log(message: string, level: LogEntry["level"] = "info"): LogEntry {
  const entry: LogEntry = { id: ++seq, ts: new Date().toISOString(), level, message };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.shift();
  const prefix = { info: "  ", call: "☎ ", warn: "⚠ ", error: "✖ " }[level];
  console.log(`[activity] ${prefix}${message}`);
  return entry;
}

/** Entries with id > afterId, for incremental polling from the admin console. */
export function listLogs(afterId = 0): LogEntry[] {
  return entries.filter((e) => e.id > afterId);
}
