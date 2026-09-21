# Closed task archive

Every closed task is a `DA-<number>-<slug>/` directory with two files: `task.md` contains the definition (what and why, and when it appeared), and `result.md` contains the dated outcome. Completed, rejected, and merged tasks live together; `result.md` names the outcome.

Live tasks are in [backlog/](../backlog/README.md). Numbers are sequential and never reused; a missing number in the archive means that the task is still live or was never created.

A batch of minor entries is the same directory with a `minor/` subdirectory: entries closed with `npx github:Velklish/backslop#v0.9.0 archive N.k --into M` sit there as they were, without a `result.md` of their own; the batch's `result.md` names each outcome.

Move a task with `npx github:Velklish/backslop#v0.9.0 archive N`: it also rewrites task links throughout the repository, creates the `result.md` stub, and prints the documentation files touched by the task — the draft of the “documentation updated” line.
