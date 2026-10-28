import Decimal from "decimal.js";
export class DomainError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
export function requireRule(
  condition: unknown,
  code: string,
  message: string,
  status = 422,
  details?: unknown,
): asserts condition {
  if (!condition) throw new DomainError(status, code, message, details);
}
export function quantitySum(values: (string | null)[]) {
  return {
    confirmed: values
      .filter((v) => v !== null)
      .reduce((s, v) => s.plus(v!), new Decimal(0))
      .toFixed(),
    unconfirmed: values.filter((v) => v === null).length,
  };
}
export function businessDate(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
export function canonical(value: any): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .filter((k) => value[k] !== undefined)
        .map((k) => JSON.stringify(k) + ":" + canonical(value[k]))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
export const stages = [
  "selected",
  "picking",
  "packing",
  "checking",
  "ready",
] as const;

export * from './inventory.js';
export * from './inbound.js';
export * from './tasks.js';
export * from './transfers.js';
export * from './imports.js';
export * from './onboarding.js';
export * from './picking.js';
export * from './transport.js';
export * from './orders.js';
export * from './documents.js';
export * from './scheduling.js';
export * from './pallet-groups.js';
export * from './services.js';
