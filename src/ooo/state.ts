import { getEmployee, getPrimaryEmployee, setOooState } from "../knowledge/repository.js";
import type { Employee } from "../knowledge/types.js";

export interface OooStatus {
  employee: Employee;
  enabled: boolean;
  startedAt: string | null;
  endsAt: string | null;
}

/** Resolves an explicit employee id, else the single OOO employee for this MVP. */
function resolveEmployee(employeeId?: string): Employee {
  if (employeeId) {
    const found = getEmployee(employeeId);
    if (found) return found;
  }
  return getPrimaryEmployee();
}

export function activateOoo(employeeId?: string, endsAt: string | null = null): OooStatus {
  return toStatus(setOooState(resolveEmployee(employeeId).id, true, endsAt));
}

export function deactivateOoo(employeeId?: string): OooStatus {
  return toStatus(setOooState(resolveEmployee(employeeId).id, false, null));
}

export function getOooStatus(employeeId?: string): OooStatus {
  return toStatus(resolveEmployee(employeeId));
}

function toStatus(employee: Employee): OooStatus {
  return {
    employee,
    enabled: employee.ooo_enabled === 1,
    startedAt: employee.ooo_started_at,
    endsAt: employee.ooo_ends_at,
  };
}

/**
 * Lightweight pub/sub so the OOO service can push call progress to Slack without
 * importing the Slack app (which would create a cycle).
 */
export type OooEvent =
  | { type: "call_started"; conversationId: string; requester: string; callId: string; topic: string; inbound: boolean }
  | { type: "call_completed"; conversationId: string }
  | { type: "call_failed"; conversationId: string; reason: string }
  | { type: "inbound_received"; requestId: string; requester: string; channel: string; topic: string };

type Listener = (event: OooEvent) => void | Promise<void>;
const listeners: Listener[] = [];

export function onOooEvent(listener: Listener): void {
  listeners.push(listener);
}

export function emitOooEvent(event: OooEvent): void {
  for (const listener of listeners) {
    void Promise.resolve(listener(event)).catch((err) =>
      console.warn("[ooo] event listener failed:", (err as Error).message),
    );
  }
}
