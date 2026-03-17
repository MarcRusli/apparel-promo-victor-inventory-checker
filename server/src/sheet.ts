import { parse } from "csv-parse/sync";
import { SIZES, type Size } from "./sizes.js";

export type SheetItem = {
  category: string;
  model: string;
  sizes: Record<Size, number>;
};

type Cache = {
  fetchedAt: number;
  items: SheetItem[];
};

let cache: Cache | null = null;
let inFlight: Promise<Cache> | null = null;

export type SheetFetchDebug = {
  url: string;
  contentType: string | null;
  status: number;
  ok: boolean;
  bodyChars: number;
  bodySnippet: string;
  headerRowIndex: number;
  headerRow: string[];
  parsedRecordCount: number;
  parsedFirstRowKeys: string[];
  columnIndexes: {
    category: number;
    model: number;
    sizes: Record<string, number>;
    fallbackUsed: boolean;
  };
  mappedItemCount: number;
  mappedSample: SheetItem[];
};

function normalizeKey(raw: unknown): string {
  return String(raw ?? "")
    .replaceAll("\u00A0", " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalLowerKey(raw: unknown): string {
  return normalizeKey(raw).toLowerCase();
}

function canonicalSizeKey(raw: unknown): string {
  return normalizeKey(raw).toUpperCase().replaceAll(" ", "");
}

function parseNumber(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const text = normalizeKey(value);
  if (!text) return 0;
  const n = Number(text.replaceAll(",", ""));
  return Number.isFinite(n) ? n : 0;
}

function requireEnv(name: string): string | null {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : null;
}

function toCsvUrl(maybeSheetUrl: string): string {
  const input = maybeSheetUrl.trim();
  if (!input) throw new Error("Empty SHEET_URL/SHEET_CSV_URL");
  if (input.includes("tqx=out:csv")) return input;
  if (input.includes("export?format=csv")) return input;

  const m = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!m) throw new Error("Could not parse Google Sheet id from SHEET_URL");
  const sheetId = m[1];

  // Try to infer gid from URL (#gid=... or ?gid=...)
  const gidMatch = input.match(/[?#&]gid=(\d+)/);
  const gid = gidMatch ? gidMatch[1] : "0";

  return `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&gid=${gid}`;
}

async function fetchCsvText(): Promise<{ url: string; csv: string }> {
  const direct = requireEnv("SHEET_CSV_URL");
  const sheetUrl = requireEnv("SHEET_URL");
  const url = direct ?? (sheetUrl ? toCsvUrl(sheetUrl) : null);
  if (!url) {
    throw new Error("Missing SHEET_CSV_URL or SHEET_URL in server env");
  }
  const res = await fetch(url);
  const contentType = res.headers.get("content-type");
  const csv = await res.text();

  // A common failure mode for “anyone with link” sheets is an HTML
  // interstitial/permission page that still returns HTTP 200.
  const maybeHtml = /^\s*</.test(csv) || (contentType ? contentType.includes("text/html") : false);
  if (!res.ok || maybeHtml) {
    const hint = maybeHtml
      ? "Response looks like HTML (check sharing permissions and that the URL points to a sheet, not a sign-in page)."
      : "HTTP error fetching sheet CSV.";
    throw new Error(
      `Failed to fetch usable sheet CSV. ${hint} status=${res.status} content-type=${contentType ?? "unknown"}`
    );
  }

  return { url, csv };
}

export async function debugSheetFetch(): Promise<SheetFetchDebug> {
  const direct = requireEnv("SHEET_CSV_URL");
  const sheetUrl = requireEnv("SHEET_URL");
  const url = direct ?? (sheetUrl ? toCsvUrl(sheetUrl) : null);
  if (!url) throw new Error("Missing SHEET_CSV_URL or SHEET_URL in server env");

  const res = await fetch(url);
  const contentType = res.headers.get("content-type");
  const text = await res.text();

  let records: string[][] = [];
  let parsedFirstRowKeys: string[] = [];
  let headerRowIndex = -1;
  let headerRow: string[] = [];
  let categoryIdx = -1;
  let modelIdx = -1;
  const sizeIdxs: Partial<Record<Size, number>> = {};
  let fallbackUsed = false;
  try {
    records = parse(text, {
      columns: false,
      skip_empty_lines: true,
      relax_quotes: true,
      relax_column_count: true,
      relax_column_count_less: true,
      relax_column_count_more: true,
      skip_records_with_error: true,
      bom: true,
      trim: true
    }) as string[][];
    parsedFirstRowKeys = records[0] ?? [];

    headerRowIndex = findHeaderRowIndex(records);
    headerRow = headerRowIndex >= 0 ? records[headerRowIndex].map(normalizeKey) : [];
    if (headerRowIndex >= 0) {
      const idx = buildIndexFromHeaderRow(headerRow);
      categoryIdx = idx.categoryIdx;
      modelIdx = idx.modelIdx;
      for (const s of SIZES) sizeIdxs[s] = idx.sizeIdxs[s];
      fallbackUsed = idx.fallbackUsed;
    }
  } catch {
    // Ignore parse errors for debug output; user will see parsedRecordCount=0
  }

  const mapped: SheetItem[] = [];
  if (headerRowIndex >= 0 && categoryIdx >= 0 && modelIdx >= 0) {
    for (let i = headerRowIndex + 1; i < records.length; i++) {
      const row = records[i] ?? [];
      const category = normalizeKey(row[categoryIdx] ?? "");
      const model = normalizeKey(row[modelIdx] ?? "");
      if (!category && !model) continue;

      const sizes: Record<Size, number> = Object.fromEntries(
        SIZES.map((s) => [s, parseNumber(row[sizeIdxs[s] ?? -1])])
      ) as Record<Size, number>;
      mapped.push({ category, model, sizes });
    }
  }

  const bodySnippet = text.slice(0, 500);

  return {
    url,
    contentType,
    status: res.status,
    ok: res.ok,
    bodyChars: text.length,
    bodySnippet,
    headerRowIndex,
    headerRow,
    parsedRecordCount: records.length,
    parsedFirstRowKeys,
    columnIndexes: {
      category: categoryIdx,
      model: modelIdx,
      sizes: Object.fromEntries(SIZES.map((s) => [s, sizeIdxs[s] ?? -1])),
      fallbackUsed
    },
    mappedItemCount: mapped.length,
    mappedSample: mapped.slice(0, 5)
  };
}

export async function getSheetItems(opts?: { force?: boolean }): Promise<Cache> {
  const ttlMs = parseNumber(process.env.CACHE_TTL_MS || 300000);
  const now = Date.now();

  if (!opts?.force && cache && now - cache.fetchedAt < ttlMs) return cache;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const { csv } = await fetchCsvText();
    const rows = parse(csv, {
      columns: false,
      skip_empty_lines: true,
      relax_quotes: true,
      relax_column_count: true,
      relax_column_count_less: true,
      relax_column_count_more: true,
      skip_records_with_error: true,
      bom: true,
      trim: true
    }) as string[][];

    const items: SheetItem[] = [];

    const headerRowIndex = findHeaderRowIndex(rows);
    if (headerRowIndex < 0) {
      cache = { fetchedAt: Date.now(), items: [] };
      inFlight = null;
      return cache;
    }

    const headerRow = rows[headerRowIndex].map(normalizeKey);
    const idx = buildIndexFromHeaderRow(headerRow);
    if (idx.categoryIdx < 0 || idx.modelIdx < 0) {
      cache = { fetchedAt: Date.now(), items: [] };
      inFlight = null;
      return cache;
    }

    for (let i = headerRowIndex + 1; i < rows.length; i++) {
      const row = rows[i] ?? [];
      const category = normalizeKey(row[idx.categoryIdx] ?? "");
      const model = normalizeKey(row[idx.modelIdx] ?? "");
      if (!category && !model) continue;

      const sizes: Record<Size, number> = Object.fromEntries(
        SIZES.map((s) => [s, parseNumber(row[idx.sizeIdxs[s] ?? -1])])
      ) as Record<Size, number>;
      items.push({ category, model, sizes });
    }

    const next: Cache = { fetchedAt: Date.now(), items };
    cache = next;
    inFlight = null;
    return next;
  })().catch((err) => {
    inFlight = null;
    throw err;
  });

  return inFlight;
}

