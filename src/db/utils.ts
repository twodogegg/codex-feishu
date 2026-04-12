export function getNowTimestamp(): string {
  return new Date().toISOString();
}

export function parseJsonObject<T extends Record<string, unknown>>(
  value: string | null | undefined
): T {
  if (!value) {
    return {} as T;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return isPlainObject(parsed) ? (parsed as T) : ({} as T);
  } catch {
    return {} as T;
  }
}

export function stringifyJsonObject(
  value: Record<string, unknown> | undefined
): string {
  return JSON.stringify(value ?? {});
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
