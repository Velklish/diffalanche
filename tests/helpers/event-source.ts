/** The `EventSource` of `live.ts`, which neither Node nor Bun defines: a test brings
 * its own and delivers the frames by hand. */
export class FakeSource {
  static last: FakeSource | null = null;
  readonly listeners = new Map<string, (event: MessageEvent<string>) => void>();
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
  }
  /** One frame, as the server would write it. */
  deliver(name: string, data: unknown): void {
    this.listeners.get(name)?.({ data: JSON.stringify(data) } as MessageEvent<string>);
  }
}
