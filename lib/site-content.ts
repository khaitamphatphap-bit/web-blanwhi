import { readJsonStore, readKeyedJsonStore, writeJsonStore, writeKeyedJsonRecord } from "@/lib/data-store";
import { buildProductInventory } from "@/lib/product-inventory";

export type CmsProductClassification = {
  id: string;
  name: string;
  swatches: string[];
  colorNames?: Record<string, string>;
  colorImages?: Record<string, string>;
};

export type CmsProductInventoryItem = {
  key: string;
  sku: string;
  quantity: number;
  publishQuantity?: number;
  pancakeQuantity?: number;
  pancakeProductId?: string;
  pancakeVariationId?: string;
  pancakeSku?: string;
  lastSyncedAt?: string;
  size: string;
  color?: string;
  classificationId?: string;
};

type PancakeLinkSnapshot = Pick<CmsProductInventoryItem,
  "pancakeProductId" | "pancakeVariationId" | "pancakeSku" | "pancakeQuantity" | "lastSyncedAt"
>;

function pancakeLinkKey(productId: string, rowKey: string) {
  return `${productId}::${rowKey}`;
}

let pancakeLinkWriteQueue = Promise.resolve();

export type CmsProduct = {
  id: string;
  name: string;
  price: string;
  originalPrice?: string;
  salePrice?: string;
  fit: string;
  kind: string;
  swatches: string[];
  sizes: string[];
  image: string;
  galleryImages?: string[];
  colorNames?: Record<string, string>;
  colorImages?: Record<string, string>;
  classifications?: CmsProductClassification[];
  inventory?: CmsProductInventoryItem[];
  inventoryManaged?: boolean;
  sold: number;
  genders?: string[];
  isBestSeller?: boolean;
  isNew: boolean;
  isSale: boolean;
  salePercent: number;
  active: boolean;
};

export type SiteContent = {
  brand: {
    name: string;
    logoUrl: string;
    footerText: string;
  };
  hero: {
    overline: string;
    titleHtml: string;
    description: string;
    themeImageUrl?: string;
  };
  menu: {
    menuTabLabel: string;
    supportTabLabel: string;
    menLabel: string;
    womenLabel: string;
    bestSellerLabel: string;
    newItemLabel: string;
    saleLabel: string;
    contactShortcutLabel: string;
    genderShortcutLabel: string;
  };
  support: {
    phoneLabel: string;
    phoneText: string;
    phoneHref: string;
    zaloLabel: string;
    zaloText: string;
    zaloHref: string;
    tiktokLabel: string;
    tiktokText: string;
    tiktokHref: string;
    facebookLabel: string;
    facebookText: string;
    facebookHref: string;
    hoursLabel: string;
    hoursText: string;
    wholesaleTitle: string;
    wholesalePhoneLabel: string;
    wholesalePhoneText: string;
    wholesalePhoneHref: string;
    wholesaleZaloLabel: string;
    wholesaleZaloText: string;
    wholesaleZaloHref: string;
  };
  footerColumns: Array<{
    title: string;
    lines: string[];
  }>;
  payment: {
    bank: {
      receiverName: string;
      accountNumber: string;
      bankName: string;
      bankCode: string;
    };
  };
  products: CmsProduct[];
};

