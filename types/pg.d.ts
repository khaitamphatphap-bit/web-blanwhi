declare module "pg" {
  export class Pool {
    constructor(config?: {
      connectionString?: string;
      ssl?: false | { rejectUnauthorized?: boolean };
      max?: number;
      connectionTimeoutMillis?: number;
      idleTimeoutMillis?: number;
      allowExitOnIdle?: boolean;
    });
    query<T = Record<string, unknown>>(
      text: string,
      params?: unknown[]
    ): Promise<{ rows: T[] }>;
  }
}
