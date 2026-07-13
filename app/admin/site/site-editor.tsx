"use client";

import Link from "next/link";
import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { buildProductInventory } from "@/lib/product-inventory";
import type { CmsProduct, CmsProductClassification, CmsProductInventoryItem, SiteContent } from "@/lib/site-content";

const emptyProduct: CmsProduct = {
  id: "",
  name: "Sản phẩm mới",
  price: "390.000đ",
  originalPrice: "390.000đ",
  salePrice: "",
  fit: "Boxy sạch, dễ mặc",
  kind: "tee",
  swatches: ["#111", "#f4f4f2"],
  sizes: ["S", "M", "L", "XL"],
  image: "",
  galleryImages: [],
  colorNames: {},
  colorImages: {},
  inventory: [],
  inventoryManaged: false,
  sold: 0,
  genders: ["men", "women"],
  isBestSeller: false,
  isNew: true,
  isSale: false,
  salePercent: 0,
  active: true
};

const compressibleImageTypes = new Set(["image/png", "image/jpeg", "image/webp"]);

async function prepareImageForUpload(file: File) {
  if (!compressibleImageTypes.has(file.type) || file.size <= 2.5 * 1024 * 1024) return file;

  const bitmap = await createImageBitmap(file);
  const maxSide = 1800;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return file;

  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.82));
  if (!blob || blob.size >= file.size) return file;

  const name = file.name.replace(/\.[^.]+$/, "") || "blanwhi-image";
  return new File([blob], `${name}.webp`, { type: "image/webp" });
}