export const defaultSiteContent: SiteContent = {
  brand: {
    name: "BLANWHI",
    logoUrl: "/umbrella-logo.png",
    footerText: "BLANWHI · Thời trang tối giản, chất riêng"
  },
  hero: {
    overline: "Simple is forever",
    titleHtml: "Đơn giản.<br />Chất riêng.",
    description: "BLANWHI là shop áo thun basic & minimal, chất liệu chọn lọc, form chuẩn, dành cho mọi phong cách.",
    themeImageUrl: ""
  },
  menu: {
    menuTabLabel: "Menu",
    supportTabLabel: "Liên hệ / Đơn sỉ",
    menLabel: "Nam",
    womenLabel: "Nữ",
    bestSellerLabel: "Best Sellers",
    newItemLabel: "New",
    saleLabel: "Sale",
    contactShortcutLabel: "Liên hệ / Đơn sỉ",
    genderShortcutLabel: "Nam / Nữ"
  },
  support: {
    phoneLabel: "SDT",
    phoneText: "0900 000 000",
    phoneHref: "tel:0900000000",
    zaloLabel: "Zalo",
    zaloText: "zalo.me/0900000000",
    zaloHref: "https://zalo.me/0900000000",
    tiktokLabel: "TikTok",
    tiktokText: "@blanwhi.official",
    tiktokHref: "https://www.tiktok.com/@blanwhi.official",
    facebookLabel: "FACEBOOK",
    facebookText: "facebook.com/nhunglathucotton",
    facebookHref: "https://www.facebook.com/nhunglathucotton",
    hoursLabel: "Giờ làm việc",
    hoursText: "9h30 - 20h00, Thứ 2 - Thứ 7",
    wholesaleTitle: "Đồng phục / Đơn sỉ",
    wholesalePhoneLabel: "SDT",
    wholesalePhoneText: "0900 000 000",
    wholesalePhoneHref: "tel:0900000000",
    wholesaleZaloLabel: "Zalo",
    wholesaleZaloText: "zalo.me/0900000000",
    wholesaleZaloHref: "https://zalo.me/0900000000"
  },
  footerColumns: [
    { title: "Về BLANWHI", lines: ["Về chúng tôi", "Tuyển dụng", "Hệ thống cửa hàng"] },
    { title: "Chăm sóc khách hàng", lines: ["Câu hỏi thường gặp", "Chính sách đổi trả", "Điều khoản khuyến mãi"] },
    { title: "Kết nối<br />cùng BLANWHI", lines: ["Địa chỉ email", "Khi đăng ký, bạn đồng ý với các điều khoản của BLANWHI."] }
  ],
  payment: {
    bank: {
      receiverName: "BLANWHI STORE",
      accountNumber: "0123 456 789",
      bankName: "Vietcombank",
      bankCode: "vcb"
    }
  },
  products: [
    ["Essential Heavy Tee", "420.000đ", "Boxy sạch, dễ mặc", "tee", ["#111", "#f4f4f2", "#8c8c88"]],
    ["Boxy Street Tee", "460.000đ", "Boxy sạch, dễ mặc", "tee", ["#303030", "#c9c5bd", "#59614c"]],
    ["Soft Rib Tank", "340.000đ", "Boxy sạch, dễ mặc", "tee", ["#f4f4f2", "#8c8c88", "#111"]],
    ["Minimal Logo Tee", "390.000đ", "Boxy sạch, dễ mặc", "tee", ["#dedbd4", "#111", "#1f2937"]],
    ["Drop Shoulder Hoodie", "890.000đ", "Rộng nhẹ, vai rũ vừa", "hoodie", ["#8c8c88", "#111", "#c9c5bd"]],
    ["Thermal Zip Hoodie", "960.000đ", "Rộng nhẹ, vai rũ vừa", "hoodie", ["#303030", "#59614c", "#dedbd4"]],
    ["Wide Leg Trouser", "740.000đ", "Ống thoải mái, cạp vừa", "pants", ["#111", "#8c8c88", "#c9c5bd"]],
    ["Relaxed Cargo Pants", "790.000đ", "Ống thoải mái, cạp vừa", "pants", ["#59614c", "#303030", "#111"]],
    ["Clean Tapered Pants", "690.000đ", "Ống thoải mái, cạp vừa", "pants", ["#1f2937", "#111", "#8c8c88"]],
    ["Utility Shorts", "520.000đ", "Boxy sạch, dễ mặc", "pants", ["#111", "#c9c5bd", "#59614c"]],
    ["Overshirt Slate", "780.000đ", "Boxy sạch, dễ mặc", "jacket", ["#8c8c88", "#303030", "#f4f4f2"]],
    ["Crisp Oxford Shirt", "650.000đ", "Boxy sạch, dễ mặc", "tee", ["#f4f4f2", "#1f2937", "#dedbd4"]],
    ["Minimal Coach Jacket", "1.150.000đ", "Boxy sạch, dễ mặc", "jacket", ["#111", "#303030", "#c9c5bd"]],
    ["Cropped Work Jacket", "1.280.000đ", "Boxy sạch, dễ mặc", "jacket", ["#59614c", "#111", "#8c8c88"]],
    ["Long Sleeve Layer Tee", "490.000đ", "Boxy sạch, dễ mặc", "tee", ["#f4f4f2", "#8c8c88", "#303030"]],
    ["Everyday Sweatpants", "720.000đ", "Ống thoải mái, cạp vừa", "pants", ["#8c8c88", "#111", "#dedbd4"]],
    ["Half Zip Sweat", "880.000đ", "Rộng nhẹ, vai rũ vừa", "hoodie", ["#c9c5bd", "#303030", "#1f2937"]],
    ["Open Collar Shirt", "620.000đ", "Boxy sạch, dễ mặc", "tee", ["#111", "#f4f4f2", "#59614c"]],
    ["Studio Nylon Shorts", "480.000đ", "Boxy sạch, dễ mặc", "pants", ["#303030", "#c9c5bd", "#1f2937"]],
    ["Monochrome Layer Jacket", "1.390.000đ", "Boxy sạch, dễ mặc", "jacket", ["#111", "#dedbd4", "#8c8c88"]]
  ].map(([name, price, fit, kind, swatches], index) => ({
    id: `p${index + 1}`,
    name: String(name),
    price: String(price),
    originalPrice: String(price),
    salePrice: "",
    fit: String(fit),
    kind: String(kind),
    swatches: swatches as string[],
    sizes: ["S", "M", "L", "XL"],
    image: "",
    galleryImages: [],
    colorNames: {},
    genders: index % 3 === 0 ? ["women"] : index % 3 === 1 ? ["men"] : ["men", "women"],
    sold: [680, 740, 180, 520, 860, 330, 790, 610, 420, 260, 310, 240, 700, 360, 450, 580, 820, 390, 300, 650][index] || 0,
    isBestSeller: ([680, 740, 180, 520, 860, 330, 790, 610, 420, 260, 310, 240, 700, 360, 450, 580, 820, 390, 300, 650][index] || 0) >= 650,
    isNew: index >= 14,
    isSale: ["p3", "p9", "p10", "p11", "p16", "p19"].includes(`p${index + 1}`),
    salePercent: ["p3", "p9", "p10", "p11", "p16", "p19"].includes(`p${index + 1}`) ? (index % 2 ? 15 : 10) : 0,
    active: true
  }))
};

