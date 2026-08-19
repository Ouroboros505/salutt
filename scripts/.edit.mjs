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
  const tray = (data.recipes ?? []).find((r) => /pesto/i.test(r.name));
  if (tray && tray.cookLossPct !== 29) {
    tray.cookLossPct = 29;
    tray.notes = "2 tsp salt not listed \u2014 no energy, and no honest row for it. Cook loss 29%, worked out per ingredient from USDA raw-vs-cooked protein; weigh the finished tray to replace it with a measurement.";
    touch(tray);
    notes.push("pesto tray: cook loss 25% -> 29%, from each ingredient rather than one guess");
  }
  const per100Of = (rec) => {
    const raw = rec.items.reduce(
      (t, i) => ({
        g: t.g + i.grams,
        kcal: t.kcal + i.kcal,
        protein: t.protein + i.protein,
        carbs: t.carbs + i.carbs,
        fat: t.fat + i.fat,
        fiber: t.fiber + i.fiber
      }),
      { g: 0, kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 }
    );
    const finished = rec.cookedG > 0 ? rec.cookedG : raw.g * (1 - (rec.cookLossPct ?? 0) / 100);
    const f = finished > 0 ? 100 / finished : 0;
    return {
      kcal: raw.kcal * f,
      protein: raw.protein * f,
      carbs: raw.carbs * f,
      fat: raw.fat * f,
      fiber: raw.fiber * f
    };
  };
  for (const pm of data.plannedMeals ?? []) {
    let touched = false;
    for (const it of pm.items) {
      let basis = null;
      if (it.foodId != null) {
        const food = (data.foods ?? []).find((f) => f.id === it.foodId);
        if (food) basis = { kcal: food.kcal, protein: food.protein, carbs: food.carbs, fat: food.fat, fiber: food.fiber };
      } else if (it.recipeId != null) {
        const rec = (data.recipes ?? []).find((r) => r.id === it.recipeId);
        if (rec) basis = per100Of(rec);
      }
      if (!basis) continue;
      const before = it.kcal;
      const fac = (it.grams ?? 0) / 100;
      const round1 = (v) => Math.round(v * fac * 10) / 10;
      it.kcal = Math.round(basis.kcal * fac);
      it.protein = round1(basis.protein);
      it.carbs = round1(basis.carbs);
      it.fat = round1(basis.fat);
      it.fiber = round1(basis.fiber);
      it.per100 = basis;
      if (before !== it.kcal) touched = true;
    }
    if (touched) {
      touch(pm);
      const tot = pm.items.reduce((t, i) => t + i.kcal, 0);
      notes.push(`repaired planned meal "${pm.meal}" \u2014 ${pm.items.length} items now total ${tot} kcal`);
    }
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
