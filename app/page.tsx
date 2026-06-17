"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Filter, Menu, Search, ShoppingBag, User } from "lucide-react";
import { useMemo, useState } from "react";
import { CartDrawer } from "@/components/CartDrawer";
import { CheckoutForm } from "@/components/CheckoutForm";
import { ComboSuggestion } from "@/components/ComboSuggestion";
import { CustomBuilder } from "@/components/CustomBuilder";
import { ProductCard } from "@/components/ProductCard";
import { ProductDetail } from "@/components/ProductDetail";
import { SizeAdvisor } from "@/components/SizeAdvisor";
import { StyleAssistant } from "@/components/StyleAssistant";
import { products } from "@/lib/data";
import { itemCount, money } from "@/lib/pricing";
import { CartItem, ColorOption, Combo, Product } from "@/lib/types";

const types = ["Tất cả", "T-shirt", "Hoodie", "Pants", "Jacket", "Shirt", "Shorts"];
const sizes = ["Tất cả", "S", "M", "L", "XL"];
const tones = ["Tất cả", "light", "dark", "neutral", "warm", "cool"];

export default function Home() {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [type, setType] = useState("Tất cả");
  const [size, setSize] = useState("Tất cả");
  const [tone, setTone] = useState("Tất cả");
  const [price, setPrice] = useState(1400000);

  const visibleProducts = useMemo(() => products.filter((product) => {
    const typeOk = type === "Tất cả" || product.type === type;
    const sizeOk = size === "Tất cả" || product.sizes.includes(size);
    const toneOk = tone === "Tất cả" || product.colors.some((color) => color.tone === tone);
    return typeOk && sizeOk && toneOk && product.price <= price;
  }), [type, size, tone, price]);

  const addItem = (product: Product, color: ColorOption, pickedSize: string) => {
    setCart((current) => {
      const index = current.findIndex((item) => item.product.id === product.id && item.color.name === color.name && item.size === pickedSize);
      if (index >= 0) {
        return current.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: item.quantity + 1 } : item);
      }
      return [...current, { product, color, size: pickedSize, quantity: 1 }];
    });
    setCartOpen(true);
  };

  const addCombo = (combo: Combo) => {
    combo.productIds.forEach((id) => {
      const product = products.find((item) => item.id === id);
      if (product) addItem(product, product.colors[0], product.sizes[1]);
    });
  };

  const qty = (index: number, delta: number) => {
    setCart((current) => current.flatMap((item, itemIndex) => {
      if (itemIndex !== index) return item;
      const quantity = item.quantity + delta;
      return quantity <= 0 ? [] : { ...item, quantity };
    }));
  };

  return (
    <main className="mx-auto my-0 min-h-screen max-w-[1160px] bg-white md:my-16">
      <header className="sticky top-0 z-20 bg-white/95 px-6 backdrop-blur md:px-14">
        <div className="mx-auto flex h-16 items-center justify-between">
          <div className="flex items-center gap-4">
            <Menu size={16} strokeWidth={1.5} />
            <Search size={16} strokeWidth={1.5} />
          </div>
          <a href="#" className="flex items-center gap-2 text-xs uppercase text-neutral-500">
            <img src="/umbrella-logo.png" alt="BLANWHI umbrella logo" className="h-8 w-8 object-contain mix-blend-multiply" />
            <span>BLANWHI</span>
          </a>
          <div className="flex items-center gap-4">
            <User size={16} strokeWidth={1.5} />
            <button onClick={() => setCartOpen(true)} className="focus-ring flex items-center gap-1 text-xs uppercase">
              <ShoppingBag size={16} strokeWidth={1.5} />
              {itemCount(cart)}
            </button>
          </div>
        </div>
      </header>

      <section className="px-6 pb-10 pt-10 md:px-14">
        <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.65 }} className="relative">
          <div className="grid gap-6 md:grid-cols-[1.1fr_.9fr] md:items-center">
            <div>
              <div className="flex items-center gap-4 md:gap-6">
                <span className="grid h-16 w-16 shrink-0 place-items-center bg-black sm:h-24 sm:w-24 md:h-28 md:w-28">
                  <img src="/umbrella-logo.png" alt="BLANWHI umbrella logo" className="h-12 w-12 object-contain invert sm:h-[72px] sm:w-[72px] md:h-20 md:w-20" />
                </span>
                <h1 className="text-[52px] font-semibold uppercase leading-[0.88] text-black sm:text-[96px] md:text-[132px]">BLANWHI</h1>
              </div>
            </div>
            <div className="flex items-end justify-center gap-5 md:justify-end">
              <div className="relative h-56 w-40 md:h-72 md:w-52">
                <div className="absolute left-1/2 top-10 h-44 w-28 -translate-x-1/2 rounded-t-[28px] border border-neutral-200 bg-white shadow-[0_20px_40px_rgba(0,0,0,.08)] md:h-56 md:w-36" />
                <div className="absolute left-3 top-16 h-28 w-14 rotate-12 border border-neutral-200 bg-white md:left-4 md:h-36 md:w-16" />
                <div className="absolute right-3 top-16 h-28 w-14 -rotate-12 border border-neutral-200 bg-white md:right-4 md:h-36 md:w-16" />
                <div className="absolute left-1/2 top-10 h-9 w-12 -translate-x-1/2 rounded-b-full border-b border-neutral-200 bg-white" />
              </div>
              <div className="relative h-56 w-40 md:h-72 md:w-52">
                <div className="absolute left-1/2 top-10 h-44 w-28 -translate-x-1/2 rounded-t-[28px] bg-black shadow-[0_20px_40px_rgba(0,0,0,.16)] md:h-56 md:w-36" />
                <div className="absolute left-3 top-16 h-28 w-14 rotate-12 bg-black md:left-4 md:h-36 md:w-16" />
                <div className="absolute right-3 top-16 h-28 w-14 -rotate-12 bg-black md:right-4 md:h-36 md:w-16" />
                <div className="absolute left-1/2 top-10 h-9 w-12 -translate-x-1/2 rounded-b-full border-b border-white/15 bg-black" />
              </div>
            </div>
          </div>
          <nav className="mt-12 flex flex-wrap justify-center gap-7 text-sm text-neutral-500 md:gap-12">
            <a href="#shop">New</a>
            <a href="#shop">Best Sellers</a>
            <a href="#lookbook">T-shirts</a>
            <a href="#lookbook">Hoodies</a>
            <a href="#custom">Uniforms</a>
            <a href="#checkout">Checkout</a>
          </nav>
        </div>
      </section>

      <div className="px-6 md:px-14">
        <section id="shop" className="py-12">
          <div className="mb-8 grid gap-5 md:grid-cols-[1fr_380px] md:items-end">
            <div>
              <p className="text-xs uppercase text-neutral-500">All products in one page</p>
              <h2 className="editorial-title mt-2 text-4xl leading-tight md:text-6xl">Tổng hợp 20 sản phẩm.</h2>
            </div>
            <p className="text-sm leading-6 text-neutral-500">Lướt xuống là thấy toàn bộ catalog trước, sau đó mới tới combo, tư vấn size, custom và checkout. Quick add vẫn nằm ngay trên card.</p>
          </div>
          <div className="mb-7 grid gap-3 border-y border-neutral-300 py-4 md:grid-cols-[1.2fr_.8fr_.8fr_1fr]">
            <Filter className="hidden self-center md:block" size={18} />
            <select value={type} onChange={(e) => setType(e.target.value)} className="h-11 border border-neutral-200 bg-white px-3 text-sm">{types.map((item) => <option key={item}>{item}</option>)}</select>
            <select value={tone} onChange={(e) => setTone(e.target.value)} className="h-11 border border-neutral-200 bg-white px-3 text-sm">{tones.map((item) => <option key={item}>{item}</option>)}</select>
            <select value={size} onChange={(e) => setSize(e.target.value)} className="h-11 border border-neutral-200 bg-white px-3 text-sm">{sizes.map((item) => <option key={item}>{item}</option>)}</select>
            <label className="text-xs text-neutral-500 md:col-span-4">Giá tối đa {money(price)}<input type="range" min={300000} max={1400000} step={50000} value={price} onChange={(e) => setPrice(Number(e.target.value))} className="mt-2 w-full" /></label>
          </div>
          <motion.div layout className="grid gap-x-5 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
            {visibleProducts.map((product) => (
              <ProductCard key={product.id} product={product} onQuickAdd={addItem} onOpen={setSelectedProduct} />
            ))}
          </motion.div>
        </section>

        <section className="grid gap-8 py-10 md:grid-cols-[.82fr_1.18fr] md:items-center">
          <div>
            <h2 className="text-3xl font-semibold leading-none">Package<br />with a degree in simplicity</h2>
            <p className="mt-4 max-w-xs text-sm leading-6 text-neutral-500">BLANWHI chọn ít sản phẩm, nhiều khoảng trắng và thao tác mua cực nhanh. Minimal không phải là thiếu, mà là bỏ bớt thứ không cần.</p>
            <a href="#shop" className="mt-6 inline-flex rounded-full bg-neutral-100 px-6 py-2 text-sm">Discover</a>
          </div>
          <img src="https://images.unsplash.com/photo-1523398002811-999ca8dec234?auto=format&fit=crop&w=1200&q=88" alt="BLANWHI product mood" className="aspect-[16/10] w-full object-cover grayscale" />
        </section>

        <section className="border-y border-neutral-300 py-4 text-center text-sm uppercase text-neutral-700">
          BLANWHI / WHITE SPACE / BLACK TYPE / FAST CHECKOUT / QUIET LAYERS
        </section>

        <section id="lookbook" className="grid gap-8 py-16 md:grid-cols-[1.1fr_.9fr] md:items-center">
          <img src="https://images.unsplash.com/photo-1556821840-3a63f95609a7?auto=format&fit=crop&w=1200&q=85" alt="Hoodie lookbook" className="aspect-[5/4] w-full object-cover grayscale" />
          <div className="md:px-10">
            <h2 className="editorial-title text-5xl leading-none md:text-7xl">Hoodies</h2>
            <p className="mt-5 max-w-sm text-sm leading-7 text-neutral-500">Layer cho thành phố: hoodie, sweatpants, tee và jacket trong một bảng màu lạnh, dễ phối, dễ mua.</p>
            <a href="#shop" className="mt-7 inline-flex border-b border-black pb-2 text-xs uppercase">Shop all hoodies</a>
          </div>
        </section>

        <section className="grid gap-8 py-16 md:grid-cols-[.85fr_1.15fr] md:items-center">
          <div className="md:px-10">
            <h2 className="editorial-title text-5xl leading-none md:text-7xl">Uniforms</h2>
            <p className="mt-5 max-w-sm text-sm leading-7 text-neutral-500">Custom builder giữ giao diện tối giản nhưng đủ mạnh: upload logo, kéo mockup, chọn vị trí in và xem giá ngay.</p>
            <a href="#custom" className="mt-7 inline-flex border-b border-black pb-2 text-xs uppercase">Build custom set</a>
          </div>
          <img src="https://images.unsplash.com/photo-1511556820780-d912e42b4980?auto=format&fit=crop&w=1200&q=85" alt="Streetwear uniform mood" className="aspect-[5/4] w-full object-cover grayscale md:order-last" />
        </section>

        <section className="py-10">
          <ComboSuggestion onAddCombo={addCombo} />
        </section>

        <SizeAdvisor />
        <CustomBuilder />
        <CheckoutForm items={cart} onAddCombo={addCombo} />

        <section className="grid gap-4 border-t border-neutral-200 py-12 md:grid-cols-[.7fr_1.3fr]">
          <h2 className="text-2xl font-medium">FAQ nhanh</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {["Phí ship tự hiện theo voucher.", "Đổi trả 7 ngày nếu còn tag.", "Video chất vải nằm ngay trong product detail.", "Combo gợi ý xuất hiện ở product, cart và checkout."].map((item) => (
              <div key={item} className="border border-neutral-200 bg-white p-4 text-sm text-neutral-600">{item}</div>
            ))}
          </div>
        </section>
      </div>

      <footer className="border-t border-neutral-300 px-4 py-10 text-center text-xs uppercase text-neutral-500">
        <img src="/umbrella-logo.png" alt="Umbrella logo" className="mx-auto mb-3 h-12 w-12 object-contain mix-blend-multiply" />
        BLANWHI · Minimal commerce prototype
      </footer>

      <AnimatePresence>
        {selectedProduct && (
          <ProductDetail
            product={selectedProduct}
            onClose={() => setSelectedProduct(null)}
            onAdd={addItem}
            onBuyNow={(product, color, pickedSize) => {
              addItem(product, color, pickedSize);
              setSelectedProduct(null);
              document.getElementById("checkout")?.scrollIntoView({ behavior: "smooth" });
            }}
            onAddCombo={addCombo}
          />
        )}
      </AnimatePresence>
      <CartDrawer open={cartOpen} items={cart} onClose={() => setCartOpen(false)} onQty={qty} onCheckout={() => {
        setCartOpen(false);
        document.getElementById("checkout")?.scrollIntoView({ behavior: "smooth" });
      }} onAddCombo={addCombo} />
      <StyleAssistant />
    </main>
  );
}