export async function readSiteContent(): Promise<SiteContent> {
  const [saved, pancakeLinks] = await Promise.all([
    readJsonStore<Partial<SiteContent>>("site-content.json", defaultSiteContent),
    readKeyedJsonStore<PancakeLinkSnapshot>("pancake-links", {})
  ]);
  const defaultProductsById = new Map(defaultSiteContent.products.map((product) => [product.id, product]));
  const products = (saved.products || defaultSiteContent.products).map((product) => {
    const fallback = defaultProductsById.get(product.id) || {} as Partial<CmsProduct>;
    const originalPrice = product.originalPrice || fallback.originalPrice || product.price || fallback.price || "";
    const salePrice = product.salePrice || fallback.salePrice || "";
    const originalAmount = parseMoneyValue(originalPrice);
    const saleAmount = parseMoneyValue(salePrice);
    const hasDiscount = Boolean(salePrice) && originalAmount > 0 && saleAmount > 0 && saleAmount < originalAmount;
    const normalizedProduct = {
      ...fallback,
      ...product,
      originalPrice,
      salePrice,
      price: hasDiscount ? salePrice : originalPrice,
      isSale: hasDiscount,
      salePercent: hasDiscount ? Math.max(1, Math.round((originalAmount - saleAmount) / originalAmount * 100)) : 0,
      inventoryManaged: Boolean(product.inventoryManaged) || Boolean(fallback.inventoryManaged) || (Array.isArray(product.inventory) && product.inventory.some((item) => Number(item.quantity) > 0)),
      galleryImages: Array.isArray(product.galleryImages) ? product.galleryImages : (fallback.galleryImages || []),
      colorNames: product.colorNames && typeof product.colorNames === "object" ? product.colorNames : (fallback.colorNames || {}),
      colorImages: product.colorImages && typeof product.colorImages === "object" ? product.colorImages : (fallback.colorImages || {}),
      classifications: Array.isArray(product.classifications) ? product.classifications.map((classification) => ({
        ...classification,
        swatches: Array.isArray(classification.swatches) ? classification.swatches : [],
        colorNames: classification.colorNames && typeof classification.colorNames === "object" ? classification.colorNames : {},
        colorImages: classification.colorImages && typeof classification.colorImages === "object" ? classification.colorImages : {}
      })) : (fallback.classifications || []),
      genders: product.genders && product.genders.length ? product.genders : (fallback.genders || ["men", "women"]),
      isBestSeller: product.isBestSeller === undefined ? Boolean(fallback.isBestSeller || product.sold >= 650) : product.isBestSeller
    };
    const inventory = buildProductInventory(normalizedProduct as CmsProduct).map((row) => {
      const persistedLink = pancakeLinks[pancakeLinkKey(product.id, row.key)];
      return persistedLink ? { ...row, ...persistedLink } : row;
    });
    return { ...normalizedProduct, inventory };
  });
  return {
    ...defaultSiteContent,
    ...saved,
    brand: {
      ...defaultSiteContent.brand,
      ...saved.brand,
      footerText: translateLegacyFooterText(saved.brand?.footerText || defaultSiteContent.brand.footerText)
    },
    hero: { ...defaultSiteContent.hero, ...saved.hero },
    menu: { ...defaultSiteContent.menu, ...saved.menu },
    support: { ...defaultSiteContent.support, ...saved.support },
    footerColumns: translateLegacyFooterColumns(saved.footerColumns || defaultSiteContent.footerColumns),
    payment: {
      bank: {
        ...defaultSiteContent.payment.bank,
        ...saved.payment?.bank
      }
    },
    products
  };
}

export async function writeSiteContent(content: SiteContent) {
  return writeJsonStore("site-content.json", content);
}

