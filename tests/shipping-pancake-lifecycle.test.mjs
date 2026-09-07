import assert from "node:assert/strict";
import test from "node:test";
import { runShippingPancakeBatch } from "../scripts/shipping-pancake-simulation.mjs";

test("2000 đơn miễn ship giữ tổng trang khách bằng Pancake và hủy đầy đủ", () => {
  const result = runShippingPancakeBatch({ batchNumber: 1, orderCount: 2000, groupSize: 10 });

  assert.equal(result.orders, 2000);
  assert.equal(result.databaseOrders, 2000);
  assert.equal(result.pancakeOrders, 2000);
  assert.equal(result.cancelledOrders, 2000);
  assert.ok(result.freeShippingOrders > 0);
  assert.ok(result.paidShippingOrders > 0);
  assert.ok(result.productDiscountOrders > 0);
});
