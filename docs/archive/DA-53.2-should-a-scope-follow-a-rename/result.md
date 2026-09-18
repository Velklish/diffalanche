# DA-53.2 · Result

**Closed 2026-09-18.** Completed by the owner's decision, taken in the run's interview on 2026-09-18: the scope of a task stays a literal list of paths and does not follow a rename. A renamed file is at a path the scope does not name until `review scope add` or `review scope set` names it; a task's definition does not move under its reader. `docs/reference/06-cli.md` (the scope section) and `docs/reference/04-domain.md` (the rename paragraph) now say so as a decision with its reason, in the same words as the code's behaviour. No code changed; the write-at-rename mechanism the entry sketched is not taken.

**Verification.** Documentation only: `npx github:Velklish/backslop#v0.4.0 lint` exit 0 on the commit that records it; the two sections read against `src/core/domain/scope.ts`, which matches paths literally.

**Documentation in the same pass.** `docs/reference/06-cli.md`, `docs/reference/04-domain.md`.
