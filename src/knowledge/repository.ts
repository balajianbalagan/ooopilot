import { db, newId, nowIso } from "./sqlite.js";
import type {
  Conversation,
  ConversationItem,
  Employee,
  Followup,
  InboundRequest,
  KnowledgeItem,
  Project,
} from "./types.js";

// ---------- employees ----------
export function getEmployee(id: string): Employee | undefined {
  return db.prepare("SELECT * FROM employees WHERE id = ?").get(id) as Employee | undefined;
}

export function getEmployeeBySlackId(slackUserId: string): Employee | undefined {
  return db.prepare("SELECT * FROM employees WHERE slack_user_id = ?").get(slackUserId) as
    | Employee
    | undefined;
}

/** The single OOO employee for this MVP; falls back to the first employee. */
export function getPrimaryEmployee(): Employee {
  const active = db.prepare("SELECT * FROM employees WHERE ooo_enabled = 1 LIMIT 1").get() as
    | Employee
    | undefined;
  if (active) return active;
  return db.prepare("SELECT * FROM employees LIMIT 1").get() as Employee;
}

export function setOooState(
  employeeId: string,
  enabled: boolean,
  endsAt: string | null = null,
): Employee {
  db.prepare(
    `UPDATE employees
        SET ooo_enabled = ?,
            ooo_started_at = CASE WHEN ? = 1 THEN ? ELSE ooo_started_at END,
            ooo_ends_at = ?
      WHERE id = ?`,
  ).run(enabled ? 1 : 0, enabled ? 1 : 0, nowIso(), endsAt, employeeId);
  return getEmployee(employeeId)!;
}

// ---------- projects ----------
export function getProject(id: string): Project | undefined {
  return db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as Project | undefined;
}

export function getProjectForEmployee(employeeId: string): Project | undefined {
  return db.prepare("SELECT * FROM projects WHERE owner_id = ? LIMIT 1").get(employeeId) as
    | Project
    | undefined;
}

// ---------- knowledge ----------
export interface UpsertKnowledgeInput {
  employeeId: string | null;
  projectId: string | null;
  type: string;
  title: string;
  content: string;
  sourceType: KnowledgeItem["source_type"];
  sourceId: string;
  sourceUrl?: string | null;
  status?: string | null;
  confidence?: number;
  verified?: boolean;
  updatedAt?: string;
}

/** Insert or update by (source_type, source_id) so re-syncing Jira is idempotent. */
export function upsertKnowledgeItem(input: UpsertKnowledgeInput): void {
  const ts = input.updatedAt ?? nowIso();
  db.prepare(
    `INSERT INTO knowledge_items
       (id, employee_id, project_id, type, title, content, source_type, source_id,
        source_url, status, confidence, verified, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(source_type, source_id) DO UPDATE SET
       title = excluded.title,
       content = excluded.content,
       status = excluded.status,
       source_url = excluded.source_url,
       confidence = excluded.confidence,
       verified = excluded.verified,
       updated_at = excluded.updated_at`,
  ).run(
    newId("kn"),
    input.employeeId,
    input.projectId,
    input.type,
    input.title,
    input.content,
    input.sourceType,
    input.sourceId,
    input.sourceUrl ?? null,
    input.status ?? null,
    input.confidence ?? 1.0,
    input.verified === false ? 0 : 1,
    ts,
    ts,
  );
}

export function deleteKnowledgeBySource(sourceType: string, sourceId: string): void {
  db.prepare("DELETE FROM knowledge_items WHERE source_type = ? AND source_id = ?").run(
    sourceType,
    sourceId,
  );
}

export function listKnowledge(
  opts: { employeeId?: string; sourceType?: string; limit?: number } = {},
): KnowledgeItem[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.employeeId) {
    where.push("employee_id = ?");
    params.push(opts.employeeId);
  }
  if (opts.sourceType) {
    where.push("source_type = ?");
    params.push(opts.sourceType);
  }
  const sql = `SELECT * FROM knowledge_items
               ${where.length ? "WHERE " + where.join(" AND ") : ""}
               ORDER BY updated_at DESC LIMIT ?`;
  params.push(opts.limit ?? 50);
  return db.prepare(sql).all(...params) as KnowledgeItem[];
}