export function filterItemsBySizes(
  items: SheetItem[],
  requested: Partial<Record<Size, number>>
): SheetItem[] {
  const reqEntries = Object.entries(requested).flatMap(([k, v]) => {
    const size = k as Size;
    const n = parseNumber(v);
    if (!SIZES.includes(size)) return [];
    if (n <= 0) return [];
    return [[size, n] as const];
  });

  if (reqEntries.length === 0) return items;

  return items.filter((it) => reqEntries.every(([size, min]) => (it.sizes[size] ?? 0) >= min));
}

function findHeaderRowIndex(rows: string[][]): number {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const lowered = row.map((c) => canonicalLowerKey(c));
    if (lowered.includes("category") && lowered.includes("model")) return i;
  }
  return -1;
}

function buildIndexFromHeaderRow(headerRow: string[]): {
  categoryIdx: number;
  modelIdx: number;
  sizeIdxs: Record<Size, number>;
  fallbackUsed: boolean;
} {
  const lowerToIndex = new Map<string, number>();
  headerRow.forEach((cell, i) => {
    const k = canonicalLowerKey(cell);
    if (k && !lowerToIndex.has(k)) lowerToIndex.set(k, i);
  });

  const categoryIdx = lowerToIndex.get("category") ?? -1;
  const modelIdx = lowerToIndex.get("model") ?? -1;

  const sizeIdxs = Object.fromEntries(SIZES.map((s) => [s, -1])) as Record<Size, number>;
  for (let i = 0; i < headerRow.length; i++) {
    const k = canonicalSizeKey(headerRow[i]);
    if ((SIZES as readonly string[]).includes(k)) sizeIdxs[k as Size] = i;
  }

  let fallbackUsed = false;
  const missing = SIZES.filter((s) => sizeIdxs[s] < 0).length;
  if (missing > 0) {
    const idx155 = headerRow.findIndex((c) => canonicalLowerKey(c) === "155");
    if (idx155 >= 0) {
      fallbackUsed = true;
      const base = idx155 + 1;
      for (let i = 0; i < SIZES.length; i++) {
        sizeIdxs[SIZES[i]] = base + i;
      }
    }
  }

  return { categoryIdx, modelIdx, sizeIdxs, fallbackUsed };
}
