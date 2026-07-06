"use client";

import Link from "next/link";
import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import type { CmsProduct, SiteContent } from "@/lib/site-content";

const emptyProduct: CmsProduct = {
  id: "",
  name: "Sản phẩm mới",
  price: "390.000đ",
  fit: "Boxy sạch, dễ mặc",
  kind: "tee",
  swatches: ["#111", "#f4f4f2"],
  sizes: ["S", "M", "L", "XL"],
  image: "",
  galleryImages: [],
  colorNames: {},
  colorImages: {},
  sold: 0,
  genders: ["men", "women"],
  isBestSeller: false,
  isNew: true,
  isSale: false,
  salePercent: 0,
  active: true
};

export function SiteEditor() {
  const [content, setContent] = useState<SiteContent | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [jsonDraft, setJsonDraft] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
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

  async function uploadImage(event: ChangeEvent<HTMLInputElement>, onUrl: (url: string) => void) {
    const file = event.target.files?.[0];
    if (!file) return;
    setMessage("Đang upload ảnh...");
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/admin/upload", { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) {
        setMessage(result.error || "Upload ảnh thất bại.");
        return;
      }
      onUrl(result.url);
      setMessage("Đã upload ảnh. Nhấn Lưu thay đổi để cập nhật website khách.");
    } catch {
      setMessage("Upload ảnh thất bại. Vui lòng thử lại.");
    }
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
    <main className="mx-auto min-h-screen max-w-7xl bg-white px-6 py-8 md:my-10 md:px-10">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-neutral-200 pb-5">
        <div>
          <Link href="/" className="text-xs uppercase text-neutral-500">Xem website khách</Link>
          <h1 className="mt-2 text-4xl font-medium">Admin chỉnh website</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/orders" className="h-10 border border-black px-4 pt-2 text-xs uppercase">Đơn hàng</Link>
          <button onClick={() => save()} disabled={saving} className="h-10 bg-black px-5 text-xs uppercase text-white disabled:opacity-50">
            {saving ? "Đang lưu..." : "Lưu thay đổi"}
          </button>
        </div>
      </header>

      {message && <p className="mt-4 border border-neutral-200 bg-neutral-50 p-3 text-sm">{message}</p>}

      <section className="mt-6 grid gap-6 lg:grid-cols-[360px_1fr]">
        <aside className="space-y-5">
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
        </aside>

        <section className="grid gap-5">
          <div className="flex flex-wrap items-center justify-between gap-3 border border-neutral-200 p-4">
            <div>
              <h2 className="text-xl font-medium">Sản phẩm</h2>
              <p className="text-sm text-neutral-500">Thêm/sửa tên, giá, ảnh, màu, size, sale, trạng thái hiển thị.</p>
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
                    <th className="px-3">Nam</th>
                    <th className="px-3">Nữ</th>
                    <th className="px-3">Best seller</th>
                    <th className="px-3">New item</th>
                    <th className="px-3">Sale</th>
                  </tr>
                </thead>
                <tbody>
                  {content.products.map((product) => {
                    const genders = product.genders || ["men", "women"];
                    return (
                      <tr key={product.id} className="border-b border-neutral-100">
                        <td className="py-2 pr-3 font-medium">{product.name}</td>
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

          <div className="grid gap-5 xl:grid-cols-[280px_1fr]">
            <div className="max-h-[520px] overflow-auto border border-neutral-200">
              {content.products.map((product) => (
                <button key={product.id} onClick={() => selectProduct(product.id)} className={`block w-full border-b p-3 text-left text-sm transition ${selectedId === product.id ? "bg-black text-white" : "bg-white hover:bg-neutral-50"}`}>
                  <span className="flex items-center justify-between gap-3">
                    <strong>{product.name}</strong>
                    <span className={`shrink-0 border px-2 py-1 text-[10px] uppercase ${selectedId === product.id ? "border-white" : "border-black"}`}>Sửa</span>
                  </span>
                  <span className="mt-1 block text-xs opacity-70">{product.price} · {product.kind} · {product.active ? "đang bán" : "ẩn"}</span>
                </button>
              ))}
            </div>

            {selectedProduct && (
              <div ref={editorRef} id="product-editor">
                <ProductForm
                  product={selectedProduct}
                  onChange={updateProduct}
                  onDelete={() => deleteProduct(selectedProduct.id)}
                  onUpload={(event, onUrl) => uploadImage(event, onUrl)}
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
  onUpload
}: {
  product: CmsProduct;
  onChange: (product: CmsProduct) => void;
  onDelete: () => void;
  onUpload: (event: ChangeEvent<HTMLInputElement>, onUrl: (url: string) => void) => void;
}) {
  const set = <K extends keyof CmsProduct>(key: K, value: CmsProduct[K]) => onChange({ ...product, [key]: value });
  const colorNames = product.colorNames || {};
  const colorImages = product.colorImages || {};
  const galleryImages = product.galleryImages || [];
  const genders = product.genders || ["men", "women"];
  const [newColor, setNewColor] = useState("#111111");
  const [newColorName, setNewColorName] = useState("");
  const [newSize, setNewSize] = useState("");
  const setColorImage = (color: string, url: string) => {
    onChange({ ...product, colorImages: { ...colorImages, [color]: url } });
  };
  const addGalleryImage = (url: string) => {
    onChange({
      ...product,
      image: product.image || url,
      galleryImages: [...galleryImages, url]
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
    const color = newColor.trim();
    if (!color || product.swatches.includes(color)) return;
    onChange({
      ...product,
      swatches: [...product.swatches, color],
      colorNames: { ...colorNames, [color]: newColorName.trim() || colorNames[color] || "Màu mới" },
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

  return (
    <div className="border border-neutral-200 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase text-neutral-500">Đang sửa sản phẩm</p>
          <h3 className="mt-1 text-2xl font-medium">{product.name}</h3>
        </div>
        <button onClick={onDelete} className="h-9 border border-red-500 px-3 text-xs uppercase text-red-600">Xóa</button>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Text label="Tên sản phẩm" value={product.name} onChange={(value) => set("name", value)} />
        <Text label="Giá hiển thị" value={product.price} onChange={(value) => set("price", value)} />
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
            <input type="file" accept="image/*" onChange={(event) => onUpload(event, addGalleryImage)} className="mt-2 block text-xs normal-case" />
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

      <div className="mt-5 border-t pt-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h4 className="text-sm font-semibold uppercase">Màu và ảnh theo từng màu</h4>
            <p className="mt-1 text-xs text-neutral-500">Chọn mã màu để hiển thị, sửa tên màu theo ý shop, rồi upload ảnh riêng cho từng màu.</p>
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
            <label className="text-xs uppercase text-neutral-500">
              Mã màu hiển thị
              <span className="mt-1 flex h-10 items-center gap-2 border px-2">
                <input type="color" value={newColor} onChange={(event) => setNewColor(event.target.value)} className="h-7 w-8 border-0 p-0" />
                <input
                  value={newColor}
                  onChange={(event) => setNewColor(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addColor();
                    }
                  }}
                  className="h-8 w-24 border px-2 text-sm normal-case"
                />
              </span>
            </label>
            <button type="button" onClick={addColor} className="h-10 border border-black px-4 text-xs uppercase">Thêm màu</button>
          </div>
        </div>
        <div className="mt-3 grid gap-3">
          {product.swatches.map((color) => (
            <div key={color} className="grid gap-3 border border-neutral-200 p-3 md:grid-cols-[120px_1fr]">
              <div className="flex flex-wrap items-center gap-2 text-sm md:block">
                <span className="inline-block h-7 w-7 border border-neutral-300 align-middle" style={{ backgroundColor: color }} />
                <strong className="ml-2 align-middle md:ml-0 md:mt-2 md:block">{colorNames[color] || color}</strong>
                <span className="block text-xs text-neutral-500">{color}</span>
                <button type="button" onClick={() => removeColor(color)} className="border border-red-500 px-2 py-1 text-[10px] uppercase text-red-600 md:mt-3">Xóa màu</button>
              </div>
              <div>
                <label className="mb-2 block text-xs uppercase text-neutral-500">Tên màu hiển thị cho khách</label>
                <input value={colorNames[color] || ""} onChange={(event) => setColorName(color, event.target.value)} placeholder="Ví dụ: Đen, Kem, Nâu cafe..." className="mb-3 h-10 w-full border px-3 text-sm" />
                <label className="mb-2 block text-xs uppercase text-neutral-500">Ảnh cho màu này</label>
                <input value={colorImages[color] || ""} onChange={(event) => setColorImage(color, event.target.value)} placeholder="URL ảnh cho màu này" className="h-10 w-full border px-3 text-sm" />
                <input type="file" accept="image/*" onChange={(event) => onUpload(event, (url) => setColorImage(color, url))} className="mt-2 block text-xs" />
                {colorImages[color] && <img src={colorImages[color]} alt={`${product.name} ${color}`} className="mt-3 aspect-[4/3] max-h-56 w-full object-cover" />}
              </div>
            </div>
          ))}
        </div>
      </div>

      {product.image && <img src={product.image} alt={product.name} className="mt-4 aspect-[4/3] max-h-72 w-full object-cover" />}
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
