import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../lib/image-storage.ts", import.meta.url), "utf8");

test("R2 reuses one S3 client per runtime", () => {
  assert.match(source, /let r2Client: S3Client \| null = null/);
  assert.match(source, /if \(r2Client && r2ClientKey === key\) return r2Client/);
  assert.match(source, /r2Client = new S3Client/);
  assert.doesNotMatch(source, /return new S3Client/);
});
