import { readJsonStore, writeJsonStore } from "@/lib/data-store";

export type ShippingProvider = "ghn" | "viettelpost" | "ghtk" | "shopee_express" | "vnpost" | "custom";

export type IntegrationConfig = {
  pancake: {
    enabled: boolean;
    endpoint: string;
    inventoryEndpoint: string;
    token: string;
  };
  misa: {
    enabled: boolean;
    endpoint: string;
    inventoryEndpoint: string;
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
  payment: {
    vnpay: {
      enabled: boolean;
      tmnCode: string;
      hashSecret: string;
      paymentUrl: string;
    };
    momo: {
      enabled: boolean;
      partnerCode: string;
      accessKey: string;
      secretKey: string;
      endpoint: string;
    };
    zalopay: {
      enabled: boolean;
      appId: string;
      key1: string;
      key2: string;
      endpoint: string;
    };
  };
};

export const defaultIntegrationConfig: IntegrationConfig = {
  pancake: { enabled: false, endpoint: "", inventoryEndpoint: "", token: "" },
  misa: { enabled: false, endpoint: "", inventoryEndpoint: "", token: "" },
  shipping: {
    enabled: false,
    provider: "ghn",
    providerName: "Giao Hàng Nhanh",
    statusEndpoint: "",
    token: "",
    shopId: "",
    clientId: ""
  },
  payment: {
    vnpay: {
      enabled: false,
      tmnCode: "",
      hashSecret: "",
      paymentUrl: "https://sandbox.vnpayment.vn/paymentv2/vpcpay.html"
    },
    momo: {
      enabled: false,
      partnerCode: "",
      accessKey: "",
      secretKey: "",
      endpoint: "https://test-payment.momo.vn/v2/gateway/api/create"
    },
    zalopay: {
      enabled: false,
      appId: "",
      key1: "",
      key2: "",
      endpoint: "https://sb-openapi.zalopay.vn/v2/create"
    }
  }
};

export async function readIntegrationConfig(): Promise<IntegrationConfig> {
  try {
    const saved = await readJsonStore<Partial<IntegrationConfig>>("integrations.json", defaultIntegrationConfig);
    return {
      pancake: { ...defaultIntegrationConfig.pancake },
      misa: { ...defaultIntegrationConfig.misa, ...saved.misa },
      shipping: { ...defaultIntegrationConfig.shipping, ...saved.shipping },
      payment: {
        vnpay: { ...defaultIntegrationConfig.payment.vnpay, ...saved.payment?.vnpay },
        momo: { ...defaultIntegrationConfig.payment.momo, ...saved.payment?.momo },
        zalopay: { ...defaultIntegrationConfig.payment.zalopay, ...saved.payment?.zalopay }
      }
    };
  } catch {
    return defaultIntegrationConfig;
  }
}

export async function writeIntegrationConfig(config: IntegrationConfig) {
  const normalized: IntegrationConfig = {
    pancake: { ...defaultIntegrationConfig.pancake },
    misa: { ...defaultIntegrationConfig.misa, ...config.misa },
    shipping: { ...defaultIntegrationConfig.shipping, ...config.shipping },
    payment: {
      vnpay: { ...defaultIntegrationConfig.payment.vnpay, ...config.payment?.vnpay },
      momo: { ...defaultIntegrationConfig.payment.momo, ...config.payment?.momo },
      zalopay: { ...defaultIntegrationConfig.payment.zalopay, ...config.payment?.zalopay }
    }
  };
  return writeJsonStore("integrations.json", normalized);
}

export function integrationHeaders(token: string) {
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };
}
