# DA-102.1 · A server refusal now reaches the toast, and the toast gives it the same 2.2 seconds as a two-word answer

- **Scope:** 08-ui (see [reference](../../reference/README.md))
- **Created:** 2026-09-23
- **Parent:** DA-102
- **Cost:** minor

## Evidence

Found by the Impeccable `polish` pass over DA-102 ("validate long content").
DA-102 made the two live reads put the server's refusal in the toast, and a
refusal is a sentence written for the CLI: the storage one names the file and the
field. The test of DA-102 uses one of 82 characters behind a 34-character
prefix: 116 in all. The toast's lifetime does not depend on what it says:

<!-- quote:before:../../../src/ui/components/Toast.tsx -->
```tsx
/** Bottom centre, 2.2 seconds, as the handoff's "Тосты" says. */
const LIFETIME_MS = 2200;
```
<!-- /quote -->

An assumption, not measured: 116 characters is more than a reader takes in
within 2.2 seconds while their eyes are on the diff, and a live failure arrives
without a gesture that would have told them to look down. The store's own
refusals reach the toast the same way and have the same length, so this is not
new with DA-102, only more frequent. Nothing else on the page keeps the sentence:
the toast is the only place it is shown.

The handoff fixes the 2.2 seconds, and DA-102 and DA-105 both put the toast's
lifetime out of their scope, so this is a question for whoever owns the handoff's
"Тосты" — a lifetime that grows with the text, a refusal that stays until
dismissed, or a statement that the activity feed is where a lost frame is read.