export function SiteEditor() {
  const [content, setContent] = useState<SiteContent | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [jsonDraft, setJsonDraft] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [inventoryBusy, setInventoryBusy] = useState("");
  const editorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    fetch("/api/site")
      .then((response) => response.json())
      .then((data) => {
        setContent(data);
        setSelectedId(data.products?.[0]?.id || "");
        setJsonDraft(JSON.stringify(data, null, 2));
      });
  }, []);

  const selectedProduct = useMemo(
    () => content?.products.find((product) => product.id === selectedId) || null,
    [content, selectedId]
  );

  function updateContent(next: SiteContent) {
    setContent(next);
    setJsonDraft(JSON.stringify(next, null, 2));
  }

  function updateProduct(product: CmsProduct) {
    if (!content) return;
    updateContent({
      ...content,
      products: content.products.map((item) => item.id === product.id ? product : item)
    });
  }

  function toggleProductGender(product: CmsProduct, gender: string, checked: boolean) {
    const genders = product.genders || ["men", "women"];
    const next = checked ? Array.from(new Set([...genders, gender])) : genders.filter((item) => item !== gender);
    updateProduct({ ...product, genders: next.length ? next : ["men", "women"] });
  }

  function selectProduct(id: string) {
    setSelectedId(id);
    window.setTimeout(() => {
      editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  }

  function addProduct() {
    if (!content) return;
    const id = `p${Date.now()}`;
    const product = { ...emptyProduct, id };
    updateContent({ ...content, products: [product, ...content.products] });
    setSelectedId(id);
  }

  function deleteProduct(id: string) {
    if (!content) return;
    const products = content.products.filter((product) => product.id !== id);
    updateContent({ ...content, products });
    setSelectedId(products[0]?.id || "");
  }

  function moveProduct(id: string, direction: "up" | "down") {
    if (!content) return;
    const currentIndex = content.products.findIndex((product) => product.id === id);
    const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= content.products.length) return;
    const products = [...content.products];
    const [product] = products.splice(currentIndex, 1);
    products.splice(targetIndex, 0, product);
    updateContent({ ...content, products });
    setSelectedId(id);
  }

  async function uploadImages(event: ChangeEvent<HTMLInputElement>, onUrls: (urls: string[]) => void) {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    setMessage(files.length > 1 ? `Đang upload ${files.length} ảnh...` : "Đang upload ảnh...");
    try {
      const urls: string[] = [];
      for (const file of files) {
        const uploadFile = await prepareImageForUpload(file);
        const form = new FormData();
        form.append("file", uploadFile);
        const response = await fetch("/api/admin/upload", { method: "POST", body: form });
        const result = await response.json();
        if (!response.ok) {
          setMessage(result.error || "Upload ảnh thất bại.");
          return;
        }
        urls.push(result.url);
      }
      onUrls(urls);
      setMessage(`Đã upload ${urls.length} ảnh. Nhấn Lưu thay đổi để cập nhật website khách.`);
    } catch {
      setMessage("Upload ảnh thất bại. Vui lòng thử lại.");
    } finally {
      event.target.value = "";
    }
  }

  async function uploadImage(event: ChangeEvent<HTMLInputElement>, onUrl: (url: string) => void) {
    return uploadImages(event, (urls) => {
      if (urls[0]) onUrl(urls[0]);
    });
  }

  async function save(next = content) {
    if (!next) return;
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/site", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next)
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || "Không thể lưu nội dung.");
      }
      const saved = await response.json();
      updateContent(saved);
      setMessage("Đã lưu. Trang khách sẽ tự cập nhật sau vài giây.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không thể lưu nội dung.");
    } finally {
      setSaving(false);
    }
  }

  function applyJson() {
    try {
      const parsed = JSON.parse(jsonDraft) as SiteContent;
      updateContent(parsed);
      setSelectedId(parsed.products?.[0]?.id || "");
      setMessage("Đã áp dụng JSON. Nhấn Lưu thay đổi để ghi vào server.");
    } catch {
      setMessage("JSON chưa hợp lệ.");
    }
  }

  function downloadBackup() {
    if (!content) return;
    const blob = new Blob([JSON.stringify(content, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `blanwhi-admin-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setMessage("Đã tải bản sao dữ liệu admin.");
  }

  async function importBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as SiteContent;
      updateContent(parsed);
      setSelectedId(parsed.products?.[0]?.id || "");
      setMessage("Đã nạp bản sao. Nhấn Lưu thay đổi để ghi cố định.");
    } catch {
      setMessage("File sao lưu JSON không hợp lệ.");
    } finally {
      event.target.value = "";
    }
  }

  async function syncInventory(target: "pos" | "misa", direction: "pull" | "push") {
    const busyKey = `${target}-${direction}`;
    setInventoryBusy(busyKey);
    setMessage("");
    try {
      const response = await fetch("/api/admin/inventory/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target, direction })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Không đồng bộ được tồn kho.");
      if (result.content) updateContent(result.content);
      setMessage(result.message || "Đã đồng bộ tồn kho.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không đồng bộ được tồn kho.");
    } finally {
      setInventoryBusy("");
    }
  }

  function updateFooterColumn(index: number, nextColumn: SiteContent["footerColumns"][number]) {
    if (!content) return;
    updateContent({
      ...content,
      footerColumns: content.footerColumns.map((column, columnIndex) => columnIndex === index ? nextColumn : column)
    });
  }

  function addFooterColumn() {
    if (!content) return;
    updateContent({
      ...content,
      footerColumns: [...content.footerColumns, { title: "Cột mới", lines: ["Nội dung mới"] }]
    });
  }

  function deleteFooterColumn(index: number) {
    if (!content) return;
    const footerColumns = content.footerColumns.filter((_, columnIndex) => columnIndex !== index);
    updateContent({ ...content, footerColumns: footerColumns.length ? footerColumns : [{ title: "Footer", lines: ["Nội dung"] }] });
  }

  if (!content) {
    return <main className="mx-auto min-h-screen max-w-6xl bg-white p-8">Đang tải admin...</main>;
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-7xl overflow-x-hidden bg-white px-4 py-8 sm:px-6 md:my-10 md:px-8 lg:px-10">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-neutral-200 pb-5">
        <div>
          <Link href="/" className="text-xs uppercase text-neutral-500">Xem website khách</Link>
          <h1 className="mt-2 text-4xl font-medium">Admin chỉnh website</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={downloadBackup} className="h-10 border border-neutral-300 px-4 text-xs uppercase">Tải bản sao</button>
          <label className="h-10 cursor-pointer border border-neutral-300 px-4 pt-2 text-xs uppercase">Nạp bản sao<input type="file" accept="application/json" onChange={importBackup} className="hidden" /></label>
          <Link href="/admin/orders" className="h-10 border border-black px-4 pt-2 text-xs uppercase">Đơn hàng</Link>
          <button onClick={() => save()} disabled={saving} className="h-10 bg-black px-5 text-xs uppercase text-white disabled:opacity-50">
            {saving ? "Đang lưu..." : "Lưu thay đổi"}
          </button>
        </div>
      </header>

      {message && <p className="mt-4 border border-neutral-200 bg-neutral-50 p-3 text-sm">{message}</p>}

      <section className="mt-4 border border-neutral-200 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-sm font-semibold uppercase">Đồng bộ tồn kho POS / MISA</h2><p className="mt-1 text-xs text-neutral-500">Cấu hình endpoint và token ở trang Đơn hàng, sau đó lấy hoặc gửi tồn kho tại đây.</p></div>
          <Link href="/admin/orders" className="border border-neutral-300 px-3 py-2 text-xs uppercase">Cấu hình kết nối</Link>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {(["pos", "misa"] as const).flatMap((target) => (["pull", "push"] as const).map((direction) => {
            const busyKey = `${target}-${direction}`;
            return <button key={busyKey} type="button" onClick={() => syncInventory(target, direction)} disabled={Boolean(inventoryBusy)} className="h-10 border border-black px-4 text-xs uppercase disabled:opacity-40">{inventoryBusy === busyKey ? "Đang đồng bộ..." : `${direction === "pull" ? "Lấy tồn" : "Gửi tồn"} ${target.toUpperCase()}`}</button>;
          }))}
        </div>
      </section>

      <section className="mt-6 grid min-w-0 gap-6 lg:grid-cols-[minmax(280px,360px)_minmax(0,1fr)]">
        <aside className="min-w-0 space-y-5">
          <div className="border border-neutral-200 p-4">
            <h2 className="text-sm font-semibold uppercase">Thương hiệu</h2>
            <label className="mt-3 block text-xs uppercase text-neutral-500">Tên brand</label>
            <input value={content.brand.name} onChange={(event) => updateContent({ ...content, brand: { ...content.brand, name: event.target.value } })} className="mt-1 h-10 w-full border px-3" />
            <label className="mt-3 block text-xs uppercase text-neutral-500">Logo URL</label>
            <input value={content.brand.logoUrl} onChange={(event) => updateContent({ ...content, brand: { ...content.brand, logoUrl: event.target.value } })} className="mt-1 h-10 w-full border px-3" />
            <input type="file" accept="image/*" onChange={(event) => uploadImage(event, (url) => updateContent({ ...content, brand: { ...content.brand, logoUrl: url } }))} className="mt-2 text-xs" />
            <label className="mt-3 block text-xs uppercase text-neutral-500">Footer text</label>
            <input value={content.brand.footerText} onChange={(event) => updateContent({ ...content, brand: { ...content.brand, footerText: event.target.value } })} className="mt-1 h-10 w-full border px-3" />
          </div>

          <div className="border border-neutral-200 p-4">
            <h2 className="text-sm font-semibold uppercase">Hero đầu trang</h2>
            <label className="mt-3 block text-xs uppercase text-neutral-500">Overline</label>
            <input value={content.hero.overline} onChange={(event) => updateContent({ ...content, hero: { ...content.hero, overline: event.target.value } })} className="mt-1 h-10 w-full border px-3" />
            <label className="mt-3 block text-xs uppercase text-neutral-500">Headline HTML</label>
            <textarea value={content.hero.titleHtml} onChange={(event) => updateContent({ ...content, hero: { ...content.hero, titleHtml: event.target.value } })} className="mt-1 min-h-20 w-full border p-3" />
            <label className="mt-3 block text-xs uppercase text-neutral-500">Mô tả</label>
            <textarea value={content.hero.description} onChange={(event) => updateContent({ ...content, hero: { ...content.hero, description: event.target.value } })} className="mt-1 min-h-24 w-full border p-3" />
            <label className="mt-3 block text-xs uppercase text-neutral-500">Ảnh theme hero URL</label>
            <input value={content.hero.themeImageUrl || ""} onChange={(event) => updateContent({ ...content, hero: { ...content.hero, themeImageUrl: event.target.value } })} placeholder="Để trống để dùng hình theme mặc định" className="mt-1 h-10 w-full border px-3" />
            <input type="file" accept="image/*" onChange={(event) => uploadImage(event, (url) => updateContent({ ...content, hero: { ...content.hero, themeImageUrl: url } }))} className="mt-2 text-xs" />
            {content.hero.themeImageUrl && <img src={content.hero.themeImageUrl} alt="Theme hero" className="mt-3 aspect-[4/3] max-h-52 w-full object-cover" />}
          </div>

          <div className="border border-neutral-200 p-4">
            <h2 className="text-sm font-semibold uppercase">Menu / CTA</h2>
            <Text label="Tab Menu" value={content.menu.menuTabLabel} onChange={(value) => updateContent({ ...content, menu: { ...content.menu, menuTabLabel: value } })} />
            <Text label="Tab liên hệ / đơn sỉ" value={content.menu.supportTabLabel} onChange={(value) => updateContent({ ...content, menu: { ...content.menu, supportTabLabel: value } })} />
            <Text label="Mục Nam" value={content.menu.menLabel} onChange={(value) => updateContent({ ...content, menu: { ...content.menu, menLabel: value } })} />
            <Text label="Mục Nữ" value={content.menu.womenLabel} onChange={(value) => updateContent({ ...content, menu: { ...content.menu, womenLabel: value } })} />
            <Text label="Nhãn Best seller" value={content.menu.bestSellerLabel} onChange={(value) => updateContent({ ...content, menu: { ...content.menu, bestSellerLabel: value } })} />
            <Text label="Nhãn New item" value={content.menu.newItemLabel} onChange={(value) => updateContent({ ...content, menu: { ...content.menu, newItemLabel: value } })} />
            <Text label="Nhãn Sale" value={content.menu.saleLabel} onChange={(value) => updateContent({ ...content, menu: { ...content.menu, saleLabel: value } })} />
            <Text label="Nút Liên hệ / Đơn sỉ ở hero" value={content.menu.contactShortcutLabel} onChange={(value) => updateContent({ ...content, menu: { ...content.menu, contactShortcutLabel: value } })} />
            <Text label="Nút Nam / Nữ ở hero" value={content.menu.genderShortcutLabel} onChange={(value) => updateContent({ ...content, menu: { ...content.menu, genderShortcutLabel: value } })} />
          </div>

          <div className="border border-neutral-200 p-4">
            <h2 className="text-sm font-semibold uppercase">Thông tin liên hệ / đơn sỉ</h2>
            <Text label="Nhãn số điện thoại" value={content.support.phoneLabel} onChange={(value) => updateContent({ ...content, support: { ...content.support, phoneLabel: value } })} />
            <Text label="Số điện thoại hiển thị" value={content.support.phoneText} onChange={(value) => updateContent({ ...content, support: { ...content.support, phoneText: value } })} />
            <Text label="Link số điện thoại" value={content.support.phoneHref} onChange={(value) => updateContent({ ...content, support: { ...content.support, phoneHref: value } })} />
            <Text label="Nhãn Zalo" value={content.support.zaloLabel} onChange={(value) => updateContent({ ...content, support: { ...content.support, zaloLabel: value } })} />
            <Text label="Zalo hiển thị" value={content.support.zaloText} onChange={(value) => updateContent({ ...content, support: { ...content.support, zaloText: value } })} />
            <Text label="Link Zalo" value={content.support.zaloHref} onChange={(value) => updateContent({ ...content, support: { ...content.support, zaloHref: value } })} />
            <Text label="Nhãn TikTok" value={content.support.tiktokLabel} onChange={(value) => updateContent({ ...content, support: { ...content.support, tiktokLabel: value } })} />
            <Text label="TikTok hiển thị" value={content.support.tiktokText} onChange={(value) => updateContent({ ...content, support: { ...content.support, tiktokText: value } })} />
            <Text label="Link TikTok" value={content.support.tiktokHref} onChange={(value) => updateContent({ ...content, support: { ...content.support, tiktokHref: value } })} />
            <Text label="Nhãn Facebook" value={content.support.facebookLabel} onChange={(value) => updateContent({ ...content, support: { ...content.support, facebookLabel: value } })} />
            <Text label="Facebook hiển thị" value={content.support.facebookText} onChange={(value) => updateContent({ ...content, support: { ...content.support, facebookText: value } })} />
            <Text label="Link Facebook" value={content.support.facebookHref} onChange={(value) => updateContent({ ...content, support: { ...content.support, facebookHref: value } })} />
            <Text label="Nhãn giờ làm việc" value={content.support.hoursLabel} onChange={(value) => updateContent({ ...content, support: { ...content.support, hoursLabel: value } })} />
            <Text label="Giờ làm việc" value={content.support.hoursText} onChange={(value) => updateContent({ ...content, support: { ...content.support, hoursText: value } })} />
            <Text label="Tiêu đề mục đơn sỉ" value={content.support.wholesaleTitle} onChange={(value) => updateContent({ ...content, support: { ...content.support, wholesaleTitle: value } })} />
            <Text label="Nhãn SĐT đơn sỉ" value={content.support.wholesalePhoneLabel} onChange={(value) => updateContent({ ...content, support: { ...content.support, wholesalePhoneLabel: value } })} />
            <Text label="SĐT đơn sỉ hiển thị" value={content.support.wholesalePhoneText} onChange={(value) => updateContent({ ...content, support: { ...content.support, wholesalePhoneText: value } })} />
            <Text label="Link SĐT đơn sỉ" value={content.support.wholesalePhoneHref} onChange={(value) => updateContent({ ...content, support: { ...content.support, wholesalePhoneHref: value } })} />
            <Text label="Nhãn Zalo đơn sỉ" value={content.support.wholesaleZaloLabel} onChange={(value) => updateContent({ ...content, support: { ...content.support, wholesaleZaloLabel: value } })} />
            <Text label="Zalo đơn sỉ hiển thị" value={content.support.wholesaleZaloText} onChange={(value) => updateContent({ ...content, support: { ...content.support, wholesaleZaloText: value } })} />
            <Text label="Link Zalo đơn sỉ" value={content.support.wholesaleZaloHref} onChange={(value) => updateContent({ ...content, support: { ...content.support, wholesaleZaloHref: value } })} />
          </div>

          <div className="border border-neutral-200 p-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold uppercase">Footer website</h2>
              <button type="button" onClick={addFooterColumn} className="h-8 border border-black px-3 text-[10px] uppercase">Thêm cột</button>
            </div>
            <div className="mt-4 grid gap-4">
              {content.footerColumns.map((column, columnIndex) => (
                <div key={columnIndex} className="border border-neutral-200 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <strong className="text-sm">Cột {columnIndex + 1}</strong>
                    <button type="button" onClick={() => deleteFooterColumn(columnIndex)} className="border border-red-500 px-2 py-1 text-[10px] uppercase text-red-600">Xóa cột</button>
                  </div>
                  <Text
                    label="Tiêu đề cột"
                    value={column.title}
                    onChange={(value) => updateFooterColumn(columnIndex, { ...column, title: value })}
                  />
                  <div className="mt-3 grid gap-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs uppercase text-neutral-500">Các dòng nội dung</span>
                      <button
                        type="button"
                        onClick={() => updateFooterColumn(columnIndex, { ...column, lines: [...column.lines, "Dòng mới"] })}
                        className="border border-black px-2 py-1 text-[10px] uppercase"
                      >
                        Thêm dòng
                      </button>
                    </div>
                    {column.lines.map((line, lineIndex) => (
                      <div key={lineIndex} className="flex gap-2">
                        <input
                          value={line}
                          onChange={(event) => updateFooterColumn(columnIndex, {
                            ...column,
                            lines: column.lines.map((item, itemIndex) => itemIndex === lineIndex ? event.target.value : item)
                          })}
                          className="h-10 min-w-0 flex-1 border px-3 text-sm"
                        />
                        <button
                          type="button"
                          onClick={() => updateFooterColumn(columnIndex, {
                            ...column,
                            lines: column.lines.filter((_, itemIndex) => itemIndex !== lineIndex)
                          })}
                          className="h-10 border border-red-500 px-2 text-[10px] uppercase text-red-600"
                        >
                          Xóa
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="border border-neutral-200 p-4">
            <h2 className="text-sm font-semibold uppercase">Tài khoản nhận chuyển khoản</h2>
            <p className="mt-2 text-xs leading-5 text-neutral-500">Thông tin này hiện cho khách ở trang thanh toán chuyển khoản.</p>
            <Text label="Tên người nhận" value={content.payment.bank.receiverName} onChange={(value) => updateContent({ ...content, payment: { ...content.payment, bank: { ...content.payment.bank, receiverName: value } } })} />
            <Text label="Số tài khoản" value={content.payment.bank.accountNumber} onChange={(value) => updateContent({ ...content, payment: { ...content.payment, bank: { ...content.payment.bank, accountNumber: value } } })} />
            <Text label="Tên ngân hàng" value={content.payment.bank.bankName} onChange={(value) => updateContent({ ...content, payment: { ...content.payment, bank: { ...content.payment.bank, bankName: value } } })} />
            <Text label="Mã ngân hàng mở app" value={content.payment.bank.bankCode} onChange={(value) => updateContent({ ...content, payment: { ...content.payment, bank: { ...content.payment.bank, bankCode: value } } })} />
          </div>
        </aside>

        <section className="grid min-w-0 gap-5">
          <div className="flex flex-wrap items-center justify-between gap-3 border border-neutral-200 p-4">
            <div>
              <h2 className="text-xl font-medium">Sản phẩm</h2>
              <p className="text-sm text-neutral-500">Thêm/sửa tên, giá, ảnh, màu, size, sale, trạng thái hiển thị và thứ tự ngoài trang khách.</p>
            </div>
            <button onClick={addProduct} className="h-10 border border-black px-4 text-xs uppercase">Thêm sản phẩm</button>
          </div>

          <details className="border border-neutral-200 p-4">
            <summary className="cursor-pointer text-sm font-semibold uppercase">Chọn nhanh menu sản phẩm</summary>
            <div className="mt-4 overflow-auto">
              <table className="w-full min-w-[720px] border-collapse text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase text-neutral-500">
                    <th className="py-2 pr-3">Sản phẩm</th>
                    <th className="px-3">Thứ tự</th>
                    <th className="px-3">Nam</th>
                    <th className="px-3">Nữ</th>
                    <th className="px-3">Best seller</th>
                    <th className="px-3">New item</th>
                    <th className="px-3">Sale</th>
                  </tr>
                </thead>
                <tbody>
                  {content.products.map((product, index) => {
                    const genders = product.genders || ["men", "women"];
                    return (
                      <tr key={product.id} className="border-b border-neutral-100">
                        <td className="py-2 pr-3 font-medium">{product.name}</td>
                        <td className="px-3">
                          <div className="flex gap-1">
                            <button type="button" onClick={() => moveProduct(product.id, "up")} disabled={index === 0} className="h-8 border border-neutral-300 px-2 text-[10px] uppercase disabled:opacity-30">Lên</button>
                            <button type="button" onClick={() => moveProduct(product.id, "down")} disabled={index === content.products.length - 1} className="h-8 border border-neutral-300 px-2 text-[10px] uppercase disabled:opacity-30">Xuống</button>
                          </div>
                        </td>
                        <td className="px-3"><input type="checkbox" checked={genders.includes("men")} onChange={(event) => toggleProductGender(product, "men", event.target.checked)} /></td>
                        <td className="px-3"><input type="checkbox" checked={genders.includes("women")} onChange={(event) => toggleProductGender(product, "women", event.target.checked)} /></td>
                        <td className="px-3"><input type="checkbox" checked={Boolean(product.isBestSeller)} onChange={(event) => updateProduct({ ...product, isBestSeller: event.target.checked })} /></td>
                        <td className="px-3"><input type="checkbox" checked={product.isNew} onChange={(event) => updateProduct({ ...product, isNew: event.target.checked })} /></td>
                        <td className="px-3"><input type="checkbox" checked={product.isSale} onChange={(event) => updateProduct({ ...product, isSale: event.target.checked })} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </details>

          <div className="grid min-w-0 gap-5">
            <div className="min-w-0 border border-neutral-200 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold uppercase">Thứ tự sản phẩm trên trang khách</h3>
                <span className="text-xs text-neutral-500">Sản phẩm ở trên sẽ hiện trước.</span>
              </div>
              <div className="mt-3 grid max-h-[420px] gap-2 overflow-auto lg:grid-cols-2">
                {content.products.map((product, index) => (
                  <div key={product.id} className={`grid gap-3 border p-3 text-sm transition sm:grid-cols-[1fr_auto] ${selectedId === product.id ? "border-black bg-neutral-50" : "border-neutral-200 bg-white"}`}>
                    <button type="button" onClick={() => selectProduct(product.id)} className="min-w-0 text-left">
                      <span className="flex items-start gap-2">
                        <span className="mt-0.5 inline-grid h-6 w-7 shrink-0 place-items-center bg-black text-[10px] font-bold text-white">{index + 1}</span>
                        <span className="min-w-0">
                          <strong className="block truncate">{product.name}</strong>
                          <span className="mt-1 block text-xs text-neutral-500">{product.salePrice || product.originalPrice || product.price} · tồn {buildProductInventory(product).reduce((sum, item) => sum + item.quantity, 0)} · {product.active ? "đang bán" : "ẩn"}</span>
                        </span>
                      </span>
                    </button>
                    <div className="flex items-center gap-1 sm:justify-end">
                      <button type="button" onClick={() => moveProduct(product.id, "up")} disabled={index === 0} className="h-8 border border-neutral-300 px-2 text-[10px] uppercase disabled:opacity-30">Lên</button>
                      <button type="button" onClick={() => moveProduct(product.id, "down")} disabled={index === content.products.length - 1} className="h-8 border border-neutral-300 px-2 text-[10px] uppercase disabled:opacity-30">Xuống</button>
                      <button type="button" onClick={() => selectProduct(product.id)} className="h-8 border border-black px-2 text-[10px] uppercase">Sửa</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {selectedProduct && (
              <div ref={editorRef} id="product-editor" className="min-w-0">
                <ProductForm
                  product={selectedProduct}
                  onChange={updateProduct}
                  onDelete={() => deleteProduct(selectedProduct.id)}
                  onUpload={(event, onUrl) => uploadImage(event, onUrl)}
                  onUploadMany={(event, onUrls) => uploadImages(event, onUrls)}
                />
              </div>
            )}
          </div>

          <details className="border border-neutral-200 p-4">
            <summary className="cursor-pointer text-sm font-semibold uppercase">Chỉnh nâng cao bằng JSON</summary>
            <textarea value={jsonDraft} onChange={(event) => setJsonDraft(event.target.value)} className="mt-4 min-h-[360px] w-full border p-3 font-mono text-xs" />
            <div className="mt-3 flex gap-2">
              <button onClick={applyJson} className="h-10 border border-black px-4 text-xs uppercase">Áp dụng JSON</button>
              <button onClick={() => setJsonDraft(JSON.stringify(content, null, 2))} className="h-10 border border-neutral-300 px-4 text-xs uppercase">Hoàn tác draft</button>
            </div>
          </details>
        </section>
      </section>
    </main>
  );
}

function ProductForm({
  product,
  onChange,
  onDelete,
  onUpload,
  onUploadMany
}: {
  product: CmsProduct;
  onChange: (product: CmsProduct) => void;
  onDelete: () => void;
  onUpload: (event: ChangeEvent<HTMLInputElement>, onUrl: (url: string) => void) => void;
  onUploadMany: (event: ChangeEvent<HTMLInputElement>, onUrls: (urls: string[]) => void) => void;
}) {
  const set = <K extends keyof CmsProduct>(key: K, value: CmsProduct[K]) => onChange({ ...product, [key]: value });
  const originalPrice = product.originalPrice || product.price || "";
  const salePrice = product.salePrice || "";
  const colorNames = product.colorNames || {};
  const colorImages = product.colorImages || {};
  const galleryImages = product.galleryImages || [];
  const genders = product.genders || ["men", "women"];
  const [newColorName, setNewColorName] = useState("");
  const [newClassificationName, setNewClassificationName] = useState("");
  const [newSize, setNewSize] = useState("");
  const inventoryRows = buildProductInventory(product);
  const totalInventory = inventoryRows.reduce((sum, item) => sum + item.quantity, 0);
  const updateInventoryItem = (key: string, patch: Partial<CmsProductInventoryItem>) => {
    const nextInventory = inventoryRows.map((item) => item.key === key ? { ...item, ...patch } : item);
    onChange({ ...product, inventory: nextInventory, inventoryManaged: true });
  };
  const inventoryClassificationName = (item: CmsProductInventoryItem) =>
    product.classifications?.find((classification) => classification.id === item.classificationId)?.name || product.name;
  const inventoryColorName = (item: CmsProductInventoryItem) => {
    if (!item.color) return "Mặc định";
    const classification = product.classifications?.find((entry) => entry.id === item.classificationId);
    return classification?.colorNames?.[item.color] || colorNames[item.color] || item.color;
  };
  const setColorImage = (color: string, url: string) => {
    const nextColorImages = { ...colorImages, [color]: url };
    const nextSwatches = url
      ? [...product.swatches.filter((item) => item !== color), color]
      : product.swatches;
    const knownVariantImages = new Set(Object.values(colorImages).filter(Boolean));
    const nextVariantImages = nextSwatches.map((item) => nextColorImages[item]).filter(Boolean);
    const nextVariantImageSet = new Set(nextVariantImages);
    const nonVariantImages = galleryImages.filter((item) => item && !knownVariantImages.has(item));
    const firstNonVariantImage = [product.image, ...nonVariantImages]
      .find((item) => item && !knownVariantImages.has(item) && !nextVariantImageSet.has(item));
    const primaryImage = firstNonVariantImage
      || (product.image && nextVariantImageSet.has(product.image) ? product.image : "")
      || nextVariantImages[0]
      || "";
    const nextGalleryImages = [
      primaryImage,
      ...nonVariantImages,
      ...nextVariantImages
    ].filter((item, index, items) => item && items.indexOf(item) === index);
    onChange({
      ...product,
      image: primaryImage,
      galleryImages: nextGalleryImages,
      swatches: nextSwatches,
      colorImages: nextColorImages
    });
  };
  const addGalleryImages = (urls: string[]) => {
    if (!urls.length) return;
    const variantImages = new Set(Object.values(colorImages).filter(Boolean));
    const firstNonVariantImage = [product.image, ...galleryImages, ...urls]
      .find((item) => item && !variantImages.has(item));
    const primaryImage = firstNonVariantImage || product.image || urls[0];
    const nextGalleryImages = [primaryImage, ...galleryImages, ...urls]
      .filter((item, index, items) => item && items.indexOf(item) === index);
    onChange({
      ...product,
      image: primaryImage,
      galleryImages: nextGalleryImages
    });
  };
  const updateGalleryImage = (index: number, url: string) => {
    const nextImages = galleryImages.map((item, itemIndex) => itemIndex === index ? url : item);
    onChange({ ...product, image: index === 0 ? url : product.image, galleryImages: nextImages });
  };
  const removeGalleryImage = (index: number) => {
    const nextImages = galleryImages.filter((_, itemIndex) => itemIndex !== index);
    onChange({ ...product, image: nextImages[0] || "", galleryImages: nextImages });
  };
  const setColorName = (color: string, name: string) => {
    onChange({ ...product, colorNames: { ...colorNames, [color]: name } });
  };
  const toggleGender = (gender: string, checked: boolean) => {
    const next = checked ? Array.from(new Set([...genders, gender])) : genders.filter((item) => item !== gender);
    onChange({ ...product, genders: next.length ? next : ["men", "women"] });
  };
  const updateProductColors = (swatches: string[]) => {
    const nextColorNames = swatches.reduce<Record<string, string>>((names, color) => {
      if (colorNames[color]) names[color] = colorNames[color];
      return names;
    }, {});
    const nextColorImages = swatches.reduce<Record<string, string>>((images, color) => {
      if (colorImages[color]) images[color] = colorImages[color];
      return images;
    }, {});
    onChange({ ...product, swatches, colorNames: nextColorNames, colorImages: nextColorImages });
  };
  const addColor = () => {
    const color = `variant-${Date.now()}`;
    onChange({
      ...product,
      swatches: [...product.swatches, color],
      colorNames: { ...colorNames, [color]: newColorName.trim() || "Màu mới" },
      colorImages
    });
    setNewColorName("");
  };
  const removeColor = (color: string) => {
    updateProductColors(product.swatches.filter((item) => item !== color));
  };
  const addSize = () => {
    const size = newSize.trim().toUpperCase();
    if (!size || product.sizes.includes(size)) return;
    set("sizes", [...product.sizes, size]);
    setNewSize("");
  };
  const removeSize = (size: string) => {
    const nextSizes = product.sizes.filter((item) => item !== size);
    set("sizes", nextSizes.length ? nextSizes : product.sizes);
  };
  const addClassification = () => {
    const name = newClassificationName.trim();
    if (!name) return;
    const classification: CmsProductClassification = {
      id: `classification-${Date.now()}`,
      name,
      swatches: [],
      colorNames: {},
      colorImages: {}
    };
    set("classifications", [...(product.classifications || []), classification]);
    setNewClassificationName("");
  };
  const updateClassification = (classification: CmsProductClassification) => {
    set("classifications", (product.classifications || []).map((item) => item.id === classification.id ? classification : item));
  };
  const removeClassification = (id: string) => {
    set("classifications", (product.classifications || []).filter((item) => item.id !== id));
  };
  const setOriginalPrice = (value: string) => {
    const originalAmount = parseMoneyValue(value);
    const saleAmount = parseMoneyValue(salePrice);
    const hasDiscount = saleAmount > 0 && originalAmount > 0 && saleAmount < originalAmount;
    onChange({
      ...product,
      originalPrice: value,
      price: hasDiscount ? salePrice : value,
      isSale: hasDiscount,
      salePercent: hasDiscount ? Math.max(1, Math.round((originalAmount - saleAmount) / originalAmount * 100)) : 0
    });
  };
  const setSalePrice = (value: string) => {
    const trimmed = value.trim();
    const originalAmount = parseMoneyValue(originalPrice);
    const saleAmount = parseMoneyValue(trimmed);
    const hasDiscount = Boolean(trimmed) && originalAmount > 0 && saleAmount > 0 && saleAmount < originalAmount;
    onChange({
      ...product,
      salePrice: value,
      price: hasDiscount ? trimmed : originalPrice,
      isSale: hasDiscount,
      salePercent: hasDiscount ? Math.max(1, Math.round((originalAmount - saleAmount) / originalAmount * 100)) : 0
    });
  };

  return (
    <div className="min-w-0 overflow-hidden border border-neutral-200 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase text-neutral-500">Đang sửa sản phẩm</p>
          <h3 className="mt-1 text-2xl font-medium">{product.name}</h3>
        </div>
        <button onClick={onDelete} className="h-9 border border-red-500 px-3 text-xs uppercase text-red-600">Xóa</button>
      </div>

      <div className="mt-4 grid min-w-0 gap-4 md:grid-cols-2">
        <Text label="Tên sản phẩm" value={product.name} onChange={(value) => set("name", value)} />
        <Text label="Giá gốc" value={originalPrice} onChange={setOriginalPrice} />
        <Text label="Giá sau giảm" value={salePrice} onChange={setSalePrice} />
        <Text label="Mô tả form/chất liệu" value={product.fit} onChange={(value) => set("fit", value)} />
        <label className="text-sm">
          Loại sản phẩm
          <select value={product.kind} onChange={(event) => set("kind", event.target.value)} className="mt-1 h-10 w-full border px-3">
            <option value="tee">Tee/Shirt</option>
            <option value="hoodie">Hoodie</option>
            <option value="pants">Pants/Shorts</option>
            <option value="jacket">Jacket</option>
            <option value="gift-box">Gift box</option>
            <option value="gift-card">Gift card</option>
            <option value="gift-bag">Gift bag</option>
          </select>
        </label>
        <NumberField label="Đã bán" value={product.sold} onChange={(value) => set("sold", value)} />
        <NumberField label="% sale" value={product.salePercent} onChange={(value) => set("salePercent", value)} />
      </div>

      <div className="mt-5 border-t pt-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h4 className="text-sm font-semibold uppercase">Ảnh chi tiết sản phẩm</h4>
            <p className="mt-1 text-xs text-neutral-500">Thêm nhiều ảnh tổng thể/chi tiết. Khách bấm mũi tên trên ảnh sản phẩm để xem lần lượt. Ảnh màu ở phần dưới chỉ hiện khi khách bấm màu.</p>
          </div>
          <label className="text-xs uppercase text-neutral-500">
            Upload thêm ảnh
            <input type="file" accept="image/*" multiple onChange={(event) => onUploadMany(event, addGalleryImages)} className="mt-2 block text-xs normal-case" />
          </label>
        </div>
        <label className="mt-3 block text-xs uppercase text-neutral-500">URL ảnh chính cũ</label>
        <input value={product.image} onChange={(event) => set("image", event.target.value)} placeholder="Dùng khi chưa có gallery hoặc ảnh đầu tiên" className="mt-1 h-10 w-full border px-3 text-sm" />
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {galleryImages.map((url, index) => (
            <div key={`${url}-${index}`} className="border border-neutral-200 p-3">
              <div className="flex items-center justify-between gap-2">
                <strong className="text-sm">Ảnh {index + 1}</strong>
                <button type="button" onClick={() => removeGalleryImage(index)} className="border border-red-500 px-2 py-1 text-[10px] uppercase text-red-600">Xóa ảnh</button>
              </div>
              <input value={url} onChange={(event) => updateGalleryImage(index, event.target.value)} className="mt-2 h-10 w-full border px-3 text-sm" />
              {url && <img src={url} alt={`${product.name} ảnh ${index + 1}`} className="mt-3 aspect-[4/3] max-h-56 w-full object-cover" />}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-4 border-t pt-4 text-sm">
        <label><input type="checkbox" checked={product.active} onChange={(event) => set("active", event.target.checked)} className="mr-2" />Đang bán/hiển thị</label>
        <label><input type="checkbox" checked={genders.includes("men")} onChange={(event) => toggleGender("men", event.target.checked)} className="mr-2" />Hiện trong Nam</label>
        <label><input type="checkbox" checked={genders.includes("women")} onChange={(event) => toggleGender("women", event.target.checked)} className="mr-2" />Hiện trong Nữ</label>
        <label><input type="checkbox" checked={Boolean(product.isBestSeller)} onChange={(event) => set("isBestSeller", event.target.checked)} className="mr-2" />Best seller</label>
        <label><input type="checkbox" checked={product.isNew} onChange={(event) => set("isNew", event.target.checked)} className="mr-2" />New</label>
        <label><input type="checkbox" checked={product.isSale} onChange={(event) => set("isSale", event.target.checked)} className="mr-2" />Sale</label>
      </div>

      <div className="mt-5 border-t pt-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h4 className="text-sm font-semibold uppercase">Phân loại size</h4>
            <p className="mt-1 text-xs text-neutral-500">Nhập từng size rồi bấm thêm. Không cần dùng dấu phẩy.</p>
          </div>
          <div className="flex items-end gap-2">
            <label className="text-xs uppercase text-neutral-500">
              Thêm size
              <input
                value={newSize}
                onChange={(event) => setNewSize(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addSize();
                  }
                }}
                placeholder="S, M, L, XL..."
                className="mt-1 h-10 w-36 border px-3 text-sm normal-case"
              />
            </label>
            <button type="button" onClick={addSize} className="h-10 border border-black px-4 text-xs uppercase">Thêm size</button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {product.sizes.map((size) => (
            <span key={size} className="inline-flex h-10 items-center gap-2 border border-neutral-300 px-3 text-sm">
              <strong>{size}</strong>
              <button type="button" onClick={() => removeSize(size)} className="text-[10px] uppercase text-red-600">Xóa</button>
            </span>
          ))}
        </div>
      </div>

      <div className="mt-5 border-2 border-black bg-neutral-50 p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h4 className="text-base font-bold uppercase">Số lượng hàng hóa / tồn kho</h4>
            <p className="mt-1 text-xs text-neutral-600">Nhập số lượng riêng cho từng phân loại, màu và size. Khi số lượng = 0, khách sẽ thấy hết hàng và không mua được phân loại đó.</p>
          </div>
          <div className="bg-black px-4 py-3 text-white"><span className="text-xs uppercase">Tổng tồn</span><strong className="ml-3 text-xl">{totalInventory}</strong></div>
        </div>
        <div className="mt-4 grid gap-3">
          <div className="hidden rounded-none border border-neutral-300 bg-white px-4 py-3 text-xs font-semibold uppercase text-neutral-500 xl:grid xl:grid-cols-[minmax(180px,1.4fr)_minmax(140px,1fr)_80px_minmax(180px,1.1fr)_150px] xl:gap-3">
            <span>Phân loại</span>
            <span>Màu</span>
            <span>Size</span>
            <span>Mã SKU</span>
            <span>Số lượng</span>
          </div>
          {inventoryRows.map((item) => (
            <div key={item.key} className="grid gap-3 border border-neutral-300 bg-white p-4 text-sm xl:grid-cols-[minmax(180px,1.4fr)_minmax(140px,1fr)_80px_minmax(180px,1.1fr)_150px] xl:items-center">
              <div>
                <span className="mb-1 block text-[10px] uppercase text-neutral-500 xl:hidden">Phân loại</span>
                <strong>{inventoryClassificationName(item)}</strong>
              </div>
              <div>
                <span className="mb-1 block text-[10px] uppercase text-neutral-500 xl:hidden">Màu</span>
                {inventoryColorName(item)}
              </div>
              <div>
                <span className="mb-1 block text-[10px] uppercase text-neutral-500 xl:hidden">Size</span>
                <strong className="text-base">{item.size}</strong>
              </div>
              <label>
                <span className="mb-1 block text-[10px] uppercase text-neutral-500 xl:hidden">Mã SKU</span>
                <input value={item.sku} onChange={(event) => updateInventoryItem(item.key, { sku: event.target.value.trim().toUpperCase() })} className="h-11 w-full border px-3 font-mono text-xs" />
              </label>
              <label>
                <span className="mb-1 block text-[10px] uppercase text-neutral-500 xl:hidden">Số lượng</span>
                <input aria-label={`Số lượng ${inventoryClassificationName(item)} ${inventoryColorName(item)} size ${item.size}`} type="number" min="0" step="1" value={item.quantity} onChange={(event) => updateInventoryItem(item.key, { quantity: Math.max(0, Math.floor(Number(event.target.value) || 0)) })} className="h-11 w-full border-2 border-black px-3 text-right text-lg font-bold" />
              </label>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-5 border-t pt-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h4 className="text-sm font-semibold uppercase">Phân loại form / dáng</h4>
            <p className="mt-1 text-xs text-neutral-500">Không bắt buộc. Mỗi phân loại có danh sách màu và ảnh riêng như một sản phẩm con.</p>
          </div>
          <div className="flex items-end gap-2">
            <label className="text-xs uppercase text-neutral-500">
              Tên phân loại
              <input
                value={newClassificationName}
                onChange={(event) => setNewClassificationName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addClassification();
                  }
                }}
                placeholder="Form rộng, form ôm..."
                className="mt-1 h-10 w-48 border px-3 text-sm normal-case"
              />
            </label>
            <button type="button" onClick={addClassification} className="h-10 border border-black px-4 text-xs uppercase">Thêm phân loại</button>
          </div>
        </div>
        {(product.classifications || []).length === 0 && (
          <p className="mt-3 border border-dashed border-neutral-300 p-4 text-sm text-neutral-500">Sản phẩm này chưa chia phân loại form/dáng.</p>
        )}
        <div className="mt-3 grid gap-4">
          {(product.classifications || []).map((classification, index) => (
            <ClassificationEditor
              key={classification.id}
              classification={classification}
              index={index}
              productName={product.name}
              onChange={updateClassification}
              onDelete={() => removeClassification(classification.id)}
              onUpload={onUpload}
            />
          ))}
        </div>
      </div>

      {(product.classifications || []).length === 0 && <div className="mt-5 border-t pt-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h4 className="text-sm font-semibold uppercase">Màu và ảnh theo từng màu</h4>
            <p className="mt-1 text-xs text-neutral-500">Nhập tên phân loại rồi upload ảnh. Ảnh vừa upload sẽ tự động trở thành ảnh chính của sản phẩm.</p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs uppercase text-neutral-500">
              Tên màu
              <input
                value={newColorName}
                onChange={(event) => setNewColorName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addColor();
                  }
                }}
                placeholder="Đen, kem, nâu..."
                className="mt-1 h-10 w-36 border px-3 text-sm normal-case"
              />
            </label>
            <button type="button" onClick={addColor} className="h-10 border border-black px-4 text-xs uppercase">Thêm màu</button>
          </div>
        </div>
        <div className="mt-3 grid gap-3">
          {product.swatches.map((color) => (
            <div key={color} className="grid gap-3 border border-neutral-200 p-3 md:grid-cols-[120px_1fr]">
              <div className="flex flex-wrap items-center gap-2 text-sm md:block">
                {colorImages[color] && <img src={colorImages[color]} alt={colorNames[color] || product.name} className="h-20 w-20 border border-neutral-200 object-cover" />}
                <strong className="align-middle md:mt-2 md:block">{colorNames[color] || "Phân loại ảnh"}</strong>
                <button type="button" onClick={() => removeColor(color)} className="border border-red-500 px-2 py-1 text-[10px] uppercase text-red-600 md:mt-3">Xóa màu</button>
              </div>
              <div>
                <label className="mb-2 block text-xs uppercase text-neutral-500">Tên màu hiển thị cho khách</label>
                <input value={colorNames[color] || ""} onChange={(event) => setColorName(color, event.target.value)} placeholder="Ví dụ: Đen, Kem, Nâu cafe..." className="mb-3 h-10 w-full border px-3 text-sm" />
                <label className="mb-2 block text-xs uppercase text-neutral-500">Ảnh chính cho phân loại này</label>
                <input value={colorImages[color] || ""} onChange={(event) => setColorImage(color, event.target.value)} placeholder="URL ảnh" className="h-10 w-full border px-3 text-sm" />
                <input type="file" accept="image/*" onChange={(event) => onUpload(event, (url) => setColorImage(color, url))} className="mt-2 block text-xs" />
                {colorImages[color] && <img src={colorImages[color]} alt={`${product.name} ${color}`} className="mt-3 aspect-[4/3] max-h-56 w-full object-cover" />}
              </div>
            </div>
          ))}
        </div>
      </div>}

      {product.image && <img src={product.image} alt={product.name} className="mt-4 aspect-[4/3] max-h-72 w-full object-cover" />}
    </div>
  );
}

function parseMoneyValue(value: string) {
  return Number(String(value || "").replace(/[^0-9]/g, "")) || 0;
}

function ClassificationEditor({
  classification,
  index,
  productName,
  onChange,
  onDelete,
  onUpload
}: {
  classification: CmsProductClassification;
  index: number;
  productName: string;
  onChange: (classification: CmsProductClassification) => void;
  onDelete: () => void;
  onUpload: (event: ChangeEvent<HTMLInputElement>, onUrl: (url: string) => void) => void;
}) {
  const [newColorName, setNewColorName] = useState("");
  const colorNames = classification.colorNames || {};
  const colorImages = classification.colorImages || {};

  function addColor() {
    const color = `variant-${Date.now()}`;
    onChange({
      ...classification,
      swatches: [...classification.swatches, color],
      colorNames: { ...colorNames, [color]: newColorName.trim() || "Màu mới" },
      colorImages
    });
    setNewColorName("");
  }

  function updateColorName(color: string, name: string) {
    onChange({ ...classification, colorNames: { ...colorNames, [color]: name } });
  }

  function updateColorImage(color: string, url: string) {
    const nextSwatches = url
      ? [...classification.swatches.filter((item) => item !== color), color]
      : classification.swatches;
    onChange({
      ...classification,
      swatches: nextSwatches,
      colorImages: { ...colorImages, [color]: url }
    });
  }

  function removeColor(color: string) {
    const swatches = classification.swatches.filter((item) => item !== color);
    const nextColorNames = Object.fromEntries(Object.entries(colorNames).filter(([key]) => key !== color));
    const nextColorImages = Object.fromEntries(Object.entries(colorImages).filter(([key]) => key !== color));
    onChange({ ...classification, swatches, colorNames: nextColorNames, colorImages: nextColorImages });
  }

  return (
    <div className="border border-neutral-300 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs uppercase text-neutral-500">Phân loại {index + 1}</p>
          <input
            value={classification.name}
            onChange={(event) => onChange({ ...classification, name: event.target.value })}
            className="mt-1 h-10 w-full max-w-md border px-3 font-medium"
          />
        </div>
        <button type="button" onClick={onDelete} className="border border-red-500 px-3 py-2 text-xs uppercase text-red-600">Bỏ phân loại</button>
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-2">
        <label className="text-xs uppercase text-neutral-500">
          Tên màu
          <input
            value={newColorName}
            onChange={(event) => setNewColorName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addColor();
              }
            }}
            placeholder="Đen, kem, nâu..."
            className="mt-1 h-10 w-40 border px-3 text-sm normal-case"
          />
        </label>
        <button type="button" onClick={addColor} className="h-10 border border-black px-4 text-xs uppercase">Thêm màu</button>
      </div>

      <div className="mt-3 grid gap-3">
        {classification.swatches.map((color) => (
          <div key={color} className="grid gap-3 border border-neutral-200 p-3 md:grid-cols-[120px_1fr]">
            <div>
              {colorImages[color] && <img src={colorImages[color]} alt={`${productName} ${colorNames[color] || classification.name}`} className="h-20 w-20 border border-neutral-200 object-cover" />}
              <strong className="mt-2 block text-sm">{colorNames[color] || "Màu mới"}</strong>
              <button type="button" onClick={() => removeColor(color)} className="mt-3 border border-red-500 px-2 py-1 text-[10px] uppercase text-red-600">Xóa màu</button>
            </div>
            <div>
              <label className="mb-2 block text-xs uppercase text-neutral-500">Tên màu hiển thị cho khách</label>
              <input value={colorNames[color] || ""} onChange={(event) => updateColorName(color, event.target.value)} className="mb-3 h-10 w-full border px-3 text-sm" />
              <label className="mb-2 block text-xs uppercase text-neutral-500">Ảnh cho màu này</label>
              <input value={colorImages[color] || ""} onChange={(event) => updateColorImage(color, event.target.value)} placeholder="URL ảnh" className="h-10 w-full border px-3 text-sm" />
              <input type="file" accept="image/*" onChange={(event) => onUpload(event, (url) => updateColorImage(color, url))} className="mt-2 block text-xs" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Text({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="text-sm">
      {label}
      <input value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 h-10 w-full border px-3" />
    </label>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="text-sm">
      {label}
      <input type="number" value={value} onChange={(event) => onChange(Number(event.target.value))} className="mt-1 h-10 w-full border px-3" />
    </label>
  );
}
