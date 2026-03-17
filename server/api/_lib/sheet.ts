import { parse } from "csv-parse/sync";
import { SIZES, type Size } from "./sizes.js";

export type SheetItem = {
  category: string;
  model: string;
  sizes: Record<Size, number>;
};

export type SheetFetchDebug = {
  url: string;
  contentType: string | null;
  status: number;
  ok: boolean;
  bodyChars: number;
  bodySnippet: string;
  headerRowIndex: number;
  headerRow: string[];
  parsedRowCount: number;
  columnIndexes: {
    category: number;
    model: number;
    sizes: Record<string, number>;
    fallbackUsed: boolean;
  };
  mappedItemCount: number;
  mappedSample: SheetItem[];
};

type Cache = {
  fetchedAt: number;
  items: SheetItem[];
};

let cache: Cache | null = null;
let inFlight: Promise<Cache> | null = null;

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

  const gidMatch = input.match(/[?#&]gid=(\d+)/);
  const gid = gidMatch ? gidMatch[1] : "0";

  return `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&gid=${gid}`;
}

function parseRows(csv: string): string[][] {
  return parse(csv, {
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
}

async function fetchCsvText(): Promise<{ url: string; csv: string; contentType: string | null; status: number; ok: boolean }> {
  const direct = requireEnv("SHEET_CSV_URL");
  const sheetUrl = requireEnv("SHEET_URL");
  const url = direct ?? (sheetUrl ? toCsvUrl(sheetUrl) : null);
  if (!url) throw new Error("Missing SHEET_CSV_URL or SHEET_URL in env");

  const res = await fetch(url);
  const contentType = res.headers.get("content-type");
  const csv = await res.text();

  const maybeHtml = /^\s*</.test(csv) || (contentType ? contentType.includes("text/html") : false);
  if (!res.ok || maybeHtml) {
    const hint = maybeHtml
      ? "Response looks like HTML (check sharing permissions / URL)."
      : "HTTP error fetching sheet CSV.";
    throw new Error(
      `Failed to fetch usable sheet CSV. ${hint} status=${res.status} content-type=${contentType ?? "unknown"}`
    );
  }

  return { url, csv, contentType, status: res.status, ok: res.ok };
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
      for (let i = 0; i < SIZES.length; i++) sizeIdxs[SIZES[i]] = base + i;
    }
  }

  return { categoryIdx, modelIdx, sizeIdxs, fallbackUsed };
}

export async function getSheetItems(opts?: { force?: boolean }): Promise<Cache> {
  const ttlMs = parseNumber(process.env.CACHE_TTL_MS || 300000);
  const now = Date.now();

  if (!opts?.force && cache && now - cache.fetchedAt < ttlMs) return cache;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const { csv } = await fetchCsvText();
    const rows = parseRows(csv);

    const items: SheetItem[] = [];

    const headerRowIndex = findHeaderRowIndex(rows);
    if (headerRowIndex < 0) return { fetchedAt: Date.now(), items };

    const headerRow = (rows[headerRowIndex] ?? []).map(normalizeKey);
    const idx = buildIndexFromHeaderRow(headerRow);
    if (idx.categoryIdx < 0 || idx.modelIdx < 0) return { fetchedAt: Date.now(), items };

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

export async function debugSheetFetch(): Promise<SheetFetchDebug> {
  const { url, csv, contentType, status, ok } = await fetchCsvText();
  const rows = parseRows(csv);

  const headerRowIndex = findHeaderRowIndex(rows);
  const headerRow = headerRowIndex >= 0 ? (rows[headerRowIndex] ?? []).map(normalizeKey) : [];
  const idx = headerRowIndex >= 0 ? buildIndexFromHeaderRow(headerRow) : null;

  const mapped: SheetItem[] = [];
  if (headerRowIndex >= 0 && idx && idx.categoryIdx >= 0 && idx.modelIdx >= 0) {
    for (let i = headerRowIndex + 1; i < rows.length; i++) {
      const row = rows[i] ?? [];
      const category = normalizeKey(row[idx.categoryIdx] ?? "");
      const model = normalizeKey(row[idx.modelIdx] ?? "");
      if (!category && !model) continue;
      const sizes: Record<Size, number> = Object.fromEntries(
        SIZES.map((s) => [s, parseNumber(row[idx.sizeIdxs[s] ?? -1])])
      ) as Record<Size, number>;
      mapped.push({ category, model, sizes });
    }
  }

  return {
    url,
    contentType,
    status,
    ok,
    bodyChars: csv.length,
    bodySnippet: csv.slice(0, 500),
    headerRowIndex,
    headerRow,
    parsedRowCount: rows.length,
    columnIndexes: {
      category: idx?.categoryIdx ?? -1,
      model: idx?.modelIdx ?? -1,
      sizes: Object.fromEntries(SIZES.map((s) => [s, idx?.sizeIdxs[s] ?? -1])),
      fallbackUsed: idx?.fallbackUsed ?? false
    },
    mappedItemCount: mapped.length,
    mappedSample: mapped.slice(0, 5)
  };
}
