import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyCors } from "./_lib/cors.js";
import { getSheetItems } from "./_lib/sheet.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;
  try {
    const { items, fetchedAt } = await getSheetItems();
    res.status(200).json({
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
}
