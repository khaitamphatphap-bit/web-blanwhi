import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { calculateStandardShipping } from "../lib/shipping-pricing.ts";
import { buildPancakeOrderPayload } from "../lib/pancake/domain.ts";

const [customerPage, adminEditor, paymentRoute] = await Promise.all([
  readFile(new URL("../public/preview.html", import.meta.url), "utf8"),
  readFile(new URL("../app/admin/site/site-editor.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/payments/create/route.ts", import.meta.url), "utf8")
]);

test("admin có công tắc và chỉ hiện ô nhập ngưỡng khi bật", () => {
  assert.match(adminEditor, /freeShippingEnabled/);
  assert.match(adminEditor, /Miễn phí vận chuyển cho đơn từ/);
  assert.match(adminEditor, /content\.shipping\?\.freeShippingEnabled === true &&/);
});

test("trang khách đặt gợi ý ngay dưới phí ship và không còn miễn ship cứng 2 triệu", () => {
  const shippingRow = customerPage.indexOf('id="shippingText"');
  const promotionNote = customerPage.indexOf('id="shippingPromotionNote"');
  assert.ok(shippingRow >= 0 && promotionNote > shippingRow);
  assert.doesNotMatch(customerPage, /sub\s*>=\s*2000000/);
  assert.match(customerPage, /Miễn phí vận chuyển cho đơn từ/);
  assert.match(customerPage, /Đơn hàng đã được miễn phí vận chuyển/);
  assert.match(customerPage, /renderCartTotals\(\);/);
  assert.doesNotMatch(paymentRoute, /subtotal\s*>=\s*2000000/);
});

test("mô phỏng 1000 đơn giữ tổng website và Pancake khớp nhau", () => {
  for (let index = 0; index < 1000; index += 1) {
    const subtotal = 1000 + index * 997;
    const productDiscount = index % 4 === 0 ? 15000 : 0;
    const pricing = calculateStandardShipping({
      subtotal,
      defaultFee: 11000,
      freeShippingEnabled: true,
      freeShippingThreshold: 300000
    });
    const total = Math.max(0, subtotal - productDiscount + pricing.chargedFee);
    const payload = buildPancakeOrderPayload({
      code: `BLW-SHIPPING-${index}`,
      customer: { name: `Khách ${index}`, phone: "0900000000", address: "Địa chỉ test" },
      items: [{ name: "Sản phẩm test", quantity: 1, unitPrice: subtotal }],
      discount: productDiscount,
      shipping: pricing.chargedFee,
      shippingBaseFee: pricing.baseFee,
      shippingDiscount: pricing.discount,
      total,
      paymentMethod: index % 2 === 0 ? "cod" : "zalopay"
    });

    assert.equal(payload.shipping_fee, pricing.baseFee);
    assert.equal(payload.total_discount, productDiscount + pricing.discount);
    assert.equal(payload.total_price, total);
    assert.equal(payload.cod, index % 2 === 0 ? total : 0);
  }
});
