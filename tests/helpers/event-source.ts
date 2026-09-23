/** The `EventSource` of `live.ts`, which neither Node nor Bun defines: a test brings
 * its own and delivers the frames by hand. */
export class FakeSource {
  /** The one constant `live.ts` compares against, at the browser's value. */
  static readonly CLOSED = 2;
  static last: FakeSource | null = null;
  readonly listeners = new Map<string, (event: MessageEvent<string>) => void>();
  /** `CONNECTING`, as a new `EventSource` is; a test sets the rest by hand. */
  readyState = 0;
  closed = false;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeSource.last = this;
  }
  addEventListener(name: string, handle: (event: MessageEvent<string>) => void): void {
    this.listeners.set(name, handle);
  }
  close(): void {
    this.closed = true;
    this.readyState = FakeSource.CLOSED;
  }
  /** One frame, as the server would write it. */
  deliver(name: string, data: unknown): void {
    this.listeners.get(name)?.({ data: JSON.stringify(data) } as MessageEvent<string>);
  }
}
