export class ServerTiming {
  private readonly startedAt = performance.now();
  private readonly entries: Array<{ name: string; durationMs: number }> = [];

  async measure<T>(name: string, task: () => Promise<T>): Promise<T> {
    const startedAt = performance.now();
    try {
      return await task();
    } finally {
      this.entries.push({ name: name.replace(/[^a-z0-9_-]/gi, "_"), durationMs: performance.now() - startedAt });
    }
  }

  headers(operation: string, slowThresholdMs = 2_000) {
    const totalMs = performance.now() - this.startedAt;
    const value = [...this.entries, { name: "total", durationMs: totalMs }]
      .map((entry) => `${entry.name};dur=${entry.durationMs.toFixed(1)}`)
      .join(", ");
    if (totalMs >= slowThresholdMs) {
      console.warn(`[BLANWHI latency] ${operation} ${value}`);
    }
    return {
      "Server-Timing": value,
      "X-BLANWHI-Duration-Ms": Math.round(totalMs).toString()
    };
  }
}
