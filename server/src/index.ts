import "dotenv/config";
import express from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import { SIZES, normalizeSizeKey, type Size } from "./sizes.js";
import { debugSheetFetch, filterItemsBySizes, getSheetItems } from "./sheet.js";

const app = express();

const allowOrigin = process.env.ALLOW_ORIGIN?.trim() || "http://localhost:5173";

app.use(
  cors({
    origin: allowOrigin
  })
);
app.use(express.json({ limit: "200kb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/search", async (req, res) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const requested: Partial<Record<Size, number>> = {};

    for (const [key, value] of Object.entries(body)) {
      const size = normalizeSizeKey(key);
      if (!size) continue;
      requested[size] = typeof value === "number" ? value : Number(String(value || 0));
    }

    const { items, fetchedAt } = await getSheetItems();
    const matched = filterItemsBySizes(items, requested);

    res.json({
      fetchedAt,
      items: matched.map((it) => ({ category: it.category, model: it.model }))
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

app.post("/api/refresh", async (_req, res) => {
  try {
    const { items, fetchedAt } = await getSheetItems({ force: true });
    res.json({ fetchedAt, count: items.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

app.get("/api/sizes", (_req, res) => {
  res.json({ sizes: SIZES });
});

app.get("/api/debug", async (_req, res) => {
  try {
    const { items, fetchedAt } = await getSheetItems();
    res.json({
      fetchedAt,
      count: items.length,
      sample: items.slice(0, 5),
      env: {
        hasSheetCsvUrl: Boolean(process.env.SHEET_CSV_URL && process.env.SHEET_CSV_URL.trim()),
        hasSheetUrl: Boolean(process.env.SHEET_URL && process.env.SHEET_URL.trim()),
        cacheTtlMs: Number(process.env.CACHE_TTL_MS || 300000)
      }
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

app.get("/api/debug/fetch", async (_req, res) => {
  try {
    const debug = await debugSheetFetch();
    res.json(debug);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
});

const serveClient =
  (process.env.SERVE_CLIENT || "").toLowerCase() === "true" ||
  (process.env.NODE_ENV || "").toLowerCase() === "production";
if (serveClient) {
  const clientDist = path.resolve(process.cwd(), "../client/dist");
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api/")) return next();
      res.sendFile(path.join(clientDist, "index.html"));
    });
  }
}

const port = Number(process.env.PORT || 8787);
app.listen(port, () => {
  console.log(`server listening on http://localhost:${port}`);
});