/** Keyword search over title+content. Deliberately simple: no vectors, no RAG. */
export function searchKnowledge(employeeId: string, query: string, limit = 12): KnowledgeItem[] {
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9-]+/i)
    .filter((t) => t.length > 2)
    .slice(0, 8);

  const rows = db
    .prepare("SELECT * FROM knowledge_items WHERE employee_id = ? ORDER BY updated_at DESC LIMIT 200")
    .all(employeeId) as KnowledgeItem[];

  if (terms.length === 0) return rows.slice(0, limit);

  const scored = rows.map((row) => {
    const haystack = `${row.title ?? ""} ${row.content}`.toLowerCase();
    let score = terms.reduce((acc, term) => acc + (haystack.includes(term) ? 1 : 0), 0);
    if (row.source_type === "JIRA") score += 0.5; // Jira is authoritative
    return { row, score };
  });

  const hits = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
  return (hits.length ? hits : scored).slice(0, limit).map((s) => s.row);
}

// ---------- conversations ----------
export function createConversation(input: {
  employeeId: string;
  requester: string;
  requesterPhone?: string | null;
  topic: string;
  direction?: Conversation["direction"];
  origin?: string;
}): Conversation {
  const id = newId("conv");
  db.prepare(
    `INSERT INTO conversations
      (id, employee_id, requester, requester_phone, topic, direction, origin, started_at, status)
     VALUES (?,?,?,?,?,?,?,?,'PENDING')`,
  ).run(
    id,
    input.employeeId,
    input.requester,
    input.requesterPhone ?? null,
    input.topic,
    input.direction ?? "OUTBOUND",
    input.origin ?? "SLACK",
    nowIso(),
  );
  return getConversation(id)!;
}

export function getConversation(id: string): Conversation | undefined {
  return db.prepare("SELECT * FROM conversations WHERE id = ?").get(id) as Conversation | undefined;
}

export function getConversationByCallId(callId: string): Conversation | undefined {
  return db.prepare("SELECT * FROM conversations WHERE call_id = ?").get(callId) as
    | Conversation
    | undefined;
}

export function updateConversation(id: string, patch: Partial<Conversation>): void {
  const allowed = [
    "status",
    "summary",
    "transcript",
    "call_id",
    "ended_at",
    "confidence",
    "raw_result",
    "topic",
  ] as const;
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const key of allowed) {
    if (patch[key] !== undefined) {
      sets.push(`${key} = ?`);
      params.push(patch[key]);
    }
  }
  if (!sets.length) return;
  params.push(id);
  db.prepare(`UPDATE conversations SET ${sets.join(", ")} WHERE id = ?`).run(...params);
}

export function listConversations(employeeId: string, since?: string | null): Conversation[] {
  if (since) {
    return db
      .prepare(
        "SELECT * FROM conversations WHERE employee_id = ? AND started_at >= ? ORDER BY started_at ASC",
      )
      .all(employeeId, since) as Conversation[];
  }
  return db
    .prepare("SELECT * FROM conversations WHERE employee_id = ? ORDER BY started_at DESC LIMIT 25")
    .all(employeeId) as Conversation[];
}

/**
 * Conversations whose CALL-E task has not reached a terminal state.
 *
 * CALL-E's shared outbound line allows only ONE concurrent task per account,
 * so a second call placed while one is in flight is rejected — and still costs
 * credits. Callers use this to refuse the second call locally instead.
 */
export function listActiveConversations(employeeId: string): Conversation[] {
  return db
    .prepare(
      "SELECT * FROM conversations WHERE employee_id = ? AND status = 'IN_PROGRESS' ORDER BY started_at DESC",
    )
    .all(employeeId) as Conversation[];
}

