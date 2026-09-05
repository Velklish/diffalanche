# DA-1.1 · Result

**Closed 2026-09-05.** Completed. Decision: `bun run typecheck` joins `gates` in `backslop.json`; it costs 0.3 s on the skeleton and CI already runs it, so a red typecheck must fail locally before a push. Landed with the DA-1 review fixes (`backslop.json`, README Development section names lint, typecheck, and test).

**Verification.** `python3 -c "import json;print(json.load(open('backslop.json'))['gates'])"` lists the four commands; they match the three `bun run` steps of `.github/workflows/ci.yml` plus `backslop lint`. `npx github:Velklish/backslop#v0.3.1 lint` green.

**Documentation in the same pass.** `README.md` Development section.
