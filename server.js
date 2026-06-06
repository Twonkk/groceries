const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, "data");
const DATA_FILE = path.join(DATA_DIR, "items.json");
const PORT = Number(process.env.PORT || 4827);
const PUBLIC_URL = cleanUrl(process.env.PUBLIC_URL || "");
const ALERT_TIME_ZONE = process.env.ALERT_TIME_ZONE || process.env.TZ || "America/Chicago";
const ALERT_DAILY_TIME = process.env.ALERT_DAILY_TIME || "15:00";
const ALERT_DAILY_ENABLED = parseBool(process.env.ALERT_DAILY_ENABLED, false);
const ALERT_ON_ADD = parseBool(process.env.ALERT_ON_ADD, Boolean(process.env.DISCORD_WEBHOOK_URL));
const DISCORD_WEBHOOK_URL = String(process.env.DISCORD_WEBHOOK_URL || "").trim();
const RESEND_API_KEY = String(process.env.RESEND_API_KEY || "").trim();
const ALERT_EMAIL_TO = String(process.env.ALERT_EMAIL_TO || "").trim();
const ALERT_EMAIL_FROM = String(process.env.ALERT_EMAIL_FROM || "").trim();
const ALERT_EMAIL_SUBJECT = cleanText(process.env.ALERT_EMAIL_SUBJECT || "Grocery list digest", 120);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".ico": "image/x-icon",
};

async function ensureDataFile() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(DATA_FILE);
  } catch {
    await fs.writeFile(DATA_FILE, JSON.stringify({ items: [] }, null, 2));
  }
}

async function readStore() {
  await ensureDataFile();
  const raw = await fs.readFile(DATA_FILE, "utf-8");
  try {
    const parsed = JSON.parse(raw);
    return { items: Array.isArray(parsed.items) ? parsed.items : [] };
  } catch {
    return { items: [] };
  }
}

async function writeStore(store) {
  await ensureDataFile();
  const tmp = `${DATA_FILE}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(store, null, 2));
  await fs.rename(tmp, DATA_FILE);
}

function send(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(body);
}

function sendJson(res, status, data) {
  send(res, status, JSON.stringify(data), "application/json; charset=utf-8");
}

function cleanText(value, max = 120) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, max);
}

function parseBool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function cleanUrl(value) {
  const url = String(value || "").trim();
  if (!url) return "";
  return url.endsWith("/") ? url : `${url}/`;
}

function htmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function requestOrigin(req) {
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  if (!host) return "";
  const proto = req.headers["x-forwarded-proto"] || "http";
  return cleanUrl(`${proto}://${host}`);
}

function localUrls(req) {
  const urls = [];
  const requestedUrl = req ? requestOrigin(req) : "";

  if (PUBLIC_URL) urls.push(PUBLIC_URL);
  if (requestedUrl) urls.push(requestedUrl);

  const nets = os.networkInterfaces();

  for (const entries of Object.values(nets)) {
    for (const entry of entries || []) {
      if (entry.family === "IPv4" && !entry.internal) {
        urls.push(`http://${entry.address}:${PORT}/`);
      }
    }
  }

  urls.push(`http://localhost:${PORT}/`);
  return [...new Set(urls)];
}

