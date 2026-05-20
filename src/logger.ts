import fs from "node:fs";
import path from "node:path";

import winston from "winston";

const logsDir = path.join(process.cwd(), "logs");
fs.mkdirSync(logsDir, { recursive: true });

const runTimestamp = new Date().toISOString().replace(/[:.]/g, "-");

const { combine, colorize, errors, printf, timestamp } = winston.format;

const lineFormat = printf(({ level, message, timestamp: ts, stack }) => {
  const base = `${ts} [${level}] ${message}`;
  return stack ? `${base}\n${stack}` : base;
});

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
  ],
});
