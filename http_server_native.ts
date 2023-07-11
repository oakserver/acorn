// Copyright 2022 the oak authors. All rights reserved.

import {
  type Addr,
  type HttpConn,
  type Listener,
  type RequestEvent,
  type Server,
} from "./types.ts";
import { assert } from "./util.ts";

const serveHttp =
  ("serveHttp" in Deno ? Deno.serveHttp.bind(Deno) : undefined) as (
    conn: Deno.Conn,
  ) => HttpConn;

function isListenTlsOptions(value: unknown): value is Deno.ListenTlsOptions {
  return typeof value === "object" && value !== null && "certFile" in value &&
    "keyFile" in value && "port" in value;
}

/** An abstraction for Deno's built in HTTP Server that is used to manage
 * HTTP requests in a uniform way. */
export class NativeHttpServer implements Server {
  #closed = false;
  #errorTarget: EventTarget;
  #httpConnections = new Set<HttpConn>();
  #listener?: Deno.Listener;
  #options: Deno.ListenOptions | Deno.ListenTlsOptions;

  #track(httpConn: HttpConn): void {
    this.#httpConnections.add(httpConn);
  }

  #untrack(httpConn: HttpConn): void {
    this.#httpConnections.delete(httpConn);
  }

  get closed(): boolean {
    return this.#closed;
  }

  constructor(
    errorTarget: EventTarget,
    options: Deno.ListenOptions | Deno.ListenTlsOptions,
  ) {
    this.#errorTarget = errorTarget;
    this.#options = options;
  }

  close(): void {
    this.#closed = true;

    if (this.#listener) {
      this.#listener.close();
      this.#listener = undefined;
    }

    for (const httpConn of this.#httpConnections) {
      try {
        httpConn.close();
      } catch (error) {
        if (!(error instanceof Deno.errors.BadResource)) {
          throw error;
        }
      }
    }

    this.#httpConnections.clear();
  }

  listen(): Listener {
    return (this.#listener = isListenTlsOptions(this.#options)
      ? Deno.listenTls(this.#options)
      : Deno.listen(this.#options)) as Listener;
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<[RequestEvent, Addr]> {
    const start: ReadableStreamDefaultControllerCallback<
      [RequestEvent, Addr]
    > = (
      controller,
    ) => {
      // deno-lint-ignore no-this-alias
      const server = this;
      async function serve(conn: Deno.Conn) {
        const httpConn = serveHttp(conn);
        server.#track(httpConn);

        while (true) {
          try {
            const requestEvent = await httpConn.nextRequest();
            if (requestEvent === null) {
              return;
            }

            controller.enqueue([requestEvent, conn.remoteAddr as Addr]);
          } catch (error) {
            server.#errorTarget.dispatchEvent(
              new ErrorEvent("error", { error }),
            );
          }

          if (server.closed) {
            server.#untrack(httpConn);
            httpConn.close();
            controller.close();
          }
        }
      }

      const listener = this.#listener;

      async function accept() {
        assert(listener);
        while (true) {
          try {
            const conn = await listener.accept();
            serve(conn);
          } catch (error) {
            if (!server.closed) {
              server.#errorTarget.dispatchEvent(
                new ErrorEvent("error", { error }),
              );
            }
          }
          if (server.closed) {
            controller.close();
            return;
          }
        }
      }

      accept();
    };

    const stream = new ReadableStream<[RequestEvent, Addr]>({ start });
    return stream[Symbol.asyncIterator]();
  }
}
