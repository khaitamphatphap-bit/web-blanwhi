import { readJsonStore, withDataStoreLock, writeJsonStore } from "@/lib/data-store";
import { ExceptionHandler } from "@/lib/pancake/exception-handler";
import type { PancakeQueueJob } from "@/lib/pancake/types";

export class QueueHandler {
  static async list() {
    return readJsonStore<PancakeQueueJob[]>("pancake-queue.json", []);
  }

  static async enqueue(type: PancakeQueueJob["type"], payload: Record<string, unknown>) {
    return withDataStoreLock("pancake-queue", async () => {
      const queue = await this.list();
      const duplicate = queue.find((job) => job.type === type && JSON.stringify(job.payload) === JSON.stringify(payload));
      if (duplicate) return duplicate;
      const now = new Date().toISOString();
      const job: PancakeQueueJob = { id: crypto.randomUUID(), type, payload, attempts: 0, availableAt: now, createdAt: now };
      await writeJsonStore("pancake-queue.json", [...queue, job]);
      return job;
    });
  }

  static async process(processor: (job: PancakeQueueJob) => Promise<void>) {
    const leaseMs = 2 * 60_000;
    const claimed = await withDataStoreLock("pancake-queue", async () => {
      const queue = await this.list();
      const now = Date.now();
      const ready = queue.filter((job) => new Date(job.availableAt).getTime() <= now);
      if (!ready.length) return [];
      const readyIds = new Set(ready.map((job) => job.id));
      await writeJsonStore("pancake-queue.json", queue.map((job) => readyIds.has(job.id)
        ? { ...job, availableAt: new Date(now + leaseMs).toISOString() }
        : job));
      return ready;
    });

    if (!claimed.length) return { completed: 0, remaining: (await this.list()).length };

    const completedIds = new Set<string>();
    const failedJobs = new Map<string, PancakeQueueJob>();
    for (const job of claimed) {
      try {
        await processor(job);
        completedIds.add(job.id);
      } catch (error) {
        const attempts = job.attempts + 1;
        failedJobs.set(job.id, {
          ...job,
          attempts,
          lastError: ExceptionHandler.message(error),
          availableAt: new Date(Date.now() + Math.min(60, 2 ** attempts) * 60_000).toISOString()
        });
      }
    }

    const remaining = await withDataStoreLock("pancake-queue", async () => {
      const queue = await this.list();
      const next = queue
        .filter((job) => !completedIds.has(job.id))
        .map((job) => failedJobs.get(job.id) || job);
      // A concurrent enqueue is preserved because the queue is read again only
      // after all remote calls have completed.
      await writeJsonStore("pancake-queue.json", next);
      return next.length;
    });

    return { completed: completedIds.size, remaining };
  }
}
