export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogContext = {
  correlationId?: string;
  [key: string]: unknown;
};

export function createCorrelationId(): string {
  return crypto.randomUUID();
}

export function log(level: LogLevel, message: string, context: LogContext = {}): void {
  const entry = {
    level,
    message,
    time: new Date().toISOString(),
    ...context
  };

  const line = JSON.stringify(entry);
  if (level === "error") {
    console.error(line);
    return;
  }
  console.log(line);
}
