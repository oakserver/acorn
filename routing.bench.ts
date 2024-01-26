import { pathToRegexp } from "https://deno.land/x/path_to_regexp@v6.2.1/index.ts";

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
