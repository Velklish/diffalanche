/**
 * Everything storage refuses is one error type carrying the file it read or
 * wrote and, when the fault is inside the file, the field it is in. A message
 * that names neither costs the reader a grep through the data directory.
 */
export class StorageError extends Error {
  /** Path of the file or directory the fault is about. */
  readonly file: string;
  /** Dotted path of the offending field, or `null` when the whole file is at fault. */
  readonly field: string | null;

  constructor(file: string, field: string | null, message: string) {
    super(field === null ? `${file}: ${message}` : `${file}: ${field}: ${message}`);
    this.name = "StorageError";
    this.file = file;
    this.field = field;
  }
}

/** The session is not there, whichever step found it gone — a read, the check before a write, or
 * the lock of one deleted meanwhile: the server's 404 `no-such-session`, not its 500. */
export class NoSuchSessionError extends StorageError {
  constructor(file: string) {
    super(file, null, "no such review session");
    this.name = "NoSuchSessionError";
  }
}
