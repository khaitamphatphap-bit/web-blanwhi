export class PancakeIntegrationError extends Error {
  constructor(
    message: string,
    public readonly code = "PANCAKE_ERROR",
    public readonly status = 500,
    public readonly retryable = false
  ) {
    super(message);
    this.name = "PancakeIntegrationError";
  }
}

export class ExceptionHandler {
  static normalize(error: unknown) {
    if (error instanceof PancakeIntegrationError) return error;
    if (error instanceof Error) return new PancakeIntegrationError(error.message);
    return new PancakeIntegrationError("Lỗi tích hợp Pancake không xác định.");
  }

  static message(error: unknown) {
    return this.normalize(error).message;
  }
}
