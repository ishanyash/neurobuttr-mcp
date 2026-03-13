import { randomUUID } from "node:crypto";

export function generateId(): string {
  return randomUUID();
}

export function now(): number {
  return Date.now();
}

export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "...";
}
