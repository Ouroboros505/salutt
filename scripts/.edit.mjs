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
  const PLACES = [
    { name: "House", address: "100 Main St, Lafayette, IN 47901", formatted: "100 Main St, Lafayette, IN 47901, USA", lat: 40.416700, lng: -86.875300 },
    { name: "CoRec", address: "France A. Cordova Recreational Sports Center, West Lafayette, IN", formatted: "355 N Martin Jischke Dr, West Lafayette, IN 47906, USA", lat: 40.4282417, lng: -86.9223556 },
    { name: "Office", address: "Lilly Hall of Life Sciences, West Lafayette, IN", formatted: "915 Mitch Daniels Blvd, West Lafayette, IN 47907, USA", lat: 40.423476, lng: -86.9180072 },
    { name: "Aldi", address: "Aldi, 957 Sagamore Pkwy S, Lafayette, IN 47905", formatted: "957 Sagamore Pkwy S, Lafayette, IN 47905, USA", lat: 40.406048, lng: -86.856639 }
  ];
  for (const place of PLACES) {
    if ((data.places ?? []).some((p) => p.name.toLowerCase() === place.name.toLowerCase())) continue;
    const nextId = Math.max(0, ...(data.places ?? []).map((p) => p.id ?? 0)) + 1;
    (data.places ??= []).push(
      touch({ id: nextId, ...place, useCount: 0, lastUsed: Date.now(), createdAt: Date.now() })
    );
    notes.push(`added place ${place.name} (${place.formatted})`);
  }
  const nameToId = /* @__PURE__ */ new Map();
  for (const p of data.places ?? []) if (p.id != null) nameToId.set(p.name.toLowerCase(), p.id);
  const ROUTE_UPDATES = [
    { name: "Home \u2192 campus", from: "House", to: "Office", km: 4.18, climbM: 36 },
    { name: "Campus \u2192 home", from: "Office", to: "House", km: 4.15, climbM: 54 },
    { name: "Home \u2192 CoRec", from: "House", to: "CoRec", km: 4.93, climbM: 38 },
    { name: "CoRec \u2192 home", from: "CoRec", to: "House", km: 4.91, climbM: 57 },
    { name: "Home \u2192 Aldi", from: "House", to: "Aldi", km: 2.71, climbM: 8 },
    { name: "Aldi \u2192 home", from: "Aldi", to: "House", km: 2.66, climbM: 10 }
  ];
  for (const u of ROUTE_UPDATES) {
    const r = (data.routes ?? []).find((x) => x.name === u.name);
    if (!r) {
      notes.push(`route "${u.name}" not found \u2014 skipped`);
      continue;
    }
    r.km = u.km;
    r.climbM = u.climbM;
    r.fromPlaceId = nameToId.get(u.from.toLowerCase());
    r.toPlaceId = nameToId.get(u.to.toLowerCase());
    r.source = "google";
    touch(r);
    notes.push(`updated "${u.name}" -> ${u.km} km, climb ${u.climbM} m`);
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
