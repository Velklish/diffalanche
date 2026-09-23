# Review synth — Synthetic review

base head · 17 open comments

## Review — 1 comment

- **question** · `review`

  Null check is unreachable: the contract guarantees a non-null collection.

  > **claude** (agent) — Renamed to match the body.

## repos/core/cargos-api — 6 comments

- **warning** · `repository`

  This allocates on every request; hoist the default out of the loop.

- **nit** · `app/flag/flag_91.py:151`

  Duplicate of the helper two files up; call that one instead.

- **critical** · `docs/invoice-162.md:46-48`

  Missing the region in the cache key: two tariffs collide here.

- **question** · `internal/payload/payload-131.go:127`

  Null check is unreachable: the contract guarantees a non-null collection.

  > **claude** (agent) — Fixed: the region is part of the cache key now.

- **warning** · `src/Quotes/QuoteService49.cs:78`

  This allocates on every request; hoist the default out of the loop.

- **nit** · `src/Routes/RouteService212.cs:14`

  Duplicate of the helper two files up; call that one instead.

  > **claude** (agent) — Fixed: removed the fallback, the contract guarantees non-null.

## repos/platform/loads-search — 6 comments

- **critical** · `app/cargo/cargo_409.py:64-66`

  The list order is part of the contract, sorting it here breaks callers.

  > **claude** (agent) — Fixed: the region is part of the cache key now.

- **warning** · `docs/contract-317.md:141`

  This allocates on every request; hoist the default out of the loop.

  > **claude** (agent) — Fixed: the region is part of the cache key now.

- **warning** · `internal/flag/flag-427.go:80`

  This allocates on every request; hoist the default out of the loop.

- **critical** · `internal/route/route-280.go:80-82`

  Missing the region in the cache key: two tariffs collide here.

- **question** · `src/Regions/RegionService371.cs:127`

  Null check is unreachable: the contract guarantees a non-null collection.

- **nit** · `src/flag/flag-346.ts`

  The name says filter, the body maps. Rename or split it.

## repos/services/quotes-worker — 4 comments

- **warning** · `app/quote/quote_535.py:130`

  This allocates on every request; hoist the default out of the loop.

- **question** · `docs/contract-590.md:31`

  Why is the empty list an error in this branch and a default in the next one?

- **nit** · `internal/payload/payload-568.go:123`

  Duplicate of the helper two files up; call that one instead.

  > **claude** (agent) — Fixed: the default is hoisted, the loop allocates nothing now.

- **critical** · `src/Cargos/CargoService500.cs:62-64`

  The list order is part of the contract, sorting it here breaks callers.
