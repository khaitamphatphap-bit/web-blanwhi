import { PancakeIntegrationError } from "@/lib/pancake/exception-handler";

type RequestOptions = {
  method?: "GET" | "POST" | "PUT";
  query?: Record<string, string | number | undefined>;
  body?: unknown;
};

export class ApiClient {
  private readonly baseUrl = (process.env.PANCAKE_API_BASE_URL || "https://pos.pages.fm/api/v1").replace(/\/$/, "");
  private readonly apiKey = process.env.PANCAKE_API_KEY || "";
  private readonly token = process.env.PANCAKE_TOKEN || "";

  configured() {
    return Boolean(this.apiKey);
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    if (!this.apiKey) {
      throw new PancakeIntegrationError("Chưa cấu hình PANCAKE_API_KEY trên Vercel.", "PANCAKE_NOT_CONFIGURED", 503);
    }
    const url = new URL(`${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`);
    url.searchParams.set("api_key", this.apiKey);
    for (const [key, value] of Object.entries(options.query || {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(url, {
        method: options.method || "GET",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {})
        },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        cache: "no-store",
        signal: controller.signal
      });
      const text = await response.text();
      const data = text ? JSON.parse(text) : {};
      if (!response.ok || data?.success === false) {
        const message = data?.message || data?.error || `Pancake trả lỗi HTTP ${response.status}.`;
        throw new PancakeIntegrationError(String(message), "PANCAKE_API_ERROR", response.status, response.status >= 500 || response.status === 429);
      }
      return data as T;
    } catch (error) {
      if (error instanceof PancakeIntegrationError) throw error;
      const message = error instanceof Error && error.name === "AbortError" ? "Pancake API phản hồi quá thời gian." : "Không kết nối được Pancake API.";
      throw new PancakeIntegrationError(message, "PANCAKE_NETWORK_ERROR", 502, true);
    } finally {
      clearTimeout(timeout);
    }
  }
}
