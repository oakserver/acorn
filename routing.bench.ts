import { pathToRegexp } from "npm:path-to-regexp@6.2.1";
import { URLPattern as URLPatternPolyfill } from "npm:urlpattern-polyfill@10.0.0";

const urlPatternPolyfill = new URLPatternPolyfill("/:id", "http://localhost/");

Deno.bench({
  name: "URLPattern polyfill",
  fn() {
    if (urlPatternPolyfill.exec("http://localhost/1234")) {
      true;
    }
  },
});

const urlPattern = new URLPattern("/:id", "http://localhost/");

Deno.bench({
  name: "URLPattern",
  fn() {
    if (urlPattern.exec("http://localhost/1234")) {
      true;
    }
  },
});

const regexp = pathToRegexp("/:id");

Deno.bench({
  name: "pathToRegexp",
  fn() {
    if (regexp.exec("/1234")) {
      true;
    }
  },
});
