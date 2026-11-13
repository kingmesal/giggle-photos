/**
 * FIFO byte-budget semaphore: bounds how much memory concurrent image decodes may hold.
 *
 * A request waits until its estimated bytes fit within the remaining budget. A single request
 * larger than the whole budget is admitted only when nothing else is in flight, so a huge image
 * still decodes (alone) instead of deadlocking. Strict FIFO: a large waiter is not starved by
 * smaller requests arriving after it.
 */
export class ByteBudget {
  private inUse = 0;
  private inFlight = 0;
  private readonly waiters: { bytes: number; admit: () => void }[] = [];

  constructor(readonly limitBytes: number) {
    if (!(limitBytes > 0)) throw new Error(`ByteBudget limit must be positive, got ${limitBytes}`);
  }

  get bytesInUse(): number {
    return this.inUse;
  }

  /** Wait for `bytes` of budget. Resolves to a release function; call it exactly once. */
  async acquire(bytes: number): Promise<() => void> {
    const amount = Math.max(0, bytes);
    if (this.waiters.length === 0 && this.fits(amount)) {
      this.take(amount);
    } else {
      await new Promise<void>((admit) => this.waiters.push({ bytes: amount, admit }));
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.inUse -= amount;
      this.inFlight--;
      this.drain();
    };
  }

  private fits(bytes: number): boolean {
    return this.inFlight === 0 || this.inUse + bytes <= this.limitBytes;
  }

  private take(bytes: number): void {
    this.inUse += bytes;
    this.inFlight++;
  }

  private drain(): void {
    while (this.waiters.length > 0) {
      const next = this.waiters[0] as { bytes: number; admit: () => void };
      if (!this.fits(next.bytes)) return;
      this.waiters.shift();
      this.take(next.bytes);
      next.admit();
    }
  }
}
