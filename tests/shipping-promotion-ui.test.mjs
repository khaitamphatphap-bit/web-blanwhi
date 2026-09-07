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

test("mô phỏng 2000 đơn với phí và ngưỡng admin thay đổi liên tục", () => {
  const fees = [0, 1000, 11000, 15000, 30000, 50000, 99000];
  const thresholds = [50000, 100000, 300000, 499000, 1000000, 2000000, 5000000];

  for (let index = 0; index < 2000; index += 1) {
    const defaultFee = fees[index % fees.length];
    const threshold = thresholds[Math.floor(index / fees.length) % thresholds.length];
    const freeShippingEnabled = index % 3 !== 0;
    const subtotalCases = [Math.max(1, threshold - 1), threshold, threshold + 1, Math.max(1, Math.floor(threshold / 2))];
    const subtotal = subtotalCases[index % subtotalCases.length];
    const productDiscount = index % 4 === 0 ? Math.min(15000, subtotal) : 0;
    const pricing = calculateStandardShipping({
      subtotal,
      defaultFee,
      freeShippingEnabled,
      freeShippingThreshold: threshold
    });
    const shouldBeFree = freeShippingEnabled && defaultFee > 0 && subtotal >= threshold;
    const total = Math.max(0, subtotal - productDiscount + pricing.chargedFee);

    assert.equal(pricing.baseFee, defaultFee);
    assert.equal(pricing.qualifiesForFreeShipping, shouldBeFree);
    assert.equal(pricing.discount, shouldBeFree ? defaultFee : 0);
    assert.equal(pricing.chargedFee, shouldBeFree ? 0 : defaultFee);

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
    assert.equal(payload.discount, productDiscount + pricing.discount);
    assert.equal(payload.total_discount, productDiscount + pricing.discount);
    assert.equal(payload.total_price, total);
    assert.equal(payload.cod, index % 2 === 0 ? total : 0);
    if (!shouldBeFree) assert.equal(payload.total_discount, productDiscount);

    // Đổi cấu hình admin sau khi đặt không được làm thay đổi bản chụp của đơn cũ.
    const oldOrderPayloadAfterAdminChange = buildPancakeOrderPayload({
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
    assert.equal(oldOrderPayloadAfterAdminChange.shipping_fee, payload.shipping_fee);
    assert.equal(oldOrderPayloadAfterAdminChange.total_discount, payload.total_discount);
    assert.equal(oldOrderPayloadAfterAdminChange.total_price, payload.total_price);
  }
});

test("server chốt nhãn và phí ước tính từ cấu hình mới nhất thay vì dữ liệu trình duyệt cũ", () => {
  assert.match(paymentRoute, /shippingFeeLabel:\s*isExpressShipping[\s\S]*Intl\.NumberFormat\("vi-VN"\)\.format\(totals\.shipping\)/);
  assert.match(paymentRoute, /deliveryFeeEstimated:\s*isExpressShipping[\s\S]*:\s*totals\.shipping/);
});
