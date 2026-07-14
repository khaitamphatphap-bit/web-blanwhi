import { readJsonStore, writeJsonStore } from "@/lib/data-store";
import { ExceptionHandler } from "@/lib/pancake/exception-handler";
import type { PancakeQueueJob } from "@/lib/pancake/types";

export class QueueHandler {
  static async list() {
    return readJsonStore<PancakeQueueJob[]>("pancake-queue.json", []);
  }

  static async enqueue(type: PancakeQueueJob["type"], payload: Record<string, unknown>) {
    const queue = await this.list();
    const duplicate = queue.find((job) => job.type === type && JSON.stringify(job.payload) === JSON.stringify(payload));
    if (duplicate) return duplicate;
    const now = new Date().toISOString();
    const job: PancakeQueueJob = { id: crypto.randomUUID(), type, payload, attempts: 0, availableAt: now, createdAt: now };
    await writeJsonStore("pancake-queue.json", [...queue, job]);
    return job;
  }

  static async process(processor: (job: PancakeQueueJob) => Promise<void>) {
    const queue = await this.list();
    const remaining: PancakeQueueJob[] = [];
    let completed = 0;
    for (const job of queue) {
      if (new Date(job.availableAt).getTime() > Date.now()) {
        remaining.push(job);
        continue;
      }
      try {
        await processor(job);
        completed += 1;
      } catch (error) {
        const attempts = job.attempts + 1;
        if (attempts < 8) {
          remaining.push({
            ...job,
            attempts,
            lastError: ExceptionHandler.message(error),
            availableAt: new Date(Date.now() + Math.min(60, 2 ** attempts) * 60_000).toISOString()
          });
        }
      }
    }
    await writeJsonStore("pancake-queue.json", remaining);
    return { completed, remaining: remaining.length };
  }
}
