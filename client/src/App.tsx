import React, { useMemo, useState } from "react";

const SIZES = [
  "XXS",
  "XS",
  "S",
  "M",
  "L",
  "XL",
  "XXL",
  "XXXL",
  "XXXXL",
] as const;
type Size = (typeof SIZES)[number];

type Item = { category: string; model: string };

const DISPLAY_SIZE_LABEL: Record<Size, string> = {
  XXS: "2XS",
  XS: "XS",
  S: "S",
  M: "M",
  L: "L",
  XL: "XL",
  XXL: "2XL",
  XXXL: "3XL",
  XXXXL: "4XL",
};

function clampInt(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  return Math.floor(n);
}

export default function App() {
  const [counts, setCounts] = useState<Record<Size, number>>(
    () => Object.fromEntries(SIZES.map((s) => [s, 0])) as Record<Size, number>,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const requestedTotal = useMemo(
    () => Object.values(counts).reduce((sum, n) => sum + clampInt(n), 0),
    [counts],
  );

  const sortedItems = useMemo(() => {
    const copy = items.slice();
    copy.sort((a, b) => {
      const ac = (a.category || "").toLowerCase();
      const bc = (b.category || "").toLowerCase();
      if (ac < bc) return -1;
      if (ac > bc) return 1;
      const am = (a.model || "").toLowerCase();
      const bm = (b.model || "").toLowerCase();
      if (am < bm) return -1;
      if (am > bm) return 1;
      return 0;
    });
    return copy;
  }, [items]);

  async function copyToClipboard(text: string) {
    if (!text) return;
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const el = document.createElement("textarea");
    el.value = text;
    el.setAttribute("readonly", "true");
    el.style.position = "fixed";
    el.style.left = "-9999px";
    document.body.appendChild(el);
    el.select();
    document.execCommand("copy");
    document.body.removeChild(el);
  }

  async function onSearch(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const apiBase =
        (import.meta.env.VITE_API_BASE_URL as string | undefined) || "";
      const base = apiBase.endsWith("/") ? apiBase.slice(0, -1) : apiBase;
      const res = await fetch(`${base}/api/search`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(counts),
      });
      const data = (await res.json()) as
        | { items: Item[]; fetchedAt: number }
        | { error: string };
      if (!res.ok)
        throw new Error("error" in data ? data.error : "Search failed");
      if ("error" in data) throw new Error(data.error);
      setItems(data.items);
    } catch (err) {
      setItems([]);
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page">
      <main className="shell">
        <header className="hero">
          <div className="badge">Apparel Promo's</div>
          <h1>Victor Apparel Inventory Checker</h1>
          <p>
            Tired of asking the Apparel Promo team for inventory checks? Use
            this tool to quickly find models that meet your sizing requirements.
          </p>
        </header>

        <section className="howto" aria-label="How to use">
          <h2>How to use</h2>
          <ol className="howtoList">
            <li>
              Enter the minimum quantity you need for each size (leave a size at
              0 to ignore it).
            </li>
            <li>
              Click <strong>Search</strong>.
            </li>
            <li>Review the matches list (sorted by category).</li>
            <li>
              Click <strong>Copy</strong> to copy a model number to your
              clipboard.
            </li>
            <li>
              Paste the model number into your search engine (probably Google)
              to see what the item looks like.
            </li>
          </ol>
        </section>

        <details className="faq" aria-label="FAQ">
          <summary>
            FAQ <span className="faqTip">(click to expand)</span>
          </summary>
          <div className="faqList">
            <details className="faqItem">
              <summary>Why aren't there pictures?</summary>
              <div className="faqBody">
                Unfortunately Victor's inventory sheet doesn't include images,
                and Victor's official website doesn't display everything they
                have in stock. Your best bet is to copy the model number and
                search for it online to find pictures and more details.
              </div>
            </details>
          </div>
        </details>

        <section className="card">
          <form onSubmit={onSearch} className="form">
            <div className="sizesRow" aria-label="Size minimums">
              {SIZES.map((size) => (
                <label key={size} className="sizePill">
                  <span className="sizeTag">{DISPLAY_SIZE_LABEL[size]}</span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    inputMode="numeric"
                    className="sizeInput"
                    value={counts[size]}
                    onFocus={(ev) => {
                      ev.currentTarget.select();
                    }}
                    onMouseUp={(ev) => {
                      // Prevent the mouse-up from clearing the selection after focus.
                      ev.preventDefault();
                    }}
                    onChange={(ev) => {
                      const next = clampInt(Number(ev.target.value));
                      setCounts((c) => ({ ...c, [size]: next }));
                    }}
                    aria-label={`${size} minimum`}
                  />
                </label>
              ))}
            </div>

            <div className="actions">
              <button className="btn" type="submit" disabled={loading}>
                {loading ? "Searching..." : "Search"}
              </button>
              <div className="meta">
                <div>
                  Item Count: <strong>{requestedTotal}</strong>
                </div>
              </div>
            </div>

            {error ? <div className="error">Error: {error}</div> : null}
          </form>
        </section>

        <section className="results">
          <div className="resultsHead">
            <h2>Matches: {sortedItems.length}</h2>
          </div>

          {sortedItems.length === 0 ? (
            <div className="empty">No matches yet. Try a search.</div>
          ) : (
            <div className="list">
              {sortedItems.map((it, idx) => (
                <article
                  key={`${it.category}:${it.model}:${idx}`}
                  className="item"
                >
                  <div className="itemTop">
                    <div>
                      <div className="cat">
                        {it.category || "Uncategorized"}
                      </div>
                      <div className="model">{it.model || "(no model)"}</div>
                    </div>
                    <button
                      className="copyBtn"
                      type="button"
                      onClick={async () => {
                        try {
                          await copyToClipboard(it.model || "");
                          const key = `${it.category}:${it.model}:${idx}`;
                          setCopiedKey(key);
                          window.setTimeout(
                            () => setCopiedKey((k) => (k === key ? null : k)),
                            900,
                          );
                        } catch (err) {
                          setError(
                            err instanceof Error ? err.message : "Copy failed",
                          );
                        }
                      }}
                      disabled={!it.model}
                      aria-label={`Copy model ${it.model}`}
                      title={
                        it.model
                          ? "Copy model to clipboard"
                          : "No model to copy"
                      }
                    >
                      {copiedKey === `${it.category}:${it.model}:${idx}`
                        ? "Copied"
                        : "Copy"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
