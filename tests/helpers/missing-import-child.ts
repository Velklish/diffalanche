/** A child whose module imports one that is not there, as a broken package's would; Node names
 * that error with its code (tests/suggest.test.ts). */
await import(["./not", "there.ts"].join("-"));
