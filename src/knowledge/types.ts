export type SourceType = "JIRA" | "SLACK" | "CONVERSATION" | "MANUAL" | "GIT";

export interface KnowledgeItem {
  id: string;
  employee_id: string | null;
  project_id: string | null;
  type: string | null;
  title: string | null;
  content: string;
  source_type: SourceType;
  source_id: string | null;
  source_url: string | null;
  status: string | null;
  confidence: number;
  verified: number;
  created_at: string;
  updated_at: string;
}

export interface Employee {
  id: string;
  name: string;
  role: string | null;
  phone: string | null;
  slack_user_id: string | null;
  ooo_enabled: number;
  ooo_started_at: string | null;
  ooo_ends_at: string | null;
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  jira_project_key: string | null;
  owner_id: string | null;
}

export interface Conversation {
  id: string;
  employee_id: string;
  requester: string;
  requester_phone: string | null;
  topic: string | null;
  direction: "OUTBOUND" | "INBOUND_CALLBACK";
  origin: string;
  started_at: string | null;
  ended_at: string | null;
  status: string;
  summary: string | null;
  transcript: string | null;
  call_id: string | null;
  confidence: number | null;
  raw_result: string | null;
}

export interface ConversationItem {
  id: string;
  conversation_id: string;
  type:
    | "QUESTION"
    | "ANSWER"
    | "NEW_INFORMATION"
    | "FOLLOW_UP"
    | "COMMITMENT"
    | "DECISION"
    | "UNRESOLVED";
  content: string;
  source: string | null;
  confidence: number;
  created_at: string;
}

export interface Followup {
  id: string;
  employee_id: string;
  conversation_id: string | null;
  requester: string | null;
  project_id: string | null;
  content: string;
  priority: string;
  status: string;
  created_at: string;
}

export interface InboundRequest {
  id: string;
  employee_id: string;
  channel: string;
  from_identifier: string;
  requester_name: string | null;
  topic: string | null;
  status: string;
  conversation_id: string | null;
  created_at: string;
  answered_at: string | null;
}

/** A knowledge source that can be searched for an employee's work context. */
export interface KnowledgeProvider {
  readonly name: string;
  search(employeeId: string, query: string): Promise<KnowledgeItem[]>;
}
