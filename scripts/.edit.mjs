// scripts/edit-data.ts
import { readFileSync } from "node:fs";

// src/lib/syncCrypto.ts
var ENDPOINT_PATH = "/api/sync";
var PBKDF2_ROUNDS = 31e4;
var apiBase = "";
function setApiBase(base) {
  apiBase = base.replace(/\/$/, "");
}
function normalizeSecret(secret2) {
  const s = secret2.trim();
  if (/^SLT[-\s]/i.test(s) || /^[0-9A-Z\s-]+$/i.test(s.replace(/[a-z]/g, "A"))) {
    const compact = s.toUpperCase().replace(/[^0-9A-Z]/g, "");
    if (compact.startsWith("SLT")) return compact.slice(3);
  }
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
var hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
var cached = null;
async function deriveKeys(secret2) {
  const norm = normalizeSecret(secret2);
  if (cached?.secret === norm) return cached.keys;
  const enc = new TextEncoder();
  const base = await crypto.subtle.importKey("raw", enc.encode(norm), "PBKDF2", false, [
    "deriveBits",
    "deriveKey"
  ]);
  const masterBits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: enc.encode("salutt/sync/v1"), iterations: PBKDF2_ROUNDS, hash: "SHA-256" },
    base,
    256
  );
  const master = await crypto.subtle.importKey("raw", masterBits, "HKDF", false, ["deriveBits", "deriveKey"]);
  const sub = (info, bits) => crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: enc.encode(info) },
    master,
    bits
  );
  const keys = {
    id: hex(await sub("id", 128)),
    auth: hex(await sub("auth", 256)),
    key: await crypto.subtle.deriveKey(
      { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: enc.encode("aes") },
      master,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    )
  };
  cached = { secret: norm, keys };
  return keys;
}
var unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function gzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function gunzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function encrypt(keys, plaintext) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    keys.key,
    await gzip(new TextEncoder().encode(plaintext))
  );
  const joined = new Uint8Array(iv.length + ct.byteLength);
  joined.set(iv, 0);
  joined.set(new Uint8Array(ct), iv.length);
  let s = "";
  for (let i = 0; i < joined.length; i += 32768) {
    s += String.fromCharCode(...joined.subarray(i, i + 32768));
  }
  return btoa(s);
}
async function decrypt(keys, payload) {
  const raw = unb64(payload);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: raw.subarray(0, 12) },
    keys.key,
    raw.subarray(12)
  );
  return new TextDecoder().decode(await gunzip(new Uint8Array(plain)));
}
var WrongSecretError = class extends Error {
};
async function request(method, keys, body) {
  return fetch(`${apiBase}${ENDPOINT_PATH}`, {
    method,
    headers: {
      "X-Salutt-Id": keys.id,
      "X-Salutt-Auth": keys.auth,
      ...body ? { "Content-Type": "application/json" } : {}
    },
    ...body ? { body: JSON.stringify(body) } : {}
  });
}
async function pushPayload(secret2, payload) {
  const keys = await deriveKeys(secret2);
  const blob = await encrypt(keys, JSON.stringify(payload));
  const envelope = { updatedAt: Date.now(), device: deviceName(), blob };
  const res = await request("POST", keys, envelope);
  if (res.status === 403) throw new WrongSecretError("That secret does not match this account.");
  if (!res.ok) throw new Error(`Sync failed (${res.status})`);
  return { updatedAt: envelope.updatedAt, bytes: blob.length };
}
async function fetchRemote(secret2) {
  const keys = await deriveKeys(secret2);
  const res = await request("GET", keys);
  if (res.status === 404) return null;
  if (res.status === 403) throw new WrongSecretError("That secret does not match this account.");
  if (!res.ok) throw new Error(`Sync failed (${res.status})`);
  const envelope = await res.json();
  let json;
  try {
    json = await decrypt(keys, envelope.blob);
  } catch {
    throw new WrongSecretError("That secret cannot open this backup.");
  }
  return { updatedAt: envelope.updatedAt, device: envelope.device, backup: JSON.parse(json) };
}
function deviceName() {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  if (/Android/i.test(ua)) return "Android";
  if (/iPhone|iPad/i.test(ua)) return "iOS";
  if (/Mac/i.test(ua)) return "Mac";
  if (/Windows/i.test(ua)) return "Windows";
  if (/Linux/i.test(ua)) return "Linux";
  return "device";
}

