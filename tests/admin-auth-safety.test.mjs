import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const middleware = await readFile(new URL("../middleware.ts", import.meta.url), "utf8");

test("admin production chỉ dùng tài khoản từ biến môi trường", () => {
  assert.match(middleware, /process\.env\.ADMIN_USERNAME/);
  assert.match(middleware, /process\.env\.ADMIN_PASSWORD/);
  assert.doesNotMatch(middleware, /fallbackAdmin/);
  assert.doesNotMatch(middleware, /BlanwhiAdmin@2026/);
  assert.match(middleware, /process\.env\.NODE_ENV !== "production"/);
  assert.match(middleware, /return adminUnavailable\(\)/);
});

test("header Basic sai định dạng bị từ chối thay vì gây lỗi middleware", () => {
  assert.match(middleware, /try \{[\s\S]*?atob\(header\.slice\(6\)\)[\s\S]*?catch \{[\s\S]*?return unauthorized\(\)/);
  assert.match(middleware, /if \(separator < 0\) return unauthorized\(\)/);
  assert.match(middleware, /safeEqual\(inputUsername, username\)/);
  assert.match(middleware, /safeEqual\(inputPassword, password\)/);
});
