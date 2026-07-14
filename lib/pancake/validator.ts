import { timingSafeEqual } from "crypto";
import { PancakeIntegrationError } from "@/lib/pancake/exception-handler";

export class Validator {
  static required(value: unknown, label: string) {
    const text = String(value ?? "").trim();
    if (!text) throw new PancakeIntegrationError(`Thiếu ${label}.`, "VALIDATION_ERROR", 400);
    return text;
  }

  static quantity(value: unknown) {
    const number = Number(value);
    return Math.max(0, Math.floor(Number.isFinite(number) ? number : 0));
  }

  static webhookSecret(actual: string, expected: string) {
    if (!expected) return true;
    const actualBuffer = Buffer.from(actual || "");
    const expectedBuffer = Buffer.from(expected);
    return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
  }
}
