// Copyright 2022 the oak authors. All rights reserved.

import { Status, STATUS_TEXT } from "./deps.ts";
import type {
  Listener,
  ListenOptions,
  ListenTlsOptions,
  RequestEvent,
  ServeHandler,
  ServeInit,
  Server,
  ServeTlsInit,
} from "./types.d.ts";
import { assert, Deferred } from "./util.ts";

const serve: (
  handler: ServeHandler,
  options?: ServeInit,
) => Promise<void> = "serve" in Deno
  // deno-lint-ignore no-explicit-any
  ? (Deno as any).serve.bind(Deno)
  : undefined;

const serveTls: (
  handler: ServeHandler,
  options?: ServeTlsInit,
) => Promise<void> = "serveTls" in Deno
  // deno-lint-ignore no-explicit-any
  ? (Deno as any).serveTls.bind(Deno)
  : undefined;

/** A function that determines if the current environment supports Deno flash.*/
export function hasFlash(): boolean {
  // @ts-expect-error they might not actually be defined!
  return !!(serve && serveTls);
}

function isServeTlsInit(
  value: ServeInit | ServeTlsInit,
): value is ServeTlsInit {
  return "cert" in value && "key" in value;
}

class FlashRequestEvent implements RequestEvent {
  #deferred = new Deferred<Response>();
  #request: Request;

  get promise(): Promise<Response> {
    return this.#deferred.promise;
  }

  get request(): Request {
    return this.#request;
  }

  constructor(request: Request) {
    this.#request = request;
  }

  respondWith = (r: Response | Promise<Response>): Promise<void> => {
    this.#deferred.resolve(r);
    return Promise.resolve();
  };
}

export class FlashHttpServer implements Server {
  #abortController = new AbortController();
  #closed = false;
  #controller?: ReadableStreamDefaultController<RequestEvent>;
  #errorTarget: EventTarget;
  #options: ListenOptions | ListenTlsOptions;
  #servePromise?: Promise<void>;
  #stream?: ReadableStream<RequestEvent>;

  constructor(
    errorTarget: EventTarget,
    options: ListenOptions | ListenTlsOptions,
  ) {
    this.#errorTarget = errorTarget;
    this.#options = options;
  }

  async close(): Promise<void> {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    try {
      this.#controller?.close();
      this.#controller = undefined;
      this.#stream = undefined;
      this.#abortController.abort();
      if (this.#servePromise) {
        await this.#servePromise;
        this.#servePromise = undefined;
      }
    } catch (error) {
      this.#errorTarget.dispatchEvent(new ErrorEvent("error", { error }));
    }
  }

  listen(): Promise<Listener> {
    const d = new Deferred<Listener>();
    const start: ReadableStreamDefaultControllerCallback<RequestEvent> = (
      controller,
    ) => {
      this.#controller = controller;
      const options: ServeInit | ServeTlsInit = {
        ...this.#options,
        signal: this.#abortController.signal,
        onListen: (addr) => d.resolve({ addr }),
        onError: (error) => {
          this.#errorTarget.dispatchEvent(new ErrorEvent("error", { error }));
          return new Response("Internal sever error", {
            status: Status.InternalServerError,
            statusText: STATUS_TEXT[Status.InternalServerError],
          });
        },
      };
      const handler: ServeHandler = (request) => {
        const requestEvent = new FlashRequestEvent(request);
        controller.enqueue(requestEvent);
        return requestEvent.promise;
      };
      if (isServeTlsInit(options)) {
        this.#servePromise = serveTls(handler, options);
      } else {
        this.#servePromise = serve(handler, options);
      }
    };
    this.#stream = new ReadableStream({ start });
    return d.promise;
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<RequestEvent> {
    assert(
      this.#stream,
      ".listen() was not called before iterating or server is closed.",
    );
    return this.#stream[Symbol.asyncIterator]();
  }
}
