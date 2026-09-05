# DA-51.1 · Glossary rows for the Impeccable artifacts

- **Scope:** 08-ui (see [reference](../../reference/README.md))
- **Created:** 2026-09-05
- **Dependencies:** DA-51

## Context

`docs/GLOSSARY.md` states the rule: "Project texts use only names from this
glossary: one concept, one name." DA-51 put three names into normative project
texts that the glossary does not define.

| Name | Where it is now | What it means |
|---|---|---|
| surface brief | `AGENTS.md`, `docs/reference/08-ui.md`, and the file `.impeccable/surfaces/src-ui-app-tsx.md` | One document per screen: visitor mode, the job on that screen, its constraints, and what is still undecided there. |
| design detector | `README.md` ("design detector hook"), `docs/reference/08-ui.md` | The mechanical check the Impeccable skill runs over a UI file, enabled for the repository in `.impeccable/config.json`. |
| design system | `DESIGN.md` (its title, "Design System: diffalanche") | The visual rules `DESIGN.md` carries: tokens, typography roles, components, named rules. |

Verified, wrap-tolerantly because the docs are hard-wrapped and a plain `grep`
misses a term split across two lines:

```sh
for t in "surface brief" "design detector" "design system"; do
  printf '%-18s ' "$t"
  for f in AGENTS.md README.md docs/reference/08-ui.md DESIGN.md; do
    printf '%s=%s ' "$(basename "$f")" "$(tr '\n' ' ' < "$f" | grep -oi "$t" | wc -l | tr -d ' ')"
  done; echo
done
```

gives `surface brief AGENTS.md=1 README.md=0 08-ui.md=1 DESIGN.md=0`,
`design detector AGENTS.md=0 README.md=1 08-ui.md=1 DESIGN.md=0`,
`design system AGENTS.md=0 README.md=0 08-ui.md=0 DESIGN.md=1`. The same loop
over `docs/GLOSSARY.md` gives `0` for all three.

DA-51's scope did not include `docs/GLOSSARY.md`, so the rows were not added in
that pass; the worker proposed them in its result rather than inventing them
silently, as step 2 of `AGENTS.md` requires.

## Work to do

- Add a row per accepted name to the "Terms" table of `docs/GLOSSARY.md`, in the
  file's own shape — Term, EN, Definition, Evidence. Evidence is `DESIGN.md`,
  `.impeccable/surfaces/`, `.impeccable/config.json`, and
  `docs/reference/08-ui.md`.
- If a name is rejected, rename it in every text above in the same pass and put
  the rejected spelling under "Retired terms".

## Out of scope

- What the artifacts are and where they live: DA-51 settled that.
- The Impeccable skill's own vocabulary outside this repository.

## Verification

- Each of the three names either has a row in `docs/GLOSSARY.md` or no longer
  appears in project texts, checked with the loop above.
- `npx github:Velklish/backslop#v0.3.1 lint` is green.
