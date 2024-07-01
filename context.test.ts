// Copyright 2018-2024 the oak authors. All rights reserved.

import { assertEquals } from "@std/assert/assert-equals";
import { Schema } from "./schema.ts";
import { MockRequestEvent } from "./testing_utils.ts";

import { Context } from "./context.ts";

Deno.test({
  name: "Context - should be able to create a new context",
  async fn() {
    const requestEvent = new MockRequestEvent(
      "http://localhost/item/123?a=1&b=2",
      {
        method: "POST",
        body: JSON.stringify({ c: 3 }),
        headers: { "content-type": "application/json" },
      },
    );
    const responseHeaders = new Headers();
    const schema = new Schema();
    const context = new Context(
      requestEvent,
      responseHeaders,
      true,
      { item: "123" },
      schema,
      undefined,
    );
    assertEquals(context.addr, {
      hostname: "localhost",
      port: 80,
      transport: "tcp",
    });
    assertEquals(await context.cookies.size, 0);
    assertEquals(context.env, {});
    assertEquals(context.params, { item: "123" });
    assertEquals(context.url, new URL("http://localhost/item/123?a=1&b=2"));
    assertEquals(context.userAgent.toString(), "");
    assertEquals(context.request, requestEvent.request);
    assertEquals(await context.body(), { c: 3 });
    assertEquals(await context.queryParams(), { a: "1", b: "2" });
    assertEquals(requestEvent.responded, false);
  },
});