export async function writePancakeProductLink(productId: string, rowKey: string, link: PancakeLinkSnapshot) {
  const key = pancakeLinkKey(productId, rowKey);
  let saved!: PancakeLinkSnapshot;
  const operation = pancakeLinkWriteQueue.then(async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await writeKeyedJsonRecord("pancake-links", key, link);
      const verified = await readKeyedJsonStore<PancakeLinkSnapshot>("pancake-links", {});
      const candidate = verified[key];
      if (candidate
        && String(candidate.pancakeVariationId || "") === String(link.pancakeVariationId || "")
        && String(candidate.pancakeSku || "") === String(link.pancakeSku || "")) {
        saved = candidate;
        return;
      }
    }
    throw new Error("PANCAKE_LINK_PERSIST_FAILED");
  });
  pancakeLinkWriteQueue = operation.catch(() => undefined);
  await operation;
  return saved;
}

export async function seedPancakeProductLinks(content: SiteContent) {
  const snapshots = content.products.flatMap((product) => buildProductInventory(product)
    .filter((row) => row.pancakeProductId || row.pancakeVariationId || row.pancakeSku)
    .map((row) => ({
      key: pancakeLinkKey(product.id, row.key),
      link: {
        pancakeProductId: row.pancakeProductId || "",
        pancakeVariationId: row.pancakeVariationId || "",
        pancakeSku: row.pancakeSku || "",
        pancakeQuantity: row.pancakeQuantity || 0,
        lastSyncedAt: row.lastSyncedAt
      } satisfies PancakeLinkSnapshot
    })));
  if (!snapshots.length) return 0;

  let added = 0;
  const operation = pancakeLinkWriteQueue.then(async () => {
    const current = await readKeyedJsonStore<PancakeLinkSnapshot>("pancake-links", {});
    const next = { ...current };
    for (const snapshot of snapshots) {
      if (Object.prototype.hasOwnProperty.call(next, snapshot.key)) continue;
      next[snapshot.key] = snapshot.link;
      added += 1;
    }
    if (added) {
      await Promise.all(snapshots
        .filter((snapshot) => !Object.prototype.hasOwnProperty.call(current, snapshot.key))
        .map((snapshot) => writeKeyedJsonRecord("pancake-links", snapshot.key, snapshot.link)));
    }
  });
  pancakeLinkWriteQueue = operation.catch(() => undefined);
  await operation;
  return added;
}

export async function writeSiteContentFromAdmin(content: SiteContent) {
  const latest = await readSiteContent();
  const latestProducts = new Map(latest.products.map((product) => [product.id, product]));
  const products = content.products.map((product) => {
    const latestProduct = latestProducts.get(product.id);
    if (!latestProduct) return product;
    const latestRows = new Map(buildProductInventory(latestProduct).map((row) => [row.key, row]));
    return {
      ...product,
      inventory: buildProductInventory(product).map((row) => {
        const latestRow = latestRows.get(row.key);
        if (!latestRow) return row;
        return {
          ...row,
          pancakeProductId: latestRow.pancakeProductId || "",
          pancakeVariationId: latestRow.pancakeVariationId || "",
          pancakeSku: latestRow.pancakeSku || "",
          pancakeQuantity: latestRow.pancakeQuantity || 0,
          lastSyncedAt: latestRow.lastSyncedAt
        };
      })
    };
  });
  return writeSiteContent({ ...content, products });
}

function parseMoneyValue(value: string) {
  return Number(String(value || "").replace(/[^0-9]/g, "")) || 0;
}

const legacyFooterTranslations: Record<string, string> = {
  "Company": "Về BLANWHI",
  "About Us": "Về chúng tôi",
  "Join Us": "Tuyển dụng",
  "Store Locator": "Hệ thống cửa hàng",
  "Customer Care": "Chăm sóc khách hàng",
  "FAQ": "Câu hỏi thường gặp",
  "Return Policy": "Chính sách đổi trả",
  "Promotion Terms": "Điều khoản khuyến mãi",
  "Let’s stay<br />in touch.": "Kết nối<br />cùng BLANWHI",
  "E-mail address": "Địa chỉ email",
  "By clicking subscribe, you agree to BLANWHI terms.": "Khi đăng ký, bạn đồng ý với các điều khoản của BLANWHI."
};

function translateLegacyFooterText(value: string) {
  return value === "BLANWHI · Minimal commerce prototype"
    ? "BLANWHI · Thời trang tối giản, chất riêng"
    : value;
}

function translateLegacyFooterColumns(columns: SiteContent["footerColumns"]) {
  return columns.map((column) => ({
    title: legacyFooterTranslations[column.title] || column.title,
    lines: column.lines.map((line) => legacyFooterTranslations[line] || line)
  }));
}
