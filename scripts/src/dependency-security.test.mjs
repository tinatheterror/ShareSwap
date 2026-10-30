import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import test from "node:test";

const api = createRequire(resolve("artifacts/api-server/package.json"));
const mobile = createRequire(resolve("artifacts/shareswap-mobile/package.json"));
const from = (require, name) => createRequire(require.resolve(name));
const helpers = from(api, "@sendgrid/mail");
const sendgridMerge = from(helpers, "@sendgrid/helpers")("deepmerge");
const expoConfigMerge = from(from(mobile, "expo"), "@expo/config")("deepmerge");
const jestMerge = from(from(mobile, "jest"), "jest-config")("deepmerge");

for (const [consumer, merge] of [
  ["SendGrid", sendgridMerge],
  ["Expo config", expoConfigMerge],
  ["Jest config", jestMerge],
]) {
  test(`${consumer}: refuses prototype keys from either input, including null prototypes`, () => {
    const malicious = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"prototype":{"polluted":true},"safe":1}');
    for (const [target, source] of [
      [malicious, {}],
      [{}, malicious],
      [Object.create(null), malicious],
      [Object.assign(Object.create(null), malicious), {}],
    ]) {
      const result = merge(target, source);
      assert.equal(Object.getPrototypeOf(result), Object.prototype);
      assert.equal(result.polluted, undefined);
      for (const key of ["__proto__", "constructor", "prototype"]) {
        assert.equal(Object.hasOwn(result, key), false);
      }
    }
    assert.equal({}.polluted, undefined);
  });

  test(`${consumer}: protects nested objects and arrays without changing normal merging`, () => {
    const payload = JSON.parse('{"nested":{"__proto__":{"polluted":true}},"items":[{"__proto__":{"polluted":true}}]}');
    const result = merge.all([{ nested: { valid: true }, items: [1] }, payload]);
    assert.deepEqual(result, { nested: { valid: true }, items: [1, {}] });
    assert.equal(result.nested.polluted, undefined);
    assert.equal(result.items[1].polluted, undefined);
    const key = Symbol("safe");
    assert.equal(merge({}, { [key]: 3 })[key], 3);
    assert.deepEqual(merge({ items: [1] }, { items: [2] }, {
      arrayMerge: (_target, source) => source,
    }), { items: [2] });
  });
}

test("SendGrid still constructs a mail payload with the patched merge", () => {
  const { Mail } = helpers("@sendgrid/helpers").classes;
  const mail = Mail.create({
    to: "recipient@example.invalid",
    from: "sender@example.invalid",
    subject: "Dependency compatibility",
    text: "Local test; no email is sent.",
  }).toJSON();
  assert.equal(mail.subject, "Dependency compatibility");
  assert.equal(mail.personalizations[0].to[0].email, "recipient@example.invalid");
});

test("Expo's Metro reads image buffers and asset files after the image-size upgrade", async () => {
  const metro = from(from(mobile, "@expo/cli"), "@expo/metro/package.json");
  const { getAssetSize, getAssetData } = metro("metro/private/Assets");
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aEl8AAAAASUVORK5CYII=",
    "base64",
  );
  assert.deepEqual(getAssetSize("png", png, "fixture.png"), { width: 1, height: 1 });
  assert.throws(() => getAssetSize("png", Buffer.from("invalid"), "bad.png"));
  const directory = await mkdtemp(join(tmpdir(), "shareswap-dependency-"));
  try {
    const filename = join(directory, "fixture.png");
    await writeFile(filename, png);
    const data = await getAssetData(filename, "fixture.png", [], null, "/assets");
    assert.equal(data.width, 1);
    assert.equal(data.height, 1);
    assert.equal(data.type, "png");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Google Cloud's CommonJS UUID consumer retains v4 support", () => {
  const gaxios = from(from(api, "@replit/object-storage"), "@google-cloud/storage");
  const { v4, validate } = from(gaxios, "gaxios")("uuid");
  const first = v4();
  const second = v4();
  assert.equal(validate(first), true);
  assert.notEqual(first, second);
});

test("Zod v4 and drizzle-zod share a working validator runtime", () => {
  const { z } = api("zod");
  assert.equal(z.string().parse("ok"), "ok");
  assert.equal(z.array(z.string()).max(1).safeParse(["a", "b"]).success, false);
  const db = createRequire(resolve("lib/db/package.json"));
  const { pgTable, text } = db("drizzle-orm/pg-core");
  const { createInsertSchema } = db("drizzle-zod");
  const schema = createInsertSchema(pgTable("dependency_test", {
    label: text("label").notNull(),
  }));
  assert.deepEqual(schema.parse({ label: "ok" }), { label: "ok" });
  assert.equal(schema.safeParse({ label: 1 }).success, false);
});

test("Express and Multer parse uploads and reject oversized files", async () => {
  const express = api("express");
  const multer = api("multer");
  const app = express();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 64 } });
  app.post("/upload", upload.single("photo"), (req, res) => {
    res.json({ name: req.file.originalname, size: req.file.size, caption: req.body.caption });
  });
  app.use((err, _req, res, _next) => {
    res.status(err instanceof multer.MulterError ? 413 : 400).json({ code: err.code });
  });
  const server = createServer(app);
  server.listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
    const url = `http://127.0.0.1:${server.address().port}/upload`;
    const form = new FormData();
    form.append("photo", new Blob(["abc"]), "fixture.txt");
    form.append("caption", "test");
    const response = await fetch(url, { method: "POST", body: form });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { name: "fixture.txt", size: 3, caption: "test" });
    const oversized = new FormData();
    oversized.append("photo", new Blob(["x".repeat(65)]), "large.txt");
    const rejected = await fetch(url, { method: "POST", body: oversized });
    assert.equal(rejected.status, 413);
    assert.equal((await rejected.json()).code, "LIMIT_FILE_SIZE");
  } finally {
    const closed = once(server, "close");
    server.close();
    server.closeAllConnections();
    await closed;
  }
});
