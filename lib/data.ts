import { Combo, Product } from "./types";

export const colors = {
  black: { name: "Đen", value: "#111111", tone: "dark" as const },
  white: { name: "Trắng", value: "#f4f4f2", tone: "light" as const },
  grey: { name: "Xám tro", value: "#8c8c88", tone: "neutral" as const },
  charcoal: { name: "Than", value: "#303030", tone: "dark" as const },
  navy: { name: "Navy lạnh", value: "#1f2937", tone: "cool" as const },
  stone: { name: "Đá", value: "#c9c5bd", tone: "neutral" as const },
  olive: { name: "Olive", value: "#59614c", tone: "warm" as const },
  ash: { name: "Ash", value: "#dedbd4", tone: "light" as const }
};

const image = (id: string) =>
  `https://images.unsplash.com/${id}?auto=format&fit=crop&w=1100&q=85`;

export const products: Product[] = [
  ["p01", "Essential Heavy Tee", "T-shirt", 420000, "photo-1523398002811-999ca8dec234", [colors.black, colors.white, colors.grey], "Cotton 260gsm", true],
  ["p02", "Boxy Street Tee", "T-shirt", 460000, "photo-1503341504253-dff4815485f1", [colors.charcoal, colors.stone, colors.olive], "Cotton compact", true],
  ["p03", "Soft Rib Tank", "T-shirt", 340000, "photo-1515886657613-9f3515b0c78f", [colors.white, colors.grey, colors.black], "Rib cotton", false],
  ["p04", "Minimal Logo Tee", "T-shirt", 390000, "photo-1489987707025-afc232f7ea0f", [colors.ash, colors.black, colors.navy], "Cotton 230gsm", true],
  ["p05", "Drop Shoulder Hoodie", "Hoodie", 890000, "photo-1556821840-3a63f95609a7", [colors.grey, colors.black, colors.stone], "Fleece 420gsm", true],
  ["p06", "Thermal Zip Hoodie", "Hoodie", 960000, "photo-1611312449408-fcece27cdbb7", [colors.charcoal, colors.olive, colors.ash], "Thermal fleece", false],
  ["p07", "Wide Leg Trouser", "Pants", 740000, "photo-1473966968600-fa801b869a1a", [colors.black, colors.grey, colors.stone], "Twill mềm", true],
  ["p08", "Relaxed Cargo Pants", "Pants", 790000, "photo-1511556820780-d912e42b4980", [colors.olive, colors.charcoal, colors.black], "Cotton twill", false],
  ["p09", "Clean Tapered Pants", "Pants", 690000, "photo-1506629905607-d9f297d65ef5", [colors.navy, colors.black, colors.grey], "Wool blend", false],
  ["p10", "Utility Shorts", "Shorts", 520000, "photo-1591195853828-11db59a44f6b", [colors.black, colors.stone, colors.olive], "Nylon cotton", true],
  ["p11", "Overshirt Slate", "Shirt", 780000, "photo-1520975954732-35dd22299614", [colors.grey, colors.charcoal, colors.white], "Canvas nhẹ", false],
  ["p12", "Crisp Oxford Shirt", "Shirt", 650000, "photo-1602810318383-e386cc2a3ccf", [colors.white, colors.navy, colors.ash], "Oxford cotton", false],
  ["p13", "Minimal Coach Jacket", "Jacket", 1150000, "photo-1496747611176-843222e1e57c", [colors.black, colors.charcoal, colors.stone], "Nylon matte", true],
  ["p14", "Cropped Work Jacket", "Jacket", 1280000, "photo-1539533018447-63fcce2678e3", [colors.olive, colors.black, colors.grey], "Cotton canvas", false],
  ["p15", "Long Sleeve Layer Tee", "T-shirt", 490000, "photo-1551232864-3f0890e580d9", [colors.white, colors.grey, colors.charcoal], "Cotton jersey", false],
  ["p16", "Everyday Sweatpants", "Pants", 720000, "photo-1542272604-787c3835535d", [colors.grey, colors.black, colors.ash], "French terry", false],
  ["p17", "Half Zip Sweat", "Hoodie", 880000, "photo-1578681994506-b8f463449011", [colors.stone, colors.charcoal, colors.navy], "Fleece brushed", true],
  ["p18", "Open Collar Shirt", "Shirt", 620000, "photo-1593030761757-71fae45fa0e7", [colors.black, colors.white, colors.olive], "Rayon blend", false],
  ["p19", "Studio Nylon Shorts", "Shorts", 480000, "photo-1565084888279-aca607ecce0c", [colors.charcoal, colors.stone, colors.navy], "Nylon matte", false],
  ["p20", "Monochrome Layer Jacket", "Jacket", 1390000, "photo-1516257984-b1b4d707412e", [colors.black, colors.ash, colors.grey], "Tech cotton", true]
].map(([id, name, type, price, img, productColors, material, featured]) => ({
  id,
  name,
  type,
  price,
  image: image(img as string),
  videoFabric: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
  videoColor: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.webm",
  colors: productColors,
  sizes: ["S", "M", "L", "XL"],
  stock: { S: 6, M: 12, L: 9, XL: 4 },
  fit: type === "Hoodie" ? "Rộng nhẹ, vai rũ vừa" : type === "Pants" ? "Ống thoải mái, cạp vừa" : "Boxy sạch, dễ mặc",
  material,
  featured
} as Product));

export const combos: Combo[] = [
  { id: "c01", title: "Áo thun + quần", description: "Một set sạch cho ngày thường.", productIds: ["p01", "p07"], price: 1040000, originalPrice: 1160000 },
  { id: "c02", title: "Hoodie + áo thun", description: "Layer lạnh, gọn và street.", productIds: ["p05", "p04"], price: 1190000, originalPrice: 1280000 },
  { id: "c03", title: "2 áo cùng tone", description: "Đen và xám, xoay outfit cả tuần.", productIds: ["p01", "p02"], price: 790000, originalPrice: 880000 }
];

export const faq = [
  ["Phí ship thế nào?", "Đơn từ 2 triệu được freeship. Đơn nội thành thường giao trong 1-2 ngày."],
  ["Đổi size được không?", "Được đổi trong 7 ngày nếu sản phẩm còn tag và chưa qua giặt."],
  ["Chất liệu có dày không?", "Áo tee chính dùng 95% cotton, 5% spandex khoảng 230-260gsm; hoodie fleece 420gsm, đứng form nhưng vẫn mềm."],
  ["Thanh toán ra sao?", "Có COD, thẻ, chuyển khoản và ví điện tử ở checkout một trang."]
];
