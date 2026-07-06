import { readFile, writeFile } from "fs/promises";
import { ensureJsonFile } from "@/lib/data-store";

export type ShippingProvider = "ghn" | "viettelpost" | "ghtk" | "shopee_express" | "vnpost" | "custom";

export type IntegrationConfig = {
  pancake: {
    enabled: boolean;
    endpoint: string;
    token: string;
  };
  misa: {
    enabled: boolean;
    endpoint: string;
    token: string;
  };
  shipping: {
    enabled: boolean;
    provider: ShippingProvider;
    providerName: string;
    statusEndpoint: string;
    token: string;
    shopId: string;
    clientId: string;
  };
};

export const defaultIntegrationConfig: IntegrationConfig = {
  pancake: { enabled: false, endpoint: "", token: "" },
  misa: { enabled: false, endpoint: "", token: "" },
  shipping: {
    enabled: false,
    provider: "ghn",
    providerName: "Giao Hàng Nhanh",
    statusEndpoint: "",
    token: "",
    shopId: "",
    clientId: ""
  }
};

function ensureStore() {
  return ensureJsonFile<IntegrationConfig>("integrations.json", defaultIntegrationConfig);
}

export async function readIntegrationConfig(): Promise<IntegrationConfig> {
  const integrationsFile = await ensureStore();
  try {
    const saved = JSON.parse(await readFile(integrationsFile, "utf8")) as Partial<IntegrationConfig>;
    return {
      pancake: { ...defaultIntegrationConfig.pancake, ...saved.pancake },
      misa: { ...defaultIntegrationConfig.misa, ...saved.misa },
      shipping: { ...defaultIntegrationConfig.shipping, ...saved.shipping }
    };
  } catch {
    return defaultIntegrationConfig;
  }
}

export async function writeIntegrationConfig(config: IntegrationConfig) {
  const integrationsFile = await ensureStore();
  const normalized: IntegrationConfig = {
    pancake: { ...defaultIntegrationConfig.pancake, ...config.pancake },
    misa: { ...defaultIntegrationConfig.misa, ...config.misa },
    shipping: { ...defaultIntegrationConfig.shipping, ...config.shipping }
  };
  await writeFile(integrationsFile, JSON.stringify(normalized, null, 2), "utf8");
  return normalized;
}

export function integrationHeaders(token: string) {
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };
}
