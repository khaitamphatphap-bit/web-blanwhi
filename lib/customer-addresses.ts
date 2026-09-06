import {
  readKeyedJsonRecordDatabaseStatus,
  readKeyedJsonStore,
  withDataStoreLock,
  writeKeyedJsonRecord
} from "@/lib/data-store";

const customerAddressNamespace = "customer-saved-addresses";
const maxSavedAddresses = 5;

export type CustomerSavedAddress = {
  name: string;
  phone: string;
  province: string;
  provinceId: string;
  district: string;
  districtId: string;
  ward: string;
  wardId: string;
  house: string;
  address: string;
  updatedAt: number;
};

type CustomerAddressRecord = {
  version: 1;
  updatedAt: number;
  addresses: CustomerSavedAddress[];
};

function text(value: unknown, limit: number) {
  return String(value || "").trim().slice(0, limit);
}

function normalizedPhone(value: unknown) {
  return String(value || "").replace(/\D/g, "").slice(0, 15);
}

function addressIdentity(address: CustomerSavedAddress) {
  return `${normalizedPhone(address.phone)}|${address.address.toLocaleLowerCase("vi-VN")}`;
}

export function sanitizeCustomerAddress(value: unknown, now = Date.now()): CustomerSavedAddress | null {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const phone = normalizedPhone(source.phone);
  const address = text(source.address, 500);
  if (phone.length < 10 || !address) return null;
  return {
    name: text(source.name, 160),
    phone,
    province: text(source.province, 120),
    provinceId: text(source.provinceId, 80),
    district: text(source.district, 120),
    districtId: text(source.districtId, 80),
    ward: text(source.ward, 120),
    wardId: text(source.wardId, 80),
    house: text(source.house, 300),
    address,
    updatedAt: Math.max(0, Math.min(Math.floor(Number(source.updatedAt) || now), now + 5 * 60 * 1000))
  };
}

function sanitizeRecord(value: unknown): CustomerAddressRecord {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const seen = new Set<string>();
  const addresses = (Array.isArray(source.addresses) ? source.addresses : [])
    .map((address) => sanitizeCustomerAddress(address))
    .filter((address): address is CustomerSavedAddress => Boolean(address))
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .filter((address) => {
      const key = addressIdentity(address);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, maxSavedAddresses);
  return {
    version: 1,
    updatedAt: Math.max(0, Math.floor(Number(source.updatedAt) || 0)),
    addresses
  };
}

async function readCustomerAddressRecord(deviceId: string) {
  const database = await readKeyedJsonRecordDatabaseStatus<CustomerAddressRecord>(customerAddressNamespace, deviceId);
  if (database.ok) return sanitizeRecord(database.record);
  const fallback = await readKeyedJsonStore<CustomerAddressRecord>(customerAddressNamespace, {});
  return sanitizeRecord(fallback[deviceId]);
}

export async function readCustomerAddresses(deviceId: string) {
  return (await readCustomerAddressRecord(deviceId)).addresses;
}

export async function saveCustomerAddress(deviceId: string, value: unknown) {
  const address = sanitizeCustomerAddress(value);
  if (!address) throw new Error("Thông tin địa chỉ hoặc số điện thoại chưa hợp lệ.");
  return withDataStoreLock(`customer-addresses:${deviceId}`, async () => {
    const current = await readCustomerAddressRecord(deviceId);
    const key = addressIdentity(address);
    const addresses = [address, ...current.addresses.filter((item) => addressIdentity(item) !== key)]
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, maxSavedAddresses);
    await writeKeyedJsonRecord<CustomerAddressRecord>(customerAddressNamespace, deviceId, {
      version: 1,
      updatedAt: address.updatedAt,
      addresses
    });
    return addresses;
  });
}
