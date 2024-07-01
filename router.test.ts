// Copyright 2018-2024 the oak authors. All rights reserved.

import { assert } from "jsr:@std/assert@^0.226/assert";

import { Router } from "./router.ts";
import { assertEquals } from "jsr:@std/assert@^0.226/assert-equals";

Deno.test({
  name: "Router - register route - get - path and handler",
  fn() {
    const router = new Router();
    router.get("/", () => {
      return { hello: "world" };
    });
    const route = router.match("GET", "/");
    assert(route);
    assertEquals(route.path, "/");
  },
});

Deno.test({
  name: "Router - register route - head - path and handler",
  fn() {
    const router = new Router();
    router.head("/", () => {
      return { hello: "world" };
    });
    const route = router.match("HEAD", "/");
    assert(route);
    assertEquals(route.path, "/");
  },
});

Deno.test({
  name: "Router - register route - post - path and handler",
  fn() {
    const router = new Router();
    router.post("/", () => {
      return { hello: "world" };
    });
    const route = router.match("POST", "/");
    assert(route);
    assertEquals(route.path, "/");
  },
});
