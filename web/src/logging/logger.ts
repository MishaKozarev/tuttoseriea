import "server-only";

export type LogLevel = "debug" | "info" | "warn" | "error";

type JsonValue = boolean | null | number | string | JsonValue[] | { [key: string]: JsonValue };

type LogContext = Record<string, unknown>;

type LogOptions = {
  context?: LogContext;
  requestId?: string | null;
};

const SERVICE = "web";
const REDACTED = "[REDACTED]";
const SENSITIVE_KEY_PATTERN =
  /(^|_|\b)(authorization|api[_-]?key|cookie|database[_-]?url|databaseurl|connection[_-]?string|connectionstring|password|secret|session|token)($|_|\b)/i;
const CONNECTION_STRING_PATTERN =
  /\b(?:postgres|postgresql|mysql|mariadb|mongodb|redis):\/\/[^\s]+/i;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isSensitiveKey(key: string | undefined): boolean {
  return key != null && SENSITIVE_KEY_PATTERN.test(key);
}

function sanitizeString(value: string, key?: string): string {
  if (isSensitiveKey(key) || CONNECTION_STRING_PATTERN.test(value)) {
    return REDACTED;
  }

  return value;
}

function sanitizeContextValue(
  value: unknown,
  key?: string,
  seen: WeakSet<object> = new WeakSet(),
): JsonValue | undefined {
  if (value == null) {
    return null;
  }

  if (typeof value === "string") {
    return sanitizeString(value, key);
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : String(value);
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (value instanceof Error) {
    return {
      name: value.name,
    };
  }

  if (value instanceof URL) {
    return sanitizeString(value.toString(), key);
  }

  if (Array.isArray(value)) {
    return value
      .map((entry) => sanitizeContextValue(entry, key, seen))
      .filter((entry): entry is JsonValue => entry !== undefined);
  }

  if (isPlainRecord(value)) {
    if (seen.has(value)) {
      return "[Circular]";
    }

    seen.add(value);

    const sanitized: Record<string, JsonValue> = {};

    for (const entryKey of Object.keys(value).sort()) {
      const entryValue = sanitizeContextValue(value[entryKey], entryKey, seen);

      if (entryValue !== undefined) {
        sanitized[entryKey] = entryValue;
      }
    }

    seen.delete(value);
    return sanitized;
  }

  return String(value);
}

export function createLogEntry(
  level: LogLevel,
  message: string,
  options: LogOptions = {},
): Record<string, JsonValue> {
  const entry: Record<string, JsonValue> = {
    timestamp: new Date().toISOString(),
    level,
    message,
    service: SERVICE,
    requestId: options.requestId ?? null,
  };

  if (options.context) {
    entry.context = sanitizeContextValue(options.context) ?? {};
  }

  return entry;
}

function writeLog(level: LogLevel, message: string, options: LogOptions = {}): void {
  const line = `${JSON.stringify(createLogEntry(level, message, options))}\n`;

  if (level === "error" || level === "warn") {
    process.stderr.write(line);
    return;
  }

  process.stdout.write(line);
}

export const logger = {
  debug(message: string, options?: LogOptions): void {
    writeLog("debug", message, options);
  },
  error(message: string, options?: LogOptions): void {
    writeLog("error", message, options);
  },
  info(message: string, options?: LogOptions): void {
    writeLog("info", message, options);
  },
  warn(message: string, options?: LogOptions): void {
    writeLog("warn", message, options);
  },
};
