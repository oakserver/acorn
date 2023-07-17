# acorn change log

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
