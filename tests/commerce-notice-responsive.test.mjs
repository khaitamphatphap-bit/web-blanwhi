import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const customerPage = await readFile(new URL("../public/preview.html", import.meta.url), "utf8");

test("logo Bộ Công Thương nhỏ gọn trên điện thoại và không đổi quy tắc desktop", () => {
  assert.match(customerPage, /\.commerce-notice img \{ display: block; width: auto; max-width: min\(190px, 62vw\); max-height: 70px;/);
  assert.match(customerPage, /@media \(max-width: 540px\)[\s\S]*?\.commerce-notice \{ padding: 0 18px 22px; \}[\s\S]*?\.commerce-notice img \{ max-width: 120px; max-height: 44px; \}/);
});
