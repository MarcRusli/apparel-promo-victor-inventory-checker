import type { VercelRequest, VercelResponse } from "@vercel/node";
import { applyCors } from "./_lib/cors.js";
import { filterItemsBySizes, getSheetItems } from "./_lib/sheet.js";
import { normalizeSizeKey, type Size } from "./_lib/sizes.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (applyCors(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

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

    res.status(200).json({
      fetchedAt,
      items: matched.map((it) => ({ category: it.category, model: it.model }))
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    res.status(500).json({ error: message });
  }
}
