import { Router } from "./router.ts";

Deno.test({
  name: "Router - basic usage",
  fn() {
    const router = new Router();
    router.all("/:id", (ctx) => {});
  },
});
