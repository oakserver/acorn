// Copyright 2022-2024 the oak authors. All rights reserved.

import { assert, assertEquals, assertRejects } from "./deps_test.ts";
import { errors, Status } from "./deps.ts";
import { Context } from "./context.ts";
import type { Addr, RequestEvent } from "./types_internal.ts";

import { auth, immutable } from "./handlers.ts";

function createRequestEvent(
  input: RequestInfo | URL,
  init?: RequestInit,
): RequestEvent {
  const request = new Request(input, init);
  return {
    get addr(): Addr {
      return { transport: "tcp", hostname: "127.0.0.1", port: 8000 };
    },
    get request() {
      return request;
    },
    error(_reason) {},
    respond(_response) {},
  };
}

Deno.test({
  name: "handler - auth() - authorized",
  async fn() {
    const handlerWithOptions = auth(
      () => ({ hello: "world" }),
      { authorize: () => true },
    );
    const context = new Context({
      requestEvent: createRequestEvent("https://example.com/"),
      params: {},
      headers: new Headers(),
    });
    const response = await handlerWithOptions.handler(context);
    assertEquals(response, { hello: "world" });
  },
});

Deno.test({
  name: "handler - auth() - unauthorized",
  async fn() {
    const handlerWithOptions = auth(
      () => ({ hello: "world" }),
      { authorize: () => false },
    );
    const context = new Context({
      requestEvent: createRequestEvent("https://example.com/"),
      params: {},
      headers: new Headers(),
    });
    await assertRejects(
      async () => {
        await handlerWithOptions.handler(context);
      },
      errors.Unauthorized,
      "Unauthorized",
    );
  },
});

Deno.test({
  name: "handler - auth() - return body init",
  async fn() {
    const handlerWithOptions = auth(
      () => ({ hello: "world" }),
      { authorize: () => "not authorized" },
    );
    const context = new Context({
      requestEvent: createRequestEvent("https://example.com/"),
      params: {},
      headers: new Headers(),
    });
    const response = await handlerWithOptions.handler(context);
    assert(response instanceof Response);
    assertEquals(response.status, Status.Unauthorized);
    assertEquals(await response.text(), "not authorized");
  },
});

Deno.test({
  name: "handler - immutable() - no options",
  async fn() {
    const handlerWithOptions = immutable({ hello: "world" });
    assertEquals(Object.keys(handlerWithOptions), ["handler"]);
    const context = new Context({
      requestEvent: createRequestEvent("https://example.com/"),
      params: {},
      headers: new Headers(),
    });
    const response = await handlerWithOptions.handler(context);
    assert(response instanceof Response);
    assertEquals([...response.headers], [[
      "cache-control",
      "public, max-age=604800, immutable",
    ], [
      "content-type",
      "application/json; charset=UTF-8",
    ]]);
    assertEquals(await response.text(), `{"hello":"world"}`);
  },
});
