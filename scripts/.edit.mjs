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

// src/lib/date.ts
function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function todayISO() {
  return toISODate(/* @__PURE__ */ new Date());
}
function fromISODate(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function addDays(s, n) {
  const d = fromISODate(s);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}
function daysBetween(a, b) {
  const ms = fromISODate(b).getTime() - fromISODate(a).getTime();
  return Math.round(ms / 864e5);
}

// src/lib/metrics.ts
var KCAL_PER_KG = 7700;
function bmrMifflin(kg, cm, age, sex) {
  const base = 10 * kg + 6.25 * cm - 5 * age;
  return sex === "male" ? base + 5 : base - 161;
}
function ageFrom(birthDate, on = todayISO()) {
  if (!birthDate) return 30;
  const [by, bm, bd] = birthDate.split("-").map(Number);
  const [ny, nm, nd] = on.split("-").map(Number);
  let age = ny - by;
  if (nm < bm || nm === bm && nd < bd) age--;
  return age;
}
var KCAL_PER_KG_FAT_PER_DAY = 31 / 0.453592;
function stoolOffset(weighIns) {
  const known = weighIns.filter((w) => w.afterStool !== void 0 && !w.offProtocol);
  const after = known.filter((w) => w.afterStool).length;
  const before = known.length - after;
  if (after < 4 || before < 4) return null;
  const t0 = known[0].date;
  const rows = known.map((w) => ({ x: daysBetween(t0, w.date), s: w.afterStool ? 1 : 0, y: w.kg }));
  const n = rows.length;
  const S = (f) => rows.reduce((a, r) => a + f(r), 0);
  const [Sx, Ss, Sy] = [S((r) => r.x), S((r) => r.s), S((r) => r.y)];
  const [Sxx, Sss, Sxs] = [S((r) => r.x * r.x), S((r) => r.s * r.s), S((r) => r.x * r.s)];
  const [Sxy, Ssy] = [S((r) => r.x * r.y), S((r) => r.s * r.y)];
  const mx = Sx / n;
  const ms = Ss / n;
  const cxx = Sxx - n * mx * mx;
  const css = Sss - n * ms * ms;
  const cxs = Sxs - n * mx * ms;
  const cxy = Sxy - Sx * Sy / n;
  const csy = Ssy - Ss * Sy / n;
  const det = cxx * css - cxs * cxs;
  if (!(Math.abs(det) > 1e-9)) return null;
  const c = (cxy * -cxs + csy * cxx) / det;
  const kg = -c;
  if (!(kg > 0) || kg > 0.8) return null;
  return { kg, after, before };
}
var RATE_DRIFT_PER_DAY = 0.012;
var LEVEL_DRIFT_PER_DAY = 0.02;
var DEFAULT_NOISE_SD = 0.55;
function weightTrendKalman(weighIns, _halfLifeDays) {
  const sorted = [...weighIns].filter((w) => !w.offProtocol).sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length === 0) return [];
  const off = stoolOffset(weighIns);
  const adjusted = !off ? sorted : sorted.map((w) => w.afterStool === false ? { ...w, kg: w.kg - off.kg } : w);
  let noiseSd = DEFAULT_NOISE_SD;
  if (adjusted.length >= 6) {
    const diffs = [];
    for (let i = 1; i < adjusted.length; i++) {
      const gap = daysBetween(adjusted[i - 1].date, adjusted[i].date);
      if (gap >= 1 && gap <= 3) diffs.push(Math.abs(adjusted[i].kg - adjusted[i - 1].kg));
    }
    if (diffs.length >= 5) {
      diffs.sort((a, b) => a - b);
      const mad = diffs[Math.floor(diffs.length / 2)];
      noiseSd = Math.max(0.2, Math.min(1.2, mad * 1.4826 / Math.SQRT2));
    }
  }
  const R = noiseSd * noiseSd;
  let x0 = adjusted[0].kg;
  let x1 = 0;
  let p00 = R;
  let p01 = 0;
  let p11 = 0.02 * 0.02;
  const out = [];
  let prevDate = adjusted[0].date;
  for (let i = 0; i < adjusted.length; i++) {
    const w = adjusted[i];
    const dt = i === 0 ? 0 : Math.max(1, daysBetween(prevDate, w.date));
    if (dt > 0) {
      x0 = x0 + x1 * dt;
      const q00 = LEVEL_DRIFT_PER_DAY * LEVEL_DRIFT_PER_DAY * dt;
      const q11 = RATE_DRIFT_PER_DAY * RATE_DRIFT_PER_DAY * dt;
      const np002 = p00 + 2 * dt * p01 + dt * dt * p11 + q00;
      const np012 = p01 + dt * p11;
      p00 = np002;
      p01 = np012;
      p11 = p11 + q11;
    }
    const innov = w.kg - x0;
    const S = p00 + R;
    const k0 = p00 / S;
    const k1 = p01 / S;
    x0 += k0 * innov;
    x1 += k1 * innov;
    const np00 = (1 - k0) * p00;
    const np01 = (1 - k0) * p01;
    const np11 = p11 - k1 * p01;
    p00 = np00;
    p01 = np01;
    p11 = np11;
    out.push({
      date: w.date,
      raw: w.kg,
      trend: x0,
      sd: Math.sqrt(Math.max(0, p00)),
      slopePerDay: x1
    });
    prevDate = w.date;
  }
  return out;
}
function weightTrend(weighIns, halfLifeDays) {
  return weightTrendKalman(weighIns, halfLifeDays);
}
function adaptiveTDEE(entries, trend, windowDays = 28, minLoggedDays = 10) {
  if (trend.length < 2) return null;
  const end = trend[trend.length - 1].date;
  const from = addDays(end, -windowDays);
  const win = trend.filter((p) => p.date >= from);
  if (win.length < 2) return null;
  const start = win[0];
  const finish = win[win.length - 1];
  const days = daysBetween(start.date, finish.date);
  if (days < 7) return null;
  const byDay = /* @__PURE__ */ new Map();
  for (const e of entries) {
    if (e.date < start.date || e.date > finish.date) continue;
    byDay.set(e.date, (byDay.get(e.date) ?? 0) + e.kcal);
  }
  const intakes = [...byDay.values()].filter((v) => v > 200);
  if (intakes.length < minLoggedDays) return null;
  const meanIntake = intakes.reduce((a, b) => a + b, 0) / intakes.length;
  const t0 = new Date(start.date).getTime();
  let sw = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (const p of win) {
    const x = (new Date(p.date).getTime() - t0) / 864e5;
    sw += 1;
    sx += x;
    sy += p.trend;
    sxx += x * x;
    sxy += x * p.trend;
  }
  const den = sxx - sx * sx / sw;
  const slopeKgPerDay = Math.abs(den) > 1e-9 ? (sxy - sx * sy / sw) / den : (finish.trend - start.trend) / days;
  const kcal = meanIntake - slopeKgPerDay * KCAL_PER_KG;
  const coverage = intakes.length / (days + 1);
  const confidence = days >= 21 && coverage >= 0.8 ? "high" : days >= 14 && coverage >= 0.6 ? "medium" : "low";
  return {
    kcal: Math.round(kcal),
    days,
    windowDays: days + 1,
    loggedDays: intakes.length,
    meanIntake: Math.round(meanIntake),
    // Reported as the fitted change across the window, so it agrees with the
    // figure the maintenance was actually solved from.
    trendChangeKg: slopeKgPerDay * days,
    confidence
  };
}
function goalPerWeek(settings, kg) {
  return settings.goalPctPerWeek ? -(kg * settings.goalPctPerWeek) : settings.goalKgPerWeek;
}
var TEF_FRACTION = 0.1;
var MAX_DAILY_SWING = 300;
function dayEnergy(settings, kg, intakeKcal, activityKcal, maintenance, usual, meanIntake) {
  const meanActivity = usual?.mean ?? 0;
  const bmr = bmrMifflin(kg, settings.heightCm, ageFrom(settings.birthDate), settings.sex);
  const digestion = TEF_FRACTION * intakeKcal;
  let rest;
  let anchored = false;
  if (maintenance != null && meanActivity != null && meanIntake != null) {
    rest = maintenance - bmr - TEF_FRACTION * meanIntake - meanActivity;
    anchored = true;
  } else {
    rest = 300;
  }
  rest = Math.max(0, rest);
  const total = bmr + digestion + activityKcal + rest;
  return {
    bmr: Math.round(bmr),
    digestion: Math.round(digestion),
    activity: Math.round(activityKcal),
    rest: Math.round(rest),
    total: Math.round(total),
    anchored,
    trust: usual?.trust ?? 0,
    logged: usual?.logged ?? 0,
    days: usual?.days ?? 14,
    // Non-exercise movement runs 150-450 for someone who is on their feet a
    // normal amount; anchoring collapses it to one number.
    restLow: anchored ? Math.round(rest) : 150,
    restHigh: anchored ? Math.round(rest) : 450
  };
}
function usualActivity(workouts, today, days = 14) {
  const start = new Date(today);
  start.setDate(start.getDate() - days);
  const from = start.toISOString().slice(0, 10);
  const byDay = /* @__PURE__ */ new Map();
  for (const w of workouts) {
    if (w.date <= from || w.date >= today) continue;
    byDay.set(w.date, (byDay.get(w.date) ?? 0) + (w.kcal ?? 0));
  }
  if (byDay.size < 3) return null;
  let total = 0;
  for (const v of byDay.values()) total += v;
  const coverage = byDay.size / days;
  const trust = Math.max(0, Math.min(1, (coverage - 0.33) / (0.8 - 0.33)));
  return { mean: total / days, logged: byDay.size, days, trust };
}
function computeTargets(settings, currentKg, adaptive, energy = null) {
  const kg = currentKg ?? 75;
  const age = ageFrom(settings.birthDate);
  const bmr = bmrMifflin(kg, settings.heightCm, age, settings.sex);
  const formulaTDEE = bmr * settings.activity;
  const useAdaptive = adaptive && adaptive.confidence !== "low";
  const tdee = useAdaptive ? adaptive.kcal : formulaTDEE;
  const goal = goalPerWeek(settings, kg);
  let kcal;
  let basis;
  if (settings.kcalTargetOverride) {
    kcal = settings.kcalTargetOverride;
    basis = "manual";
  } else {
    kcal = tdee + goal * KCAL_PER_KG / 7;
    basis = useAdaptive ? "adaptive" : "formula";
  }
  const baseKcal = Math.round(kcal);
  if (energy) {
    const deficit = settings.kcalTargetOverride ? tdee - settings.kcalTargetOverride : -(goal * KCAL_PER_KG) / 7;
    const computed = energy.total - deficit;
    kcal = baseKcal + energy.trust * (computed - baseKcal);
    kcal = Math.min(baseKcal + MAX_DAILY_SWING, kcal);
  }
  const floor = Math.max(settings.sex === "male" ? 1500 : 1200, Math.round(bmr));
  kcal = Math.max(floor, Math.round(kcal));
  const protein = settings.proteinMode === "pctKcal" ? Math.round(kcal * (settings.proteinPctKcal ?? 0.3) / 4) : Math.round(settings.proteinGPerKg * kg);
  const fat = Math.round(kcal * settings.fatPctKcal / 9);
  const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
  return { kcal, protein, carbs, fat, basis, tdee: Math.round(tdee), baseKcal, energy, goalKgPerWeek: goal };
}
function rulesAsOf(settings, weighIns, entries, workouts, date) {
  const known = weighIns.filter((w) => w.date <= date);
  const trend = weightTrend(known, settings.trendHalfLifeDays);
  if (!trend.length) return null;
  const kg = trend[trend.length - 1].trend;
  const adaptive = adaptiveTDEE(
    entries.filter((e) => e.date <= date),
    trend
  );
  const usual = usualActivity(workouts, date);
  return {
    goalKgPerWeek: goalPerWeek(settings, kg),
    maintenance: adaptive && adaptive.confidence !== "low" ? adaptive.kcal : null,
    usualMean: usual?.mean ?? 0,
    usualTrust: usual?.trust ?? 0,
    usualLogged: usual?.logged ?? 0,
    usualDays: usual?.days ?? 14,
    meanIntake: adaptive?.meanIntake ?? null,
    kg
  };
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
  const settings = data.settings[0];
  const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  for (const row of (data.dayTargets ?? []).slice().sort((a, b) => a.date.localeCompare(b.date))) {
    if (row.date < "2026-09-12" || row.date >= today) continue;
    const rules = rulesAsOf(settings, data.weighIns, data.entries, data.workouts, row.date);
    if (!rules) continue;
    const price = (r) => {
      const eaten = data.entries.filter((e2) => e2.date === row.date).reduce((a, e2) => a + e2.kcal, 0);
      const act = data.workouts.filter((w) => w.date === row.date).reduce((a, w) => a + (w.kcal ?? 0), 0);
      const e = dayEnergy(
        { ...settings, goalPctPerWeek: void 0, goalKgPerWeek: r.goalKgPerWeek },
        r.kg,
        eaten,
        act,
        r.maintenance,
        { mean: r.usualMean, trust: r.usualTrust, logged: r.usualLogged, days: r.usualDays },
        r.meanIntake
      );
      const t = computeTargets(
        { ...settings, goalPctPerWeek: void 0, goalKgPerWeek: r.goalKgPerWeek },
        r.kg,
        r.maintenance != null ? { kcal: r.maintenance, days: 28, windowDays: 29, loggedDays: 28, meanIntake: r.meanIntake ?? 0, trendChangeKg: 0, confidence: "high" } : null,
        e
      );
      return Math.round(t.kcal - eaten);
    };
    const before = price(row);
    const after = price(rules);
    if (Math.abs(before - after) < 1 && Math.abs((row.maintenance ?? 0) - (rules.maintenance ?? 0)) < 1) continue;
    notes.push(`${row.date}: left ${before >= 0 ? "+" : ""}${before} -> ${after >= 0 ? "+" : ""}${after}   (maint ${row.maintenance} -> ${rules.maintenance}, kg ${row.kg.toFixed(2)} -> ${rules.kg.toFixed(2)})`);
    Object.assign(row, rules);
    touch(row);
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