async function parseBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
    if (Buffer.concat(chunks).length > 128 * 1024) {
      throw new Error("Request body too large");
    }
  }

  const body = Buffer.concat(chunks).toString("utf-8");
  return body ? JSON.parse(body) : {};
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/meta") {
    return sendJson(res, 200, { urls: localUrls(req), port: PORT });
  }

  if (req.method === "GET" && url.pathname === "/api/health") {
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === "GET" && url.pathname === "/api/items") {
    const store = await readStore();
    return sendJson(res, 200, store);
  }

  if (req.method === "POST" && url.pathname === "/api/items") {
    const body = await parseBody(req);
    const text = cleanText(body.text);
    const addedBy = cleanText(body.addedBy, 40);
    if (!text) return sendJson(res, 400, { error: "Item name is required." });
    if (!addedBy) return sendJson(res, 400, { error: "Requested by is required." });

    const store = await readStore();
    const now = new Date().toISOString();
    const item = {
      id: crypto.randomUUID(),
      text,
      quantity: cleanText(body.quantity, 32),
      category: cleanText(body.category, 40) || "Groceries",
      addedBy,
      note: cleanText(body.note, 160),
      urgent: Boolean(body.urgent),
      status: "needed",
      createdAt: now,
      updatedAt: now,
    };

    store.items.unshift(item);
    await writeStore(store);
    sendItemAddedAlert(item).catch((error) => console.warn(`Alert failed: ${error.message}`));
    return sendJson(res, 201, item);
  }

  if (req.method === "PATCH" && url.pathname.startsWith("/api/items/")) {
    const id = url.pathname.split("/").pop();
    const body = await parseBody(req);
    const store = await readStore();
    const item = store.items.find((entry) => entry.id === id);
    if (!item) return sendJson(res, 404, { error: "Item not found." });

    if (body.text !== undefined) item.text = cleanText(body.text);
    if (body.quantity !== undefined) item.quantity = cleanText(body.quantity, 32);
    if (body.category !== undefined) item.category = cleanText(body.category, 40) || "Groceries";
    if (body.addedBy !== undefined) {
      const addedBy = cleanText(body.addedBy, 40);
      if (!addedBy) return sendJson(res, 400, { error: "Requested by is required." });
      item.addedBy = addedBy;
    }
    if (body.note !== undefined) item.note = cleanText(body.note, 160);
    if (body.urgent !== undefined) item.urgent = Boolean(body.urgent);
    if (body.status === "needed" || body.status === "picked") item.status = body.status;
    item.updatedAt = new Date().toISOString();

    await writeStore(store);
    return sendJson(res, 200, item);
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/items/")) {
    const id = url.pathname.split("/").pop();
    const store = await readStore();
    const next = store.items.filter((entry) => entry.id !== id);
    if (next.length === store.items.length) return sendJson(res, 404, { error: "Item not found." });
    store.items = next;
    await writeStore(store);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === "POST" && url.pathname === "/api/clear-picked") {
    const store = await readStore();
    store.items = store.items.filter((entry) => entry.status !== "picked");
    await writeStore(store);
    return sendJson(res, 200, store);
  }

  return sendJson(res, 404, { error: "Not found." });
}

function configuredAlertTargets() {
  return {
    discord: Boolean(DISCORD_WEBHOOK_URL),
    email: Boolean(RESEND_API_KEY && ALERT_EMAIL_TO && ALERT_EMAIL_FROM),
  };
}

function itemSummary(item) {
  const parts = [item.text];
  if (item.quantity) parts.push(`qty: ${item.quantity}`);
  if (item.category) parts.push(item.category);
  if (item.urgent) parts.push("need soon");
  return parts.join(" | ");
}

async function sendItemAddedAlert(item) {
  if (!ALERT_ON_ADD) return;
  const targets = configuredAlertTargets();
  if (!targets.discord && !targets.email) return;

  const subject = `New grocery item: ${item.text}`;
  const text = [
    `${item.addedBy} requested: ${itemSummary(item)}`,
    PUBLIC_URL ? `List: ${PUBLIC_URL}` : "",
  ].filter(Boolean).join("\n");

  await sendAlerts({ subject, text });
}

async function sendDailyDigest() {
  const targets = configuredAlertTargets();
  if (!targets.discord && !targets.email) return;

  const store = await readStore();
  const needed = store.items
    .filter((item) => item.status === "needed")
    .sort((a, b) => {
      if (a.urgent !== b.urgent) return a.urgent ? -1 : 1;
      return new Date(a.createdAt) - new Date(b.createdAt);
    });

  const lines = needed.length
    ? needed.map((item, index) => `${index + 1}. ${itemSummary(item)} - requested by ${item.addedBy}`)
    : ["No items currently needed."];

  const subject = `${ALERT_EMAIL_SUBJECT} (${needed.length} needed)`;
  const text = [
    `Grocery list digest - ${needed.length} needed`,
    "",
    ...lines,
    "",
    PUBLIC_URL ? `List: ${PUBLIC_URL}` : "",
  ].filter((line, index, array) => line || array[index - 1]).join("\n");

  await sendAlerts({ subject, text });
}

async function sendAlerts({ subject, text }) {
  const targets = configuredAlertTargets();
  const jobs = [];

  if (targets.discord) jobs.push(sendDiscordAlert(text));
  if (targets.email) jobs.push(sendResendEmail(subject, text));
  if (!jobs.length) return;

  const results = await Promise.allSettled(jobs);
  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length) {
    throw new Error(failures.map((failure) => failure.reason.message).join("; "));
  }
}