// scripts/edit-data.ts
var SITE = process.env.SALUTT_URL ?? "https://salutt.montejongas.com";
var DRY = process.argv.includes("--dry");
function secret() {
  const text = readFileSync(new URL("../SECRETS.local.md", import.meta.url), "utf8");
  const m = /```\n([a-z0-9-]+)\n```/.exec(text);
  if (!m) throw new Error("no recovery phrase in SECRETS.local.md");
  return m[1];
}
function legacyUid(table, key, createdAt) {
  const seed = `${table}:${key}:${createdAt ?? 0}`;
  const fnv = (start) => {
    let h = start;
    for (let i = 0; i < seed.length; i++) {
      h ^= seed.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h.toString(16).padStart(8, "0");
  };
  return `L${fnv(2166136261)}${fnv(2128857121)}`;
}
function touch(row) {
  row.updatedAt = Date.now();
  return row;
}
var summarise = (data) => Object.entries(data).filter(([, rows]) => Array.isArray(rows) && rows.length).map(([t, rows]) => `${t}=${rows.length}`).join(" ");
function change(data) {
  const notes = [];
  const OZ = 453.592;
  const RECIPE = [
    // name in the database                                           grams  where the number came from
    ["Chicken, broiler or fryers, breast, skinless, boneless, meat only, raw", 2.75 * OZ, [120, 22.5, 0, 2.62, 0]],
    ["Pork, fresh, loin, center loin (chops), boneless, separable lean and fat, raw", 1.5 * OZ, [201, 21.1, 0, 13, 0]],
    ["Pesto alla Genovese", 6 * 11.75, [446.8, 4.255, 6.383, 44.68, 1.064]],
    // 6 tbsp, jar is 47 g per 4 tbsp
    ["Squash, summer, zucchini, includes skin, raw", 2 * 196, [17, 1.21, 3.11, 0.32, 1]],
    // 2 medium
    ["Broccoli, raw", 340, [31, 2.57, 6.27, 0.34, 2.4]],
    // the bag says so
    ["Peppers, sweet, red, raw", 3 * 119, [26, 0.99, 6.03, 0.3, 2.1]],
    // 3 medium
    ["Mushrooms, white, raw", 227, [22, 3.09, 3.26, 0.34, 1]],
    // the pack says so
    ["Onions, raw", 110, [40, 1.1, 9.34, 0.1, 1.7]],
    // 1 medium
    ["Tomatoes, red, ripe, raw, year round average", 283, [18, 0.88, 3.89, 0.2, 1.2]],
    // 1 pint
    ["Lemon juice, raw", 90, [22, 0.35, 6.9, 0.24, 0.3]],
    // juice of 2, not the whole fruit
    ["Olive oil", 5 * 13.5, [900, 0, 0, 100, 0]],
    // 5 tbsp
    ["Spices, pepper, black", 2.3, [251, 10.4, 64, 3.26, 25.3]],
    // 1 tsp
    ["Spices, garlic powder", 4.2, [331, 16.6, 72.7, 0.73, 9]],
    // 1.5 tsp
    ["Cheese, parmesan, hard", 50, [392, 35.8, 3.22, 25, 0]]
  ];
  if (!(data.recipes ?? []).some((r) => /pesto/i.test(r.name))) {
    const items = RECIPE.map(([name, grams, per100]) => {
      const g = Math.round(grams * 10) / 10;
      const f = (i) => Math.round(per100[i] * g / 100 * 10) / 10;
      return {
        name,
        grams: g,
        kcal: Math.round(per100[0] * g / 100),
        protein: f(1),
        carbs: f(2),
        fat: f(3),
        fiber: f(4)
      };
    });
    const raw = items.reduce((t, i) => t + i.grams, 0);
    const nextId = Math.max(0, ...(data.recipes ?? []).map((r) => r.id ?? 0)) + 1;
    (data.recipes ??= []).push(
      touch({
        id: nextId,
        name: "Chicken and pork pesto with roasted veg",
        items,
        cookedG: 0,
        // weigh the tray and this stops being a guess
        cookLossPct: 25,
        servings: void 0,
        notes: "2 tsp salt not listed \u2014 no energy, and no honest row for it. Cook loss is estimated at 25%; weigh the finished tray to replace it.",
        useCount: 0,
        lastUsed: 0,
        createdAt: Date.now()
      })
    );
    const kcal = items.reduce((t, i) => t + i.kcal, 0);
    notes.push(
      `added recipe "Chicken and pork pesto with roasted veg" \u2014 ${items.length} ingredients, ${Math.round(raw)} g raw, ${kcal} kcal`
    );
  }
  return notes;
}
async function main() {
  setApiBase(SITE);
  const remote = await fetchRemote(secret());
  if (!remote) throw new Error("nothing stored on the server");
  const backup = remote.backup;
  console.log(`before: ${summarise(backup.data)}`);
  const notes = change(backup.data);
  if (!notes.length) {
    console.log("nothing to change");
    return;
  }
  notes.forEach((n) => console.log(`  ${n}`));
  const touched = Object.values(backup.data).flat().filter((r) => r && typeof r === "object" && Date.now() - (r.updatedAt ?? 0) < 6e4).length;
  console.log(`after : ${summarise(backup.data)}  (${touched} row(s) stamped)`);
  if (DRY) {
    console.log("\n--dry, nothing written");
    return;
  }
  backup.exportedAt = (/* @__PURE__ */ new Date()).toISOString();
  const res = await pushPayload(secret(), backup);
  console.log(`
pushed ${res.bytes} bytes; the phone will merge it on its next sync`);
}
void main();
export {
  legacyUid,
  touch
};
