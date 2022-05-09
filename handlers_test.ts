// Copyright 2022 the oak authors. All rights reserved.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.138.0/testing/asserts.ts";
import { Cookies } from "./deps.ts";
import { Context } from "./context.ts";

import { immutable } from "./handlers.ts";

Deno.test({
  name: "handler - immutable() - no options",
  async fn() {
    const handlerWithOptions = immutable({ hello: "world" });
    assertEquals(Object.keys(handlerWithOptions), ["handler"]);
    const context = new Context({
      request: new Request("https://example.com/"),
      params: {},
      cookies: new Cookies(new Headers(), new Headers()),
    });
    const response = await handlerWithOptions.handler(context);
    assert(response instanceof Response);
    assertEquals([...response.headers], [[
      "cache-control",
      "public, max-age=604800, immutable",
    ], [
      "content-type",
      "application/json; charset=utf-8",
    ]]);
    assertEquals(await response.text(), `{"hello":"world"}`);
  },
});
