# DA-116 · Result

**Closed 2026-09-28.** Completed, by finding the cause: the two tests of `e2e/history.spec.ts` that failed in the cloud container were the container's Bun, 1.3.11, against CI's pinned 1.3.14. With Bun 1.3.14 installed in the same container, `bun e2e/quiet.ts e2e/history.spec.ts` on the base `f49b3fa`, in a worktree of its own, passed 8 of 8, and `bun run test:ui` on DA-58's tree passed 150 of 150 — the same two tests had failed on both trees under 1.3.11 (DA-82's result). Of the three differences the card named, only the Bun version changed between the red runs and the green ones: both ran as root (`id -u` 0), and both launched the same headless shell, `/opt/pw-browsers/chromium_headless_shell-1243/…` being DA-82's link to build 1194's `headless_shell`. DA-117's SessionStart hook installs the Bun `ci.yml` pins in every cloud session, so nothing is left to change in the tests; why 1.3.11 lost the frames was not looked into.

**Verification.** The two runs above, with their exit codes 0. README's "Cloud sessions" no longer lists the two tests among a container's reds. Review: one isolated reviewer over DA-117.1, DA-118 and DA-116 in one pass; its finding here — the headless shell of the green runs not recorded — is answered above.

**Documentation in the same pass.** `README.md`, "Cloud sessions".
