// Copyright 2018-2024 the oak authors. All rights reserved.

import { createHttpError } from "@oak/commons/http_errors";
import { Status } from "@oak/commons/status";
import hyperid from "hyperid";

import type { Addr, RequestEvent } from "./types.ts";
import { createPromiseWithResolvers } from "./utils.ts";

const instance = hyperid({ urlSafe: true });

export class MockRequestEvent implements RequestEvent {
  #addr: Addr;
  #id = instance();
  //deno-lint-ignore no-explicit-any
  #reject: (reason?: any) => void;
  #request: Request;
  #resolve: (value: Response | PromiseLike<Response>) => void;
  #responded = false;
  #response: Promise<Response>;
  #url: URL;

  get addr(): Addr {
    return this.#addr;
  }

  get env(): Record<string, string> {
    return {};
  }

  get id(): string {
    return this.#id;
  }

  get request(): Request {
    return this.#request;
  }

  get response(): Promise<Response> {
    return this.#response;
  }

  get responded(): boolean {
    return this.#responded;
  }

  get url(): URL {
    return this.#url;
  }

  constructor(
    input: URL | string,
    init?: RequestInit,
    addr: Addr = { hostname: "localhost", port: 80, transport: "tcp" },
  ) {
    this.#addr = addr;
    this.#request = new Request(input, init);
    const { promise, reject, resolve } = createPromiseWithResolvers<Response>();
    this.#response = promise;
    this.#reject = reject;
    this.#resolve = resolve;
    this.#url = URL.parse(this.#request.url) ?? new URL("http://localhost/");
  }

  // deno-lint-ignore no-explicit-any
  error(reason?: any): void {
    if (this.#responded) {
      throw createHttpError(
        Status.InternalServerError,
        "Request already responded to.",
      );
    }
    this.#responded = true;
    this.#reject(reason);
  }

  respond(response: Response): void {
    if (this.#responded) {
      throw createHttpError(
        Status.InternalServerError,
        "Request already responded to.",
      );
    }
    this.#responded = true;
    this.#resolve(response);
  }
}
