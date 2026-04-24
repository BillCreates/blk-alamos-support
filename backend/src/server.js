const crypto = require("crypto");
const express = require("express");
const fs = require("fs");
const path = require("path");

class ValidationError extends Error {}

function parseEnvValue(rawValue) {
  const value = rawValue.trim();

  if (!value) {
    return "";
  }

  const quote = value[0];
  if ((quote === '"' || quote === "'") && value.endsWith(quote)) {
    return value
      .slice(1, -1)
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t");
  }

  return value;
}

function loadEnvFile(filePath) {
  if (!filePath) {
    return;
  }

  if (!fs.existsSync(filePath)) {
    console.error("ENV_FILE wurde gesetzt, aber die Datei existiert nicht:", filePath);
    process.exit(1);
  }

  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const normalizedLine = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
    const separatorIndex = normalizedLine.indexOf("=");

    if (separatorIndex <= 0) {
      continue;
    }

    const key = normalizedLine.slice(0, separatorIndex).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }

    const rawValue = normalizedLine.slice(separatorIndex + 1);
    process.env[key] = parseEnvValue(rawValue);
  }
}

loadEnvFile(process.env.ENV_FILE);

function toInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toBool(value, fallback) {
  if (value === undefined) {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function splitList(value, fallback) {
  if (!value) {
    return fallback;
  }

  return String(value)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeGateAnswer(value) {
  return String(value).trim().toLowerCase().replace(/\s+/g, " ");
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

const config = {
  port: toInt(process.env.PORT, 8080),
  trustProxy: toBool(process.env.TRUST_PROXY, true),
  allowDirectPostAccess: toBool(process.env.ALLOW_DIRECT_POST_ACCESS, false),
  allowedOrigins: splitList(process.env.ALLOWED_ORIGINS, []),
  proxySharedSecret: process.env.PROXY_SHARED_SECRET || "",
  n8nWebhookUrl: process.env.N8N_WEBHOOK_URL || "",
  n8nWebhookSecret: process.env.N8N_WEBHOOK_SECRET || "",
  gateQuestion: process.env.GATE_QUESTION || "Was bedeutet die Abkuerzung ELW?",
  gateLabel: process.env.GATE_LABEL || "Antwort",
  gatePlaceholder: process.env.GATE_PLACEHOLDER || "Antwort eingeben",
  gateExpectedAnswer: process.env.GATE_EXPECTED_ANSWER || "",
  gateAnswerHash: process.env.GATE_ANSWER_HASH || process.env.ELW_ANSWER_HASH || "",
  sessionTtlMs: toInt(process.env.SESSION_TTL_MS, 4 * 60 * 60 * 1000),
  allowedDistricts: [
    "LB1 (Mitte)",
    "LB3 (Aßweiler)",
    "LB4 (Ballweiler)",
    "LB5 (Bierbach)",
    "LB6 (Biesingen)",
    "LB7 (Blickweiler)",
    "LB8 (Böckweiler)",
    "LB9 (Breitfurt)",
    "LB10 (Brenschelbach)",
    "LB11 (Mimbach)",
    "LB12 (Pinningen)",
    "LB13 (Niederwürzbach)",
    "LB14 (Webenheim)",
    "LB15 (Wolfersheim)"
  ],
  allowedCategories: [
    "Login",
    "Alarmgruppen",
    "Alarmierung",
    "aPager",
    "Sonstiges"
  ],
  rateLimitWindowMs: toInt(process.env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
  rateLimitMaxRequests: toInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10),
  rateLimitGateWindowMs: toInt(process.env.RATE_LIMIT_GATE_WINDOW_MS, 10 * 60 * 1000),
  rateLimitGateMaxRequests: toInt(process.env.RATE_LIMIT_GATE_MAX_REQUESTS, 10),
  jsonLimit: process.env.JSON_LIMIT || "20kb",
  monitoringTimezone: "Europe/Berlin"
};

const requiredEnvNames = [];

const gateAnswerHash = config.gateExpectedAnswer
  ? sha256Hex(normalizeGateAnswer(config.gateExpectedAnswer))
  : config.gateAnswerHash;

if (!config.n8nWebhookUrl) {
  requiredEnvNames.push("N8N_WEBHOOK_URL");
}

if (!gateAnswerHash) {
  requiredEnvNames.push("GATE_EXPECTED_ANSWER oder GATE_ANSWER_HASH");
}

if (!config.proxySharedSecret && !config.allowDirectPostAccess) {
  requiredEnvNames.push("PROXY_SHARED_SECRET oder ALLOW_DIRECT_POST_ACCESS=1");
}

const missingEnv = requiredEnvNames;
if (missingEnv.length > 0) {
  console.error("Fehlende Umgebungsvariablen:", missingEnv.join(", "));
  process.exit(1);
}

// In-Memory Session-Store: token -> { createdAt }
const sessionStore = new Map();

const app = express();
const rateLimitStore = new Map();
const rateLimitGateStore = new Map();
const startedAt = new Date();

const monitoringState = {
  lastN8nSuccessAt: null,
  lastN8nFailureAt: null,
  lastN8nFailureReason: "",
  today: null,
  counters: null
};

if (config.trustProxy) {
  app.set("trust proxy", true);
}

app.use(express.json({ limit: config.jsonLimit }));
app.use(express.static(path.join(__dirname, "..", "public"), { index: false }));

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
  );
  next();
});

app.use((req, res, next) => {
  const origin = req.get("origin");

  if (origin && config.allowedOrigins.length > 0) {
    if (!config.allowedOrigins.includes(origin)) {
      return res.status(403).json({ ok: false, error: "origin_not_allowed" });
    }

    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Session-Token");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  }

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  next();
});

app.use((req, res, next) => {
  const isProtectedPost =
    req.method === "POST" &&
    (req.path === "/api/problem-report" || req.path === "/api/gate");

  if (!isProtectedPost) {
    return next();
  }

  if (!config.proxySharedSecret) {
    if (config.allowDirectPostAccess) {
      return next();
    }

    return res.status(503).json({ ok: false, error: "proxy_secret_required" });
  }

  const headerValue = req.get("x-proxy-shared-secret");
  if (headerValue !== config.proxySharedSecret) {
    return res.status(403).json({ ok: false, error: "proxy_secret_invalid" });
  }

  next();
});

function normalizeRemoteAddress(value) {
  if (!value) {
    return "";
  }

  if (value.startsWith("::ffff:")) {
    return value.slice(7);
  }

  return value;
}

function isInternalRequest(req) {
  const ip = normalizeRemoteAddress(req.ip || req.socket.remoteAddress || "");

  if (!ip) {
    return false;
  }

  if (ip === "::1" || ip === "127.0.0.1" || ip === "localhost") {
    return true;
  }

  if (ip.startsWith("10.") || ip.startsWith("192.168.")) {
    return true;
  }

  const ipv4Parts = ip.split(".");
  if (ipv4Parts.length === 4) {
    const first = Number.parseInt(ipv4Parts[0], 10);
    const second = Number.parseInt(ipv4Parts[1], 10);
    if (first === 172 && second >= 16 && second <= 31) {
      return true;
    }
  }

  if (ip.startsWith("fc") || ip.startsWith("fd")) {
    return true;
  }

  return false;
}

function checkRateLimit(store, windowMs, maxRequests, ip) {
  const now = Date.now();
  const entry = store.get(ip);

  if (!entry || now - entry.startedAt >= windowMs) {
    store.set(ip, { startedAt: now, count: 1 });
    return true;
  }

  entry.count += 1;
  return entry.count <= maxRequests;
}

function getTodayKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: config.monitoringTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function createEmptyDailyCounters() {
  return {
    gateSuccess: 0,
    gateFailure: 0,
    reportSuccess: 0,
    reportFailure: 0,
    reportValidationFailure: 0,
    reportWebhookFailure: 0
  };
}

function ensureDailyCounters() {
  const today = getTodayKey();
  if (monitoringState.today !== today || !monitoringState.counters) {
    monitoringState.today = today;
    monitoringState.counters = createEmptyDailyCounters();
  }

  return monitoringState.counters;
}

function incrementCounter(counterName) {
  const counters = ensureDailyCounters();
  if (Object.hasOwn(counters, counterName)) {
    counters[counterName] += 1;
  }
}

function markN8nSuccess() {
  monitoringState.lastN8nSuccessAt = new Date().toISOString();
  monitoringState.lastN8nFailureAt = null;
  monitoringState.lastN8nFailureReason = "";
}

function markN8nFailure(reason) {
  monitoringState.lastN8nFailureAt = new Date().toISOString();
  monitoringState.lastN8nFailureReason = String(reason || "unknown_n8n_failure");
}

function buildHealthSnapshot() {
  const counters = ensureDailyCounters();
  const uptimeSeconds = Math.floor(process.uptime());
  const reasons = [];
  const services = {
    backend: {
      ok: true
    },
    n8nWebhook: {
      ok: !monitoringState.lastN8nFailureAt,
      lastSuccessAt: monitoringState.lastN8nSuccessAt,
      lastFailureAt: monitoringState.lastN8nFailureAt,
      lastFailureReason: monitoringState.lastN8nFailureReason || null
    }
  };

  if (!services.n8nWebhook.ok) {
    reasons.push("n8n_webhook_unavailable");
  }

  return {
    ok: reasons.length === 0,
    status: reasons.length === 0 ? "ok" : "degraded",
    reasons,
    service: {
      name: "problem-report-backend",
      startedAt: startedAt.toISOString(),
      uptimeSeconds
    },
    services,
    metrics: {
      timezone: config.monitoringTimezone,
      date: monitoringState.today,
      runtime: {
        seconds: uptimeSeconds,
        startedAt: startedAt.toISOString()
      },
      today: {
        gate: {
          success: counters.gateSuccess,
          failure: counters.gateFailure
        },
        reports: {
          success: counters.reportSuccess,
          failure: counters.reportFailure,
          validationFailure: counters.reportValidationFailure,
          webhookFailure: counters.reportWebhookFailure
        }
      }
    }
  };
}

app.use((req, res, next) => {
  if (req.method !== "POST" || req.path !== "/api/problem-report") {
    return next();
  }

  const ip = req.ip || req.socket.remoteAddress || "unknown";

  if (!checkRateLimit(rateLimitStore, config.rateLimitWindowMs, config.rateLimitMaxRequests, ip)) {
    return res.status(429).json({ ok: false, error: "rate_limited" });
  }

  next();
});

app.use((req, res, next) => {
  if (req.method !== "POST" || req.path !== "/api/gate") {
    return next();
  }

  const ip = req.ip || req.socket.remoteAddress || "unknown";

  if (!checkRateLimit(rateLimitGateStore, config.rateLimitGateWindowMs, config.rateLimitGateMaxRequests, ip)) {
    return res.status(429).json({ ok: false, error: "rate_limited" });
  }

  next();
});

function requireString(value, fieldName, maxLength) {
  if (typeof value !== "string") {
    throw new ValidationError(fieldName + "_invalid");
  }

  const normalized = value.trim();
  if (!normalized) {
    throw new ValidationError(fieldName + "_required");
  }

  if (normalized.length > maxLength) {
    throw new ValidationError(fieldName + "_too_long");
  }

  return normalized;
}

function requireEmail(value, fieldName, maxLength) {
  const normalized = requireString(value, fieldName, maxLength);
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!emailPattern.test(normalized)) {
    throw new ValidationError(fieldName + "_invalid");
  }

  return normalized;
}

// ---------------------------------------------------------------------------
// Session-Hilfsfunktionen
// ---------------------------------------------------------------------------

function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

function isValidToken(token) {
  if (typeof token !== "string" || !token) return false;
  const entry = sessionStore.get(token);
  if (!entry) return false;
  if (Date.now() - entry.createdAt > config.sessionTtlMs) {
    sessionStore.delete(token);
    return false;
  }
  return true;
}

function cleanupSessions() {
  const now = Date.now();
  for (const [token, entry] of sessionStore.entries()) {
    if (now - entry.createdAt > config.sessionTtlMs) {
      sessionStore.delete(token);
    }
  }
}

// ---------------------------------------------------------------------------
// Validierung
// ---------------------------------------------------------------------------

function normalizeReport(payload) {
  const body = payload && typeof payload === "object" ? payload : {};
  const report = body.report && typeof body.report === "object" ? body.report : {};
  const meta = body.meta && typeof body.meta === "object" ? body.meta : {};

  if (typeof report.company === "string" && report.company.trim() !== "") {
    throw new ValidationError("honeypot_triggered");
  }

  const name = requireString(report.name, "name", 120);
  const contactEmail = requireEmail(report.contactEmail, "contact_email", 160);
  const district = requireString(report.district, "district", 120);
  const category = requireString(report.category, "category", 120);
  const message = requireString(report.message, "message", 5000);
  const categoryOther = typeof report.categoryOther === "string" ? report.categoryOther.trim() : "";

  if (!config.allowedDistricts.includes(district)) {
    throw new ValidationError("district_not_allowed");
  }

  if (!config.allowedCategories.includes(category)) {
    throw new ValidationError("category_not_allowed");
  }

  if (category === "Sonstiges") {
    if (!categoryOther) {
      throw new ValidationError("category_other_required");
    }

    if (categoryOther.length > 120) {
      throw new ValidationError("category_other_too_long");
    }
  }

  if (category !== "Sonstiges" && categoryOther) {
    throw new ValidationError("category_other_not_expected");
  }

  return {
    report: {
      name,
      contactEmail,
      district,
      category,
      categoryOther,
      message
    },
    meta: {
      submittedAtClient: typeof meta.submittedAtClient === "string" ? meta.submittedAtClient : "",
      pageUrl: typeof meta.pageUrl === "string" ? meta.pageUrl : "",
      userAgent: typeof meta.userAgent === "string" ? meta.userAgent : ""
    }
  };
}

function buildN8nPayload(reportEnvelope) {
  const requestId = crypto.randomUUID();
  const submittedAtUtc = new Date().toISOString();
  const { report, meta } = reportEnvelope;
  const resolvedCategory = report.category === "Sonstiges"
    ? "Sonstiges: " + report.categoryOther
    : report.category;

  return {
    requestId,
    submittedAtUtc,
    name: report.name,
    contactEmail: report.contactEmail,
    district: report.district,
    category: report.category,
    categoryOther: report.categoryOther || "",
    categoryResolved: resolvedCategory,
    message: report.message,
    meta: {
      pageUrl: meta.pageUrl || "",
      submittedAtClient: meta.submittedAtClient || "",
      userAgent: meta.userAgent || ""
    }
  };
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

app.get("/health", (req, res) => {
  if (!isInternalRequest(req)) {
    return res.status(403).json({ ok: false, error: "health_not_public" });
  }

  const snapshot = buildHealthSnapshot();
  res.status(snapshot.ok ? 200 : 503).json(snapshot);
});

app.get("/api/gate-config", (req, res) => {
  res.json({
    ok: true,
    question: config.gateQuestion,
    label: config.gateLabel,
    placeholder: config.gatePlaceholder,
    sessionTtlMs: config.sessionTtlMs
  });
});

// ---------------------------------------------------------------------------
// POST /api/gate  – ELW-Antwort prüfen, Session-Token ausstellen
// ---------------------------------------------------------------------------
app.post("/api/gate", (req, res) => {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const answer = typeof body.answer === "string" ? body.answer.trim() : "";

  if (!answer) {
    incrementCounter("gateFailure");
    return res.status(400).json({ ok: false, error: "answer_required" });
  }

  // Normalisieren: Kleinbuchstaben, mehrfache Leerzeichen zusammenfassen
  const normalized = normalizeGateAnswer(answer);
  const hash = sha256Hex(normalized);

  if (hash !== gateAnswerHash) {
    incrementCounter("gateFailure");
    console.warn("[gate] wrong answer", {
      ip: normalizeRemoteAddress(req.ip || req.socket.remoteAddress || "unknown")
    });
    return res.status(403).json({ ok: false, error: "answer_wrong" });
  }

  const token = generateToken();
  sessionStore.set(token, { createdAt: Date.now() });
  incrementCounter("gateSuccess");

  res.json({ ok: true, token });
});

// ---------------------------------------------------------------------------
// POST /api/problem-report  – Meldung an n8n weiterleiten
// ---------------------------------------------------------------------------
app.post("/api/problem-report", async (req, res) => {
  try {
    // Session-Token prüfen
    const authHeader = req.get("x-session-token") || "";
    if (!isValidToken(authHeader)) {
      incrementCounter("reportFailure");
      return res.status(401).json({ ok: false, error: "session_invalid" });
    }

    const normalized = normalizeReport(req.body);
    const n8nPayload = buildN8nPayload(normalized);

    const fetchHeaders = {
      "Content-Type": "application/json"
    };

    if (config.n8nWebhookSecret) {
      fetchHeaders["X-N8N-Webhook-Secret"] = config.n8nWebhookSecret;
    }

    const n8nResponse = await fetch(config.n8nWebhookUrl, {
      method: "POST",
      headers: fetchHeaders,
      body: JSON.stringify(n8nPayload),
      signal: AbortSignal.timeout(10000)
    });

    if (!n8nResponse.ok) {
      const responseText = await n8nResponse.text().catch(() => "");
      incrementCounter("reportFailure");
      incrementCounter("reportWebhookFailure");
      markN8nFailure("http_" + n8nResponse.status);
      console.error("n8n Webhook Fehler:", n8nResponse.status, responseText);
      return res.status(502).json({ ok: false, error: "webhook_delivery_failed" });
    }

    incrementCounter("reportSuccess");
    markN8nSuccess();

    res.status(202).json({
      ok: true,
      requestId: n8nPayload.requestId,
      submittedAtUtc: n8nPayload.submittedAtUtc
    });
  } catch (error) {
    if (error instanceof ValidationError) {
      incrementCounter("reportFailure");
      incrementCounter("reportValidationFailure");
      return res.status(400).json({ ok: false, error: error.message });
    }

    incrementCounter("reportFailure");
    incrementCounter("reportWebhookFailure");
    markN8nFailure(error && error.name ? error.name : "webhook_delivery_failed");
    console.error("Webhook-Weiterleitung fehlgeschlagen:", error);
    res.status(502).json({ ok: false, error: "webhook_delivery_failed" });
  }
});

app.use((error, req, res, next) => {
  if (error instanceof SyntaxError && "body" in error) {
    return res.status(400).json({ ok: false, error: "invalid_json" });
  }

  console.error("Unerwarteter Fehler:", error);
  res.status(500).json({ ok: false, error: "internal_server_error" });
});

const cleanupTimer = setInterval(() => {
  const now = Date.now();

  for (const [ip, entry] of rateLimitStore.entries()) {
    if (now - entry.startedAt >= config.rateLimitWindowMs) {
      rateLimitStore.delete(ip);
    }
  }

  for (const [ip, entry] of rateLimitGateStore.entries()) {
    if (now - entry.startedAt >= config.rateLimitGateWindowMs) {
      rateLimitGateStore.delete(ip);
    }
  }

  cleanupSessions();
}, Math.max(config.rateLimitWindowMs, 60 * 1000));

cleanupTimer.unref();

async function start() {
  app.listen(config.port, () => {
    console.log("Backend lauscht auf Port " + config.port);
    console.log("n8n Webhook-Ziel:", config.n8nWebhookUrl);
  });
}

start().catch((error) => {
  console.error("Backend konnte nicht gestartet werden:", error);
  process.exit(1);
});
