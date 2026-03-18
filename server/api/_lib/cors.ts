import type { VercelRequest, VercelResponse } from "@vercel/node";

function pickAllowedOrigin(reqOrigin: string | undefined, allowSetting: string): string | null {
  const allow = allowSetting.trim();

  // Default to permissive CORS so split client/server Vercel deployments work
  // without extra config. Set ALLOW_ORIGIN to lock this down.
  if (!allow || allow === "*") return "*";

  const list = allow
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!reqOrigin) return null;
  return list.includes(reqOrigin) ? reqOrigin : null;
}

export function applyCors(req: VercelRequest, res: VercelResponse) {
  const allowedOrigin = pickAllowedOrigin(req.headers.origin, process.env.ALLOW_ORIGIN || "");
  if (allowedOrigin) res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  if (allowedOrigin && allowedOrigin !== "*") res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return true;
  }

  return false;
}
