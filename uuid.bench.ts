import hyperid from "hyperid";

const instance = hyperid({ urlSafe: true });

Deno.bench({
  name: "hyperid",
  fn() {
    instance();
  },
});

Deno.bench({
  name: "crypto.randomUUID",
  fn() {
    crypto.randomUUID();
  },
});
