import { pathToRegexp } from "npm:path-to-regexp@6.2.1";

const urlPattern = new URLPattern("/", "http://localhost/");

Deno.bench({
  name: "URLPattern",
  fn() {
    if (urlPattern.test("http://localhost/")) {
      true;
    }
  },
});

const regexp = pathToRegexp("/");

Deno.bench({
  name: "pathToRegexp",
  fn() {
    if (regexp.test("/")) {
      true;
    }
  },
});