async function sendDiscordAlert(text) {
  const content = text.length > 1900 ? `${text.slice(0, 1897)}...` : text;
  const response = await fetch(DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });

  if (!response.ok) {
    throw new Error(`Discord returned ${response.status}`);
  }
}

async function sendResendEmail(subject, text) {
  const html = `<pre style="font-family: Arial, sans-serif; white-space: pre-wrap;">${htmlEscape(text)}</pre>`;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: ALERT_EMAIL_FROM,
      to: ALERT_EMAIL_TO.split(",").map((value) => value.trim()).filter(Boolean),
      subject,
      text,
      html,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Resend returned ${response.status}${body ? `: ${body.slice(0, 200)}` : ""}`);
  }
}

function parseDailyTime(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || ""));
  if (!match) return { hour: 15, minute: 0 };

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return { hour: 15, minute: 0 };
  return { hour, minute };
}

function zonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour === "24" ? "0" : values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };
}

function zonedDateToUtcMs({ year, month, day, hour, minute, second = 0 }, timeZone) {
  let guess = Date.UTC(year, month - 1, day, hour, minute, second);

  for (let index = 0; index < 3; index += 1) {
    const parts = zonedParts(new Date(guess), timeZone);
    const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    const wanted = Date.UTC(year, month - 1, day, hour, minute, second);
    guess -= asUtc - wanted;
  }

  return guess;
}

function nextDailyDigestDate() {
  const now = new Date();
  const nowParts = zonedParts(now, ALERT_TIME_ZONE);
  const { hour, minute } = parseDailyTime(ALERT_DAILY_TIME);
  let targetMs = zonedDateToUtcMs({ ...nowParts, hour, minute, second: 0 }, ALERT_TIME_ZONE);

  if (targetMs <= now.getTime() + 1000) {
    const nextDay = new Date(Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day + 1));
    targetMs = zonedDateToUtcMs({
      year: nextDay.getUTCFullYear(),
      month: nextDay.getUTCMonth() + 1,
      day: nextDay.getUTCDate(),
      hour,
      minute,
      second: 0,
    }, ALERT_TIME_ZONE);
  }

  return new Date(targetMs);
}

function scheduleDailyDigest() {
  if (!ALERT_DAILY_ENABLED) return;
  const nextRun = nextDailyDigestDate();
  const delay = Math.max(1000, nextRun.getTime() - Date.now());

  console.log(`Daily alert scheduled for ${nextRun.toISOString()} (${ALERT_TIME_ZONE})`);
  setTimeout(async () => {
    try {
      await sendDailyDigest();
    } catch (error) {
      console.warn(`Daily alert failed: ${error.message}`);
    } finally {
      scheduleDailyDigest();
    }
  }, delay);
}

async function serveStatic(req, res, url) {
  let requested = decodeURIComponent(url.pathname);
  if (requested === "/" || requested === "") requested = "/index.html";

  const safePath = path.normalize(requested).replace(/^(\.\.[/\\])+/, "");
  let filePath = path.join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    return send(res, 403, "Forbidden");
  }

  try {
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) filePath = path.join(filePath, "index.html");
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    return res.end(data);
  } catch {
    const index = await fs.readFile(path.join(PUBLIC_DIR, "index.html"));
    res.writeHead(200, { "Content-Type": MIME_TYPES[".html"], "Cache-Control": "no-store" });
    return res.end(index);
  }
}

async function main() {
  await ensureDataFile();

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
      if (url.pathname.startsWith("/api/")) {
        return await handleApi(req, res, url);
      }
      return await serveStatic(req, res, url);
    } catch (error) {
      return sendJson(res, 500, { error: error.message || "Server error." });
    }
  });

  server.listen(PORT, "0.0.0.0", () => {
    console.log("Grocery Helper is running.");
    console.log(`Data: ${DATA_FILE}`);
    console.log(`Alerts: add=${ALERT_ON_ADD ? "on" : "off"}, daily=${ALERT_DAILY_ENABLED ? "on" : "off"}`);
    for (const url of localUrls()) console.log(`Open: ${url}`);
    scheduleDailyDigest();
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
