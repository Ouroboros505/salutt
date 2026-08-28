// scripts/.ch.ts
import { readFileSync } from "node:fs";

// src/lib/syncCrypto.ts
var ENDPOINT_PATH = "/api/sync";
var PBKDF2_ROUNDS = 31e4;
var apiBase = "";
function setApiBase(base) {
  apiBase = base.replace(/\/$/, "");
}
function normalizeSecret(secret) {
  const s = secret.trim();
  if (/^SLT[-\s]/i.test(s) || /^[0-9A-Z\s-]+$/i.test(s.replace(/[a-z]/g, "A"))) {
    const compact = s.toUpperCase().replace(/[^0-9A-Z]/g, "");
    if (compact.startsWith("SLT")) return compact.slice(3);
  }
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
var hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
var cached = null;
async function deriveKeys(secret) {
  const norm = normalizeSecret(secret);
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
async function gunzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
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
async function fetchRemote(secret) {
  const keys = await deriveKeys(secret);
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

// scripts/.ch.ts
setApiBase("https://salutt.montejongas.com");
var phrase = /```\n([a-z0-9-]+)\n```/.exec(readFileSync(new URL("../SECRETS.local.md", import.meta.url), "utf8"))[1];
var d = (await fetchRemote(phrase))?.backup?.data ?? {};
console.log("CHICKEN in your foods:");
for (const f of (d.foods ?? []).filter((x) => /chicken/i.test(x.name)))
  console.log(`  "${f.name}"${f.brand ? ` (${f.brand})` : ""}  per100g: ${f.kcal} kcal  P${f.protein}  C${f.carbs}  F${f.fat}  [${f.source}]`);
console.log("\nCHICKEN inside recipes:");
for (const r of d.recipes ?? []) for (const i of r.items) if (/chicken/i.test(i.name))
  console.log(`  ${r.name}: "${i.name}" ${i.grams}g -> ${Math.round(i.kcal)}kcal P${i.protein.toFixed(0)}  (per100g: ${Math.round(i.kcal / i.grams * 100)}kcal P${(i.protein / i.grams * 100).toFixed(1)})`);
