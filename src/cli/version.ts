import packageJson from "../../package.json" with { type: "json" };

/** Read from the package at build time, so a binary carries it without a package.json. */
export const VERSION: string = packageJson.version;
