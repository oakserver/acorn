// Copyright 2018-2024 the oak authors. All rights reserved.

import {
  type BaseHandler,
  ConsoleHandler,
  type FormatterFunction,
  getLogger as gl,
  type LevelName,
  type Logger,
  type LoggerConfig,
  RotatingFileHandler,
  setup,
} from "@std/log";

export { type Logger } from "@std/log";

/**
 * Options which can be set when configuring file logging on the logger.
 */
export interface FileLoggerOptions {
  /**
   * The log level to log at. The default is `"INFO"`.
   */
  level?: LevelName;
  /**
   * The maximum number of log files to keep. The default is `5`.
   */
  maxBackupCount?: number;
  /**
   * The maximum size of a log file before it is rotated in bytes. The default
   * is 10MB.
   */
  maxBytes?: number;
  /**
   * The path to the log file.
   */
  filename: string;
}

/**
 * Options which can be set when configuring the logger when creating a new
 * router.
 */
export interface LoggerOptions {
  /**
   * Log events to the console. If `true`, log at the "INFO" level. If an
   * object, the `level` can be specified.
   */
  console?: boolean | { level: LevelName };
  /**
   * Log events to a rotating log file. The value should be an object with the
   * `path` to the log file and optionally the `level` to log at. If `level` is
   * not specified, the default is `"INFO"`.
   */
  file?: FileLoggerOptions;
  /**
   * Log events to a stream. The value should be an object with the `stream` to
   * pipe the log events to and optionally the `level` to log at. If `level` is
   * not specified, the default is `"info"`.
   */
  stream?: { level?: LevelName; stream: WritableStream };
}

export const formatter: FormatterFunction = (
  { datetime, levelName, loggerName, msg },
) => `${datetime.toISOString()} [${levelName}] ${loggerName}: ${msg}`;

const mods = [
  "acorn.context",
  "acorn.request_event_cfw",
  "acorn.request_server_bun",
  "acorn.request_server_deno",
  "acorn.request_server_node",
  "acorn.route",
  "acorn.router",
  "acorn.schema",
  "acorn.status_route",
] as const;

type Loggers = typeof mods[number];

export function getLogger(mod: Loggers): Logger {
  return gl(mod);
}

export function configure(options?: LoggerOptions): void {
  const config = {
    handlers: {} as { [key: string]: BaseHandler },
    loggers: {} as { [key: string]: LoggerConfig },
  };
  const handlers: string[] = [];
  if (options) {
    if (options.console) {
      config.handlers.console = new ConsoleHandler(
        typeof options.console === "object" ? options.console.level : "INFO",
        { formatter },
      );
      handlers.push("console");
    }
    if (options.file) {
      const {
        filename,
        maxBackupCount = 5,
        maxBytes = 1024 * 1024 * 10,
        level = "INFO",
      } = options.file;
      config.handlers.file = new RotatingFileHandler(level, {
        filename,
        maxBackupCount,
        maxBytes,
        formatter,
      });
      handlers.push("file");
    }
    if (options.stream) {
      //   sinks.stream = getStreamSink(options.stream.stream);
      //   loggers.push({
      //     category: ["acorn"],
      //     sinks: ["stream"],
      //     level: options.stream.level ?? "info",
      //   });
    }
  } else {
    config.handlers.console = new ConsoleHandler("WARN", { formatter });
    handlers.push("console");
  }
  for (const mod of mods) {
    config.loggers[mod] = { level: "DEBUG", handlers };
  }
  setup(config);
}
