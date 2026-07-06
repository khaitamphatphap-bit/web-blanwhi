import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

export type CmsProduct = {
  id: string;
  name: string;
  price: string;
  fit: string;
  kind: string;
  swatches: string[];
  sizes: string[];
  image: string;
  colorImages?: Record<string, string>;
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
  footerColumns: Array<{
    title: string;
    lines: string[];
  }>;
  products: CmsProduct[];
};

const dataDir = path.join(process.cwd(), "data");
const siteContentFile = path.join(dataDir, "site-content.json");

export const defaultSiteContent: SiteContent = {
  brand: {
    name: "BLANWHI",
    logoUrl: "/umbrella-logo.png",
    footerText: "BLANWHI · Minimal commerce prototype"
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
  footerColumns: [
    { title: "Company", lines: ["About Us", "Join Us", "Store Locator"] },
    { title: "Customer Care", lines: ["FAQ", "Return Policy", "Promotion Terms"] },
    { title: "Let’s stay<br />in touch.", lines: ["E-mail address", "By clicking subscribe, you agree to BLANWHI terms."] }
  ],
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
    fit: String(fit),
    kind: String(kind),
    swatches: swatches as string[],
    sizes: ["S", "M", "L", "XL"],
    image: "",
    genders: index % 3 === 0 ? ["women"] : index % 3 === 1 ? ["men"] : ["men", "women"],
    sold: [680, 740, 180, 520, 860, 330, 790, 610, 420, 260, 310, 240, 700, 360, 450, 580, 820, 390, 300, 650][index] || 0,
    isBestSeller: ([680, 740, 180, 520, 860, 330, 790, 610, 420, 260, 310, 240, 700, 360, 450, 580, 820, 390, 300, 650][index] || 0) >= 650,
    isNew: index >= 14,
    isSale: ["p3", "p9", "p10", "p11", "p16", "p19"].includes(`p${index + 1}`),
    salePercent: ["p3", "p9", "p10", "p11", "p16", "p19"].includes(`p${index + 1}`) ? (index % 2 ? 15 : 10) : 0,
    active: true
  }))
};

async function ensureStore() {
  await mkdir(dataDir, { recursive: true });
  try {
    await readFile(siteContentFile, "utf8");
  } catch {
    await writeFile(siteContentFile, JSON.stringify(defaultSiteContent, null, 2), "utf8");
  }
}

export async function readSiteContent(): Promise<SiteContent> {
  await ensureStore();
  const raw = await readFile(siteContentFile, "utf8");
  const saved = JSON.parse(raw) as Partial<SiteContent>;
  const defaultProductsById = new Map(defaultSiteContent.products.map((product) => [product.id, product]));
  const products = (saved.products || defaultSiteContent.products).map((product) => {
    const fallback = defaultProductsById.get(product.id) || {} as Partial<CmsProduct>;
    return {
      ...fallback,
      ...product,
      genders: product.genders && product.genders.length ? product.genders : (fallback.genders || ["men", "women"]),
      isBestSeller: product.isBestSeller === undefined ? Boolean(fallback.isBestSeller || product.sold >= 650) : product.isBestSeller
    };
  });
  return {
    ...defaultSiteContent,
    ...saved,
    brand: { ...defaultSiteContent.brand, ...saved.brand },
    hero: { ...defaultSiteContent.hero, ...saved.hero },
    menu: { ...defaultSiteContent.menu, ...saved.menu },
    footerColumns: saved.footerColumns || defaultSiteContent.footerColumns,
    products
  };
}

export async function writeSiteContent(content: SiteContent) {
  await ensureStore();
  await writeFile(siteContentFile, JSON.stringify(content, null, 2), "utf8");
  return content;
}
