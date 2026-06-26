'use strict';
const express = require('express');
const fetch = require('node-fetch');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 8000;

// ─── Security ─────────────────────────────────────────
const PROXY_SECRET = process.env.PROXY_SECRET || "";

// Rate limiter: max 120 requests per minute
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: { error: "Too many requests" }
});
app.use(limiter);

// Auth middleware (optional but recommended)
app.use((req, res, next) => {
  if (!PROXY_SECRET) return next(); // skip if no secret set
  const token = req.headers["x-proxy-secret"] || req.query._secret;
  if (token !== PROXY_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
});

// ─── Binance Endpoints ────────────────────────────────
const BINANCE_FAPI = "https://fapi.binance.com";  // Futures
const BINANCE_API  = "https://api.binance.com";   // Spot

const TIMEOUT_MS = 10000;

// ─── Helper ───────────────────────────────────────────
async function proxyRequest(targetBase, path, req, res) {
  try {
    // Forward all query params
    const queryString = new URLSearchParams(req.query).toString();
    const url = `${targetBase}${path}${queryString ? "?" + queryString : ""}`;

    console.log(`[proxy] ${req.method} ${url}`);

    // Forward headers (API key if present)
    const headers = {
      "Content-Type": "application/json",
      "User-Agent": "binance-koyeb-proxy/1.0"
    };

    if (req.headers["x-mbx-apikey"]) {
      headers["X-MBX-APIKEY"] = req.headers["x-mbx-apikey"];
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const response = await fetch(url, {
      method: req.method,
      headers,
      signal: controller.signal,
      body: req.method !== "GET" ? JSON.stringify(req.body) : undefined
    });

    clearTimeout(timeout);

    const data = await response.text();

    // Forward Binance status code
    res.status(response.status)
       .set("Content-Type", "application/json")
       .send(data);

  } catch (e) {
    console.error(`[proxy] error: ${e.message}`);
    res.status(502).json({ error: "Proxy error", detail: e.message });
  }
}

// ─── Routes ───────────────────────────────────────────

// Health check
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    ts: new Date().toISOString(),
    service: "binance-koyeb-proxy"
  });
});

// ── Futures (fapi) routes ──
app.get("/fapi/*", (req, res) => {
  const path = req.path; // e.g. /fapi/v1/klines
  proxyRequest(BINANCE_FAPI, path, req, res);
});

app.post("/fapi/*", express.json(), (req, res) => {
  const path = req.path;
  proxyRequest(BINANCE_FAPI, path, req, res);
});

// ── Futures data routes ──
app.get("/futures/*", (req, res) => {
  const path = req.path; // e.g. /futures/data/openInterestHist
  proxyRequest(BINANCE_FAPI, path, req, res);
});

// ── Spot (api) routes ──
app.get("/api/*", (req, res) => {
  const path = req.path; // e.g. /api/v3/ticker/price
  proxyRequest(BINANCE_API, path, req, res);
});

// ─── Start ────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[proxy] Binance proxy running on port ${PORT}`);
});
