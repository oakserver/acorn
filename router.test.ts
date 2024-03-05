// Copyright 2022-2024 the oak authors. All rights reserved.

import { Status } from "./deps.ts";
import { assert, assertEquals } from "./deps_test.ts";
import { Router, RouterRequestEvent } from "./router.ts";

Deno.test({
  name: "Router - basic usage",
  fn() {
    const router = new Router();
    router.all("/:id", () => {});
  },
});

Deno.test({
  name: "Router - status route Not Found",
  async fn() {
    const router = new Router();
    let called = false;
    let onCalled = false;
    router.all("/", () => {
      called = true;
    });
    router.on(Status.NotFound, (_ctx, status, response) => {
      onCalled = true;
      assertEquals(status, Status.NotFound);
      assert(!response);
      return `<!DOCTYPE html><html><body><h1>Not Found</h1></body></html>`;
    });

    const response = await router.handle(
      new Request("http://example.com/"),
      {
        addr: { transport: "tcp", hostname: "127.0.0.1", port: 8000 },
        secure: true,
      },
    );
    assert(called, "route should have been called");
    assert(onCalled, "status route should have been called");
    assertEquals(
      await response.text(),
      `<!DOCTYPE html><html><body><h1>Not Found</h1></body></html>`,
    );
    assertEquals(response.status, Status.NotFound);
  },
});

Deno.test({
  name: "Router - request event",
  async fn() {
    const router = new Router();
    let routeCalled = 0;
    let listenerCalled = 0;
    router.all("/", () => {
      assertEquals(listenerCalled, 1, "listener should have been called first");
      routeCalled++;
      return { hello: "world" };
    });
    router.addEventListener("request", (evt) => {
      assert(evt instanceof RouterRequestEvent);
      listenerCalled++;
    });

    const response = await router.handle(
      new Request("http://example.com/"),
      {
        addr: { transport: "tcp", hostname: "127.0.0.1", port: 8000 },
        secure: true,
      },
    );
    assertEquals(routeCalled, 1, "router should have been called");
    assertEquals(listenerCalled, 1, "listener should have been called");
    assertEquals(response.status, Status.OK);
    assertEquals(
      response.headers.get("content-type"),
      "application/json; charset=UTF-8",
    );
  },
});

Deno.test({
  name: "Router - abort signal - closes properly",
  async fn() {
    const router = new Router();
    const abortController = new AbortController();
    const { signal } = abortController;
    const rp: Promise<string>[] = [];
    router.get("/", () => {
      const { promise, resolve } = Promise.withResolvers<Response>();
      setTimeout(
        () =>
          resolve(
            new Response(JSON.stringify({ hello: "world" }), {
              headers: { "content-type": "application/json" },
            }),
          ),
        200,
      );
      return promise;
    });
    router.addEventListener("listen", ({ hostname, port }) => {
      rp.push(fetch(`http://${hostname}:${port}/`).then((r) => r.text()));
      rp.push(fetch(`http://${hostname}:${port}/`).then((r) => r.text()));
      setTimeout(() => abortController.abort(), 100);
    });
    await router.listen({ signal });
    return Promise.all(rp).then(() => {});
  },
});
