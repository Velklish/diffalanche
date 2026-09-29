# DA-82.3 · Result

**Closed 2026-09-29.** Completed, and the card's assumption is refuted for the case it named. On the 4-core cloud container (root, Chromium 141 headless shell, load 0.8–1.9), an idle frame unpaced (`afterPaint` alone, 200 frames a reading, two processes each way) costs 17.6–17.7 ms median against 16.6–16.7 ms at 60 Hz. An added idle frame is therefore visible to the gate. A frame that has something to draw costs about its work: 0.7–1.0 ms for a 40 px scroll, 2.2–2.8 ms for a one-pixel repaint. The probe's added frame (an `await afterPaint()` before the first `scrollIntoView` in `revealCard`) was not resolved:
- `perf/compare.ts`: −4.2 ms, `no difference`;
- five processes: +5.7 ms, inside both spreads;
- `bun run perf`: +14.0 ms, which cannot flip a line that is already over budget on this machine;
- at 60 Hz, with the flag removed for the probe only: +18.7 ms, spreads apart.

The page's frame count went from 3 to 4 in every jump. That this frame only moves work the first scroll would have done anyway is an inference, not a measurement. 11-perf, "What a frame costs unpaced, and what the gate does not see", now separates three cases:
- an idle frame is seen;
- a frame that carries its own work is seen as that work (the `ROUNDS` 3 → 6 row);
- a frame that only moves work earlier is not resolved by the `ms` lines until DA-82.4 is decided.

On the reader's 60 Hz display every added frame costs up to one 16.7 ms tick. A frame-count ceiling for the jump and the composer is cheap and deterministic (3 in 30 of 30 jumps on the shipped page, 4 in 42 of 42 with the probe, 1 in 14 of 14 composer openings). It would be a new row in the budget table, so it is filed as DA-82.4 for the owner. The first commit's subject, "frame-only regressions are outside the perf gate by decision", overstates; the files say it as above.

**Verification.** Measurements by the worker, with each machine and load average in 11-perf and in DA-82.4. The mutation probe is the card's own: the gate did not turn red, and 11-perf says why. Gates on the worker's tree, from `backslop gates --keep-going`: gates 8, green 5. The red ones are `test` and `test:bun` (12 failed each: the eleven embedding tests, since huggingface.co is blocked, and the chmod watcher test that DA-117.1 fixed on main) and `perf`, which is over budget on the untouched base in this container. Pull-request CI is the verdict. Review: three isolated reviewer rounds. Round one found two major and seven minor issues and one hypothesis, among them the "× 8.3 ms" rule and the unqualified "outside the gate". Round two found five minor. All were fixed. Round two checked the fixes of round one, and the approver checked round two's fixes against the diff.

**Documentation in the same pass.** `docs/reference/11-perf.md` (The gate, The measurement harness); `CHANGELOG.md`.
