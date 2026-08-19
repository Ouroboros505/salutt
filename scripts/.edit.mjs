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
  if (!(data.foods ?? []).some((f) => /zero sugar/i.test(f.name))) {
    const nextId = Math.max(0, ...(data.foods ?? []).map((f) => f.id ?? 0)) + 1;
    const SRV = 28;
    (data.foods ??= []).push(
      touch({
        id: nextId,
        name: "Beef jerky, Original Zero Sugar",
        brand: "Simms",
        // 1 oz (28 g): 80 kcal, 2 g fat, 0 carb, 0 fibre, 14 g protein, 470 mg sodium.
        kcal: Math.round(80 / SRV * 1e3) / 10,
        protein: Math.round(14 / SRV * 1e3) / 10,
        carbs: 0,
        fat: Math.round(2 / SRV * 1e3) / 10,
        fiber: 0,
        portions: [
          { label: "1 oz serving (28 g)", grams: SRV },
          { label: "half a serving", grams: 14 }
        ],
        defaultPortion: 0,
        liquid: false,
        source: "manual",
        favorite: false,
        useCount: 0,
        lastUsed: 0,
        createdAt: Date.now()
      })
    );
    notes.push("added Beef jerky, Original Zero Sugar (Simms) \u2014 1 oz = 80 kcal, 14 g protein");
  }
  if (!(data.foods ?? []).some((f) => /jerky, original/i.test(f.name))) {
    const nextId = Math.max(0, ...(data.foods ?? []).map((f) => f.id ?? 0)) + 1;
    const SRV = 28;
    (data.foods ??= []).push(
      touch({
        id: nextId,
        name: "Beef jerky, Original",
        brand: "Simms",
        // 1 oz (28 g): 80 kcal, 1 g fat, 5 g carb (5 g sugar), 0 fibre, 10 g protein, 620 mg sodium.
        kcal: Math.round(80 / SRV * 1e3) / 10,
        protein: Math.round(10 / SRV * 1e3) / 10,
        carbs: Math.round(5 / SRV * 1e3) / 10,
        fat: Math.round(1 / SRV * 1e3) / 10,
        fiber: 0,
        portions: [
          { label: "1 oz serving (28 g)", grams: SRV },
          { label: "half a serving", grams: 14 },
          { label: "the whole bag (142 g)", grams: 142 }
        ],
        defaultPortion: 0,
        liquid: false,
        source: "manual",
        favorite: false,
        useCount: 0,
        lastUsed: 0,
        createdAt: Date.now()
      })
    );
    notes.push("added Beef jerky, Original (Simms) \u2014 1 oz = 80 kcal, 10 g protein");
  }
  if (!(data.foods ?? []).some((f) => /skipjack|tuna/i.test(f.name))) {
    const nextId = Math.max(0, ...(data.foods ?? []).map((f) => f.id ?? 0)) + 1;
    const CAN = 95;
    (data.foods ??= []).push(
      touch({
        id: nextId,
        name: "Skipjack tuna, chunk light in water",
        brand: "Northern Catch, Aldi",
        kcal: Math.round(110 / CAN * 1e3) / 10,
        protein: Math.round(25 / CAN * 1e3) / 10,
        carbs: Math.round(1 / CAN * 1e3) / 10,
        fat: Math.round(1 / CAN * 1e3) / 10,
        fiber: 0,
        portions: [
          { label: "1 can, drained (95 g)", grams: CAN },
          { label: "half a can", grams: Math.round(CAN / 2) }
        ],
        defaultPortion: 0,
        liquid: false,
        source: "manual",
        favorite: false,
        useCount: 0,
        lastUsed: 0,
        createdAt: Date.now()
      })
    );
    notes.push("added Skipjack tuna, chunk light in water (Northern Catch, Aldi) \u2014 1 can = 110 kcal, 25 g protein");
  }
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
  const cfg = (data.settings ?? []).find((x) => x.id === "settings");
  if (cfg && (cfg.programStartDate !== "2026-08-17" || cfg.programWeeks !== 8)) {
    cfg.programStartDate = "2026-08-17";
    cfg.programWeeks = 8;
    touch(cfg);
    notes.push("training block: starts 2026-08-17, reminder at week 8 (2026-10-05)");
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
