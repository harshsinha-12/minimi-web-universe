import { createRequire } from "node:module";
import { hostname } from "node:os";
import { config as loadEnv } from "dotenv";
import pino, { type DestinationStream, type Level, type Logger } from "pino";

loadEnv({ path: [".env.local", ".env"], quiet: true });

const levels = new Set<Level>([
  "fatal",
  "error",
  "warn",
  "info",
  "debug",
  "trace",
]);

function logLevel(): Level {
  const requested = (process.env.LOG_LEVEL || "info").toLowerCase();
  return levels.has(requested as Level) ? (requested as Level) : "info";
}

function wantPretty() {
  if (process.env.NEXT_RUNTIME) return false;
  if (process.env.LOG_PRETTY === "false") return false;
  if (process.env.LOG_PRETTY === "true") return true;
  return process.env.NODE_ENV !== "production" && process.stdout.isTTY;
}

function prettyStream(): DestinationStream | undefined {
  if (!wantPretty()) return undefined;
  try {
    const require = createRequire(import.meta.url);
    const pretty = require("pino-pretty") as (
      options?: object,
    ) => DestinationStream;
    return pretty({
      colorize: true,
      translateTime: "SYS:HH:MM:ss",
      ignore: "pid,hostname",
    });
  } catch {
    return undefined;
  }
}

const options = {
  level: logLevel(),
  base: { service: "minimi", pid: process.pid, hostname: hostname() },
  redact: {
    paths: [
      "password",
      "apiKey",
      "authorization",
      "cookie",
      "headers.authorization",
      "headers.cookie",
      "req.headers.authorization",
      "req.headers.cookie",
    ],
    censor: "[redacted]",
  },
};

const stream = prettyStream();
export const logger: Logger = stream ? pino(options, stream) : pino(options);

export function componentLogger(component: string) {
  return logger.child({ component });
}
