// Copyright 2022-2024 the oak authors. All rights reserved.

import type {
  Addr,
  CloudflareExecutionContext,
  RequestEvent as _RequestEvent,
} from "./types_internal.ts";
import { createPromiseWithResolvers } from "./util.ts";

export class RequestEvent<
  Env extends Record<string, string> = Record<string, string>,
> implements _RequestEvent {
  #addr?: Addr;
  //deno-lint-ignore no-explicit-any
  #reject: (reason?: any) => void;
  #request: Request;
  #resolve: (value: Response | PromiseLike<Response>) => void;
  #resolved = false;
  #response: Promise<Response>;

  get addr(): Addr {
    if (!this.#addr) {
      const hostname = this.#request.headers.get("CF-Connecting-IP") ??
        "localhost";
      this.#addr = { hostname, port: 80, transport: "tcp" };
    }
    return this.#addr;
  }

  get request(): Request {
    return this.#request;
  }

  get response(): Promise<Response> {
    return this.#response;
  }

  constructor(request: Request, _env: Env, _ctx: CloudflareExecutionContext) {
    this.#request = request;
    const { resolve, reject, promise } = createPromiseWithResolvers<Response>();
    this.#resolve = resolve;
    this.#reject = reject;
    this.#response = promise;
  }

  //deno-lint-ignore no-explicit-any
  error(reason?: any): void {
    if (this.#resolved) {
      throw new Error("Request already responded to.");
    }
    this.#resolved = true;
    this.#reject(reason);
  }

  respond(response: Response | PromiseLike<Response>): void {
    if (this.#resolved) {
      throw new Error("Request already responded to.");
    }
    this.#resolved = true;
    this.#resolve(response);
  }
}