export function addConversationItem(input: {
  conversationId: string;
  type: ConversationItem["type"];
  content: string;
  source?: string | null;
  confidence?: number;
}): void {
  db.prepare(
    `INSERT INTO conversation_items (id, conversation_id, type, content, source, confidence, created_at)
     VALUES (?,?,?,?,?,?,?)`,
  ).run(
    newId("ci"),
    input.conversationId,
    input.type,
    input.content,
    input.source ?? null,
    input.confidence ?? 0.5,
    nowIso(),
  );
}

export function listConversationItems(conversationId: string): ConversationItem[] {
  return db
    .prepare("SELECT * FROM conversation_items WHERE conversation_id = ? ORDER BY created_at ASC")
    .all(conversationId) as ConversationItem[];
}

export function listConversationItemsForEmployee(
  employeeId: string,
  type: ConversationItem["type"],
  since?: string | null,
): ConversationItem[] {
  return db
    .prepare(
      `SELECT ci.* FROM conversation_items ci
         JOIN conversations c ON c.id = ci.conversation_id
        WHERE c.employee_id = ? AND ci.type = ? AND (? IS NULL OR c.started_at >= ?)
        ORDER BY ci.created_at ASC`,
    )
    .all(employeeId, type, since ?? null, since ?? null) as ConversationItem[];
}

// ---------- followups ----------
export function createFollowup(input: {
  employeeId: string;
  conversationId?: string | null;
  requester?: string | null;
  projectId?: string | null;
  content: string;
  priority?: string;
}): Followup {
  const id = newId("fu");
  db.prepare(
    `INSERT INTO followups
       (id, employee_id, conversation_id, requester, project_id, content, priority, status, created_at)
     VALUES (?,?,?,?,?,?,?,'open',?)`,
  ).run(
    id,
    input.employeeId,
    input.conversationId ?? null,
    input.requester ?? null,
    input.projectId ?? null,
    input.content,
    input.priority ?? "normal",
    nowIso(),
  );
  return db.prepare("SELECT * FROM followups WHERE id = ?").get(id) as Followup;
}

export function listOpenFollowups(employeeId: string, since?: string | null): Followup[] {
  return db
    .prepare(
      `SELECT * FROM followups
        WHERE employee_id = ? AND status = 'open' AND (? IS NULL OR created_at >= ?)
        ORDER BY created_at DESC`,
    )
    .all(employeeId, since ?? null, since ?? null) as Followup[];
}

// ---------- inbound requests ----------
export function createInboundRequest(input: {
  employeeId: string;
  channel: string;
  fromIdentifier: string;
  requesterName?: string | null;
  topic?: string | null;
}): InboundRequest {
  const id = newId("in");
  db.prepare(
    `INSERT INTO inbound_requests
       (id, employee_id, channel, from_identifier, requester_name, topic, status, created_at)
     VALUES (?,?,?,?,?,?,'RECEIVED',?)`,
  ).run(
    id,
    input.employeeId,
    input.channel,
    input.fromIdentifier,
    input.requesterName ?? null,
    input.topic ?? null,
    nowIso(),
  );
  return db.prepare("SELECT * FROM inbound_requests WHERE id = ?").get(id) as InboundRequest;
}

export function updateInboundRequest(
  id: string,
  patch: { status?: string; conversationId?: string | null; answeredAt?: string | null },
): void {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.status !== undefined) {
    sets.push("status = ?");
    params.push(patch.status);
  }
  if (patch.conversationId !== undefined) {
    sets.push("conversation_id = ?");
    params.push(patch.conversationId);
  }
  if (patch.answeredAt !== undefined) {
    sets.push("answered_at = ?");
    params.push(patch.answeredAt);
  }
  if (!sets.length) return;
  params.push(id);
  db.prepare(`UPDATE inbound_requests SET ${sets.join(", ")} WHERE id = ?`).run(...params);
}

export function listInboundRequests(employeeId: string, since?: string | null): InboundRequest[] {
  return db
    .prepare(
      `SELECT * FROM inbound_requests
        WHERE employee_id = ? AND (? IS NULL OR created_at >= ?)
        ORDER BY created_at DESC LIMIT 50`,
    )
    .all(employeeId, since ?? null, since ?? null) as InboundRequest[];
}
