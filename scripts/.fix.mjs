// scripts/fix-recipe.ts
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

// scripts/fix-recipe.ts
var SITE = process.env.SALUTT_URL ?? "https://salutt.montejongas.com";
var DRY = process.argv.includes("--dry");
function secret() {
  const text = readFileSync(new URL("../SECRETS.local.md", import.meta.url), "utf8");
  const m = /```\n([a-z0-9-]+)\n```/.exec(text);
  if (!m) throw new Error("no recovery phrase in SECRETS.local.md");
  return m[1];
}
var FIXES = {
  Krinkle: {
    // A braising cut, raw, weighed raw like everything else here.
    name: "Beef, chuck for stew, separable lean and fat, all grades, raw",
    grams: 454,
    per100: [128, 21.8, 0.16, 4.48, 0]
  },
  "separable lean only, raw": {
    // Cooked whole, untrimmed. Raw figures, because the recipe is raw weights.
    name: "Pork, fresh, shoulder, (Boston butt), blade (steaks), separable lean and fat, raw",
    grams: 1361,
    per100: [186, 17.4, 0, 12.4, 0]
  },
  "cumin seed": { name: "Spices, cumin seed", grams: 4.2, per100: [375, 17.8, 44.2, 22.3, 10.5] },
  "thyme, dried": { name: "Spices, thyme, dried", grams: 2, per100: [276, 9.11, 63.9, 7.43, 37] }
};
var KEYS = ["kcal", "protein", "carbs", "fat", "fiber"];
async function main() {
  setApiBase(SITE);
  const remote = await fetchRemote(secret());
  if (!remote) throw new Error("nothing stored on the server");
  const backup = remote.backup;
  const recipes = backup.data.recipes ?? [];
  if (!recipes.length) throw new Error("no recipes in the stored copy");
  for (const recipe of recipes) {
    for (const item of recipe.items) {
      const key = Object.keys(FIXES).find((k) => item.name.includes(k));
      if (!key) continue;
      const fix = FIXES[key];
      const before = `${item.grams} g ${item.name.slice(0, 44)} = ${Math.round(item.kcal)} kcal`;
      item.name = fix.name;
      item.grams = fix.grams;
      KEYS.forEach((k, i) => {
        item[k] = Math.round(fix.per100[i] * fix.grams / 100 * 10) / 10;
      });
      console.log(`  ${before}
  -> ${item.grams} g ${item.name.slice(0, 44)} = ${Math.round(item.kcal)} kcal
`);
    }
    const kcal = recipe.items.reduce((t, i) => t + i.kcal, 0);
    const protein = recipe.items.reduce((t, i) => t + i.protein, 0);
    const grams = recipe.items.reduce((t, i) => t + i.grams, 0);
    console.log(`  ${recipe.name}: ${Math.round(grams)} g raw, ${Math.round(kcal)} kcal, P${Math.round(protein)}`);
  }
  if (DRY) {
    console.log("\n--dry, nothing written");
    return;
  }
  backup.exportedAt = (/* @__PURE__ */ new Date()).toISOString();
  const res = await pushPayload(secret(), backup);
  console.log("\npushed:", JSON.stringify(res));
}
void main();
