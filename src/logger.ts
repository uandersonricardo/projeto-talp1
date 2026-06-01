import fs from "node:fs";
import path from "node:path";
import { Writable } from "node:stream";

import winston from "winston";

const logsDir = path.join(process.cwd(), "logs");
fs.mkdirSync(logsDir, { recursive: true });

const runTimestamp = new Date().toISOString().replace(/[:.]/g, "-");

const { combine, colorize, errors, printf, timestamp } = winston.format;

const lineFormat = printf(({ level, message, timestamp: ts, stack }) => {
  const base = `${ts} [${level}] ${message}`;
  return stack ? `${base}\n${stack}` : base;
});

type LogSink = (message: string) => void | Promise<void>;

let activeSink: LogSink | null = null;

export function setLogSink(sink: LogSink): void {
  activeSink = sink;
}

export function clearLogSink(): void {
  activeSink = null;
}

const sinkStream = new Writable({
  write(chunk: Buffer, _encoding: string, callback: () => void) {
    if (activeSink) {
      void activeSink(chunk.toString().trim());
    }
    callback();
  },
});

export interface StepEvent {
  agent: "coder" | "auditor" | "tester";
  step: string;
  status: "running" | "done" | "error" | "skipped";
  detail?: string;
}

type StepSink = (event: StepEvent) => void | Promise<void>;

let activeStepSink: StepSink | null = null;

export function setStepSink(sink: StepSink): void {
  activeStepSink = sink;
}

export function clearStepSink(): void {
  activeStepSink = null;
}

export function emitStep(event: StepEvent): void {
  if (activeStepSink) void activeStepSink(event);
}

export const logger = winston.createLogger({
  level: "debug",
  transports: [
    new winston.transports.Console({
      format: combine(colorize({ all: true }), timestamp({ format: "HH:mm:ss" }), errors({ stack: true }), lineFormat),
    }),
    new winston.transports.File({
      filename: path.join(logsDir, `app-${runTimestamp}.log`),
      format: combine(timestamp(), errors({ stack: true }), lineFormat),
    }),
    new winston.transports.Stream({
      stream: sinkStream,
      level: "info",
      format: winston.format.printf(({ message }) => String(message)),
    }),
  ],
});
