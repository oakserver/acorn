# acorn change log

## Version 0.7.1

- docs: improve examples (7a20b7e)

## Version 0.7.0

- feat: support Cloudflare Workers (2eecd21)
- feat: include duration in handled event (b6cbe17)

  **BREAKING CHANGE** Previously the `HandledEvent` contained the performance
  measurement of the handling of the route. It now only contains a `duration`
  property which represents in milliseconds how long it took to handle the
  request.

- fix: use `createPromiseWithResolvers()` (b6023f8)
- fix: add dynamic npm imports (acc5756)

## Version 0.6.0

- chore: add publish workflow (ee5b869)
- feat: support Node.js (3088469)
- feat: add ErrorEvent polyfill for Node.js (c5b1819)
- fix: don't await respond (ac90976)

## Version 0.5.1

- fix: polyfill URLPattern under Bun (8e21f32)
- fix: move loading of URLPattern polyfill (828fed3)
- fix: add urlpattern-polyfill to deno.json (25edc9)
- fix: move npm dep to package.json (8a615f1)
- fix: fix npm dependencies (f09b303)
- docs: update inline docs and readme around Bun (297a38f)

## Version 0.5.0

- feat: use `Deno.serve()` instead of `Deno.serveHttp()` (014019b)

  **BREAKING CHANGE** acorn now uses the `Deno.serve()` API instead of
  `Deno.serveHttp()` which is deprecated. This requires some breaking changes in
  the way options are supplied on `.listen()` for SSL/TLS connections.

- feat: web socket upgrade auto-responds (46e9e07)

  **BREAKING CHANGE** acorn now sends the response when performing a websocket
  upgrade. Previously the `Response` to initiate the connection would be
  returned from the function and it was the responsibility of the user to send
  that back to the client.

- feat: support Bun's http server (7f08edc)

  acorn will detect if it is running in the Bun runtime and utilize Bun's built
  in HTTP server.

  Currently web socket upgrade are not supported when running under Bun.

- fix: make handling requests more robust (3df07a4)
- fix: memory leak in server wrapper (8920f73)
- tests: add benchmark test (9f2fb34)
- chore: update to std 0.212.0, commons 0.5.0 (8e3ffa7)
- chore: updates to prep for JSR publish (cca89b7)
- chore: update ci (14b51d5)
- chore: add parallel flag to tests (1011b87)
- docs: add a couple module docs (acdca92)

## Version 0.4.0

- feat: add userAgent property to context (d680246)

  The context now includes a property called `.userAgent` which includes
  information about the request's user agent in available.

- feat: expose RouterRequestEvent in mod.ts (c9ed546)

- feat: add web socket upgrade method to context (4030953)

  A convenience method was added to be able to attempt to upgrade a connection
  related to a request to a web socket.

- fix: abort signal on router listen (3e8a21d)

  Previously, while an abort signal could be passed on listening, it did not
  actually close the server. Now it does.

- refactor: improve performance of context (47b66a4)
- refactor: rename test files (6b14801)
- refactor: improve `router.on()`` overload (ba96525)
- refactor: use deferred from std (9e9df97)
- refactor: router internal state (01dc63f)
- refactor: rename types.d.ts to types.ts (b67e2bb)
- chore: update copyright header dates (4705f92)
- chore: update to std 0.194.0 (29ca68e)
- docs: add missing inline docs (57e9d1d)
- docs: make docs reflect code (07794a6)
- docs: add philosophy to readme (c49fdfc)
- docs: add example of SSE (e1ed289)

## Version 0.3.0

- feat: add request address to context (#1)
- chore: update to std 0.190.0 (d6abbb8)
- docs: update README badges (652598e)
