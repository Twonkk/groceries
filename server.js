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

function cleanUrl(value) {
  const url = String(value || "").trim();
  if (!url) return "";
  return url.endsWith("/") ? url : `${url}/`;
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
    for (const url of localUrls()) console.log(`Open: ${url}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
