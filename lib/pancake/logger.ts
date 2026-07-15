import { readJsonStore, writeJsonStore } from "@/lib/data-store";
import type { PancakeLog, PancakeLogLevel } from "@/lib/pancake/types";

export class PancakeLogger {
  static async list() {
    return readJsonStore<PancakeLog[]>("pancake-logs.json", []);
  }

  static async write(level: PancakeLogLevel, action: string, message: string, orderCode?: string) {
    const entry: PancakeLog = {
      id: crypto.randomUUID(),
      level,
      action,
      message,
      ...(orderCode ? { orderCode } : {}),
      createdAt: new Date().toISOString()
    };
    try {
      const logs = await this.list();
      await writeJsonStore("pancake-logs.json", [entry, ...logs].slice(0, 200));
    } catch {
      // Nhật ký không được phép làm gián đoạn việc tạo/hủy đơn thật.
    }
    return entry;
  }
}
