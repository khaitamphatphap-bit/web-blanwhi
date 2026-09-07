import assert from "node:assert/strict";
import test from "node:test";
import { calculateStandardShipping } from "../lib/shipping-pricing.ts";

test("tắt miễn ship thì mọi đơn có hàng đều trả phí cấu hình", () => {
  assert.deepEqual(calculateStandardShipping({
    subtotal: 300000,
    defaultFee: 11000,
    freeShippingEnabled: false,
    freeShippingThreshold: 300000
  }), {
    baseFee: 11000,
    discount: 0,
    chargedFee: 11000,
    qualifiesForFreeShipping: false
  });
});

test("bật miễn ship áp dụng chính xác tại ngưỡng và phía trên ngưỡng", () => {
  for (const subtotal of [300000, 500000, 2000000]) {
    assert.deepEqual(calculateStandardShipping({
      subtotal,
      defaultFee: 11000,
      freeShippingEnabled: true,
      freeShippingThreshold: 300000
    }), {
      baseFee: 11000,
      discount: 11000,
      chargedFee: 0,
      qualifiesForFreeShipping: true
    });
  }
});

test("đơn dưới ngưỡng, giỏ rỗng và ngưỡng không hợp lệ không được miễn ship", () => {
  assert.equal(calculateStandardShipping({ subtotal: 299999, defaultFee: 11000, freeShippingEnabled: true, freeShippingThreshold: 300000 }).chargedFee, 11000);
  assert.equal(calculateStandardShipping({ subtotal: 0, defaultFee: 11000, freeShippingEnabled: true, freeShippingThreshold: 300000 }).baseFee, 0);
  assert.equal(calculateStandardShipping({ subtotal: 500000, defaultFee: 11000, freeShippingEnabled: true, freeShippingThreshold: 0 }).chargedFee, 11000);
});
