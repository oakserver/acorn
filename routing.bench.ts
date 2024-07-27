import { pathToRegexp as pathToRegexp7 } from "npm:path-to-regexp@7.0.0";
import { pathToRegexp as pathToRegexp71 } from "npm:path-to-regexp@7.1.0";
import { pathToRegexp } from "npm:path-to-regexp@6.2.1";
import { URLPattern as URLPatternPolyfill } from "npm:urlpattern-polyfill@10.0.0";

const urlPatternPolyfill = new URLPatternPolyfill(
  "/book/:id",
  "http://localhost/",
);

Deno.bench({
  name: "URLPattern polyfill",
  fn() {
    if (urlPatternPolyfill.exec("http://localhost/book/1234")) {
      true;
    }
  },
});

const urlPattern = new URLPattern("/book/:id", "http://localhost/");

Deno.bench({
  name: "URLPattern",
  fn() {
    if (urlPattern.exec("http://localhost/book/1234")) {
      true;
    }
  },
});

const regexp = pathToRegexp("/:id");

Deno.bench({
  name: "pathToRegexp 6.2",
  fn() {
    if (regexp.exec("/1234")) {
      true;
    }
  },
});

const regexp7 = pathToRegexp7("/book/:id");

Deno.bench({
  name: "pathToRegexp 7.0",
  fn() {
    if (regexp7.exec("/book/1234")) {
      true;
    }
  },
});

const regexp71 = pathToRegexp71("/book/:id", { strict: true });

Deno.bench({
  name: "pathToRegexp 7.1",
  fn() {
    if (regexp71.exec("/book/1234")) {
      true;
    }
  },
});
