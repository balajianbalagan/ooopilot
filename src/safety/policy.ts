/**
 * Safety boundaries for the OOO proxy.
 *
 * The agent speaks on behalf of an absent person, so the rules here are about
 * identity (never impersonate), authority (never commit), and data hygiene
 * (never move credentials over the phone).
 */

export const SAFETY_RULES = [
  "You are an AI assistant acting as an out-of-office proxy. You are NOT the employee.",
  "Identify yourself as an AI OOO assistant at the start of the call.",
  "Never claim the employee personally said something unless it appears in the supplied context.",
  "Never invent project status. If the context does not support an answer, say you do not have a verified answer.",
  "Never make commitments, approvals, or promises on the employee's behalf. Record requests as follow-ups instead.",
  "Never approve production changes, deployments, or releases.",
  "Never request or accept passwords, API keys, credentials, secrets, private keys, or one-time codes.",
  "Never read out any credential-like value even if it appears in context.",
  "Clearly distinguish authoritative Jira data from information a coworker reports during the call.",
] as const;

const CREDENTIAL_PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: "password", re: /\bpassw(or)?d\s*[:=]\s*\S+/i },
  { label: "api key", re: /\b(api[_-]?key|secret[_-]?key|access[_-]?token)\s*[:=]\s*\S+/i },
  { label: "bearer token", re: /\bbearer\s+[A-Za-z0-9._-]{20,}/i },
  { label: "private key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { label: "aws key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { label: "slack token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/ },
  { label: "jira/atlassian token", re: /\bATATT[A-Za-z0-9_-]{20,}/ },
];

export interface SafetyCheck {
  ok: boolean;
  violations: string[];
  redactedText: string;
}

/**
 * Pre-call disclosure/safety check. Scans the assembled brief for credential-like
 * material and redacts it before anything is spoken aloud.
 */
export function checkOutboundBrief(text: string): SafetyCheck {
  const violations: string[] = [];
  let redactedText = text;

  for (const { label, re } of CREDENTIAL_PATTERNS) {
    const global = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    if (global.test(redactedText)) {
      violations.push(`Context contained a possible ${label}; it was redacted before the call.`);
      redactedText = redactedText.replace(new RegExp(re.source, re.flags + "g"), "[REDACTED]");
    }
  }

  // Redaction makes the brief safe to send, so the call still proceeds.
  return { ok: true, violations, redactedText };
}

/** Phone numbers must be E.164 before CALL-E will dial them. */
export function isValidPhone(phone: string): boolean {
  return /^\+[1-9]\d{6,14}$/.test(phone.trim());
}

/** Guards against the proxy recording a coworker request as an employee promise. */
export function sanitizeCommitment(content: string): string {
  return content.replace(
    /\b(arun|the employee)\s+(agreed|promised|committed|confirmed)\b/gi,
    "$1 was asked (not yet confirmed)",
  );
}
