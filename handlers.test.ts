// Copyright 2022-2023 the oak authors. All rights reserved.

import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.138.0/testing/asserts.ts";
import { errors, SecureCookieMap, Status } from "./deps.ts";
import { Context } from "./context.ts";

import { auth, immutable } from "./handlers.ts";

Deno.test({
  name: "handler - auth() - authorized",
  async fn() {
    const handlerWithOptions = auth(
      () => ({ hello: "world" }),
      { authorize: () => true },
    );
    const context = new Context({
      request: new Request("https://example.com/"),
      params: {},
      cookies: new SecureCookieMap(new Headers()),
      addr: { transport: "tcp", hostname: "127.0.0.1", port: 8000 },
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
      request: new Request("https://example.com/"),
      params: {},
      cookies: new SecureCookieMap(new Headers()),
      addr: { transport: "tcp", hostname: "127.0.0.1", port: 8000 },
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
      request: new Request("https://example.com/"),
      params: {},
      cookies: new SecureCookieMap(new Headers()),
      addr: { transport: "tcp", hostname: "127.0.0.1", port: 8000 },
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
      request: new Request("https://example.com/"),
      params: {},
      cookies: new SecureCookieMap(new Headers()),
      addr: { transport: "tcp", hostname: "127.0.0.1", port: 8000 },
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
