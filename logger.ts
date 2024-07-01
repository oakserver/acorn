// Copyright 2018-2024 the oak authors. All rights reserved.

import {
  configure,
  getConsoleSink,
  getRotatingFileSink,
  getStreamSink,
  type LoggerConfig,
  type LogLevel,
  type Sink,
} from "@logtape/logtape";

/**
 * Options which can be set when configuring file logging on the logger.
 */
export interface FileLoggerOptions {
  /**
   * The log level to log at. The default is `"info"`.
   */
  level?: LogLevel;
  /**
   * The maximum number of log files to keep. The default is `5`.
   */
  maxFiles?: number;
  /**
   * The maximum size of a log file before it is rotated in bytes. The default
   * is 10MB.
   */
  maxSize?: number;
  /**
   * The path to the log file.
   */
  path: string;
}

/**
 * Options which can be set when configuring the logger when creating a new
 * router.
 */
export interface LoggerOptions {
  /**
   * Log events to the console. If `true`, log at the "info" level. If an
   * object, the `level` can be specified.
   */
  console?: boolean | { level: LogLevel };
  /**
   * Log events to a rotating log file. The value should be an object with the
   * `path` to the log file and optionally the `level` to log at. If `level` is
   * not specified, the default is `"info"`.
   */
  file?: FileLoggerOptions;
  /**
   * Log events to a stream. The value should be an object with the `stream` to
   * pipe the log events to and optionally the `level` to log at. If `level` is
   * not specified, the default is `"info"`.
   */
  stream?: { level?: LogLevel; stream: WritableStream };
}

export function configureLogger(options?: LoggerOptions): Promise<void> {
  const sinks: Record<string, Sink> = {};
  const loggers: LoggerConfig<"console" | "file" | "stream", string>[] = [];
  sinks.console = getConsoleSink();
  loggers.push({ category: "logtape", level: "warning", sinks: ["console"] });
  if (options) {
    if (options.console) {
      loggers.push({
        category: ["acorn"],
        sinks: ["console"],
        level: options.console === true ? "info" : options.console.level,
      });
    }
    if (options.file) {
      sinks.file = getRotatingFileSink(options.file.path, {
        maxFiles: options.file.maxFiles ?? 5,
        maxSize: options.file.maxSize ?? 1_024 * 1_024 * 10,
      });
      loggers.push({
        category: ["acorn"],
        sinks: ["file"],
        level: options.file.level ?? "info",
      });
    }
    if (options.stream) {
      sinks.stream = getStreamSink(options.stream.stream);
      loggers.push({
        category: ["acorn"],
        sinks: ["stream"],
        level: options.stream.level ?? "info",
      });
    }
  } else {
    sinks.console = getConsoleSink();
    loggers.push({ category: "acorn", level: "warning", sinks: ["console"] });
  }
  return configure({ sinks, filters: {}, loggers });
}
