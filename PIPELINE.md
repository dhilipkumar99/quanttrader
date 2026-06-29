# QuantTrader Data Pipeline — Protected Architecture

> **Purpose:** This document records every decision, invariant, and constraint that makes consecutive stock searches work reliably without hitting Yahoo Finance rate limits. Before modifying any section marked **PROTECTED**, read the invariant it enforces and understand why it exists.

---

## Table of Contents

1. [The Core Problem We Solved](#1-the-core-problem-we-solved)
2. [Architecture Overview](#2-architecture-overview)
3. [Layer 1 — OHLCV Fetch Hierarchy (ohlcv_store.py)](#3-layer-1--ohlcv-fetch-hierarchy)
4. [Layer 2 — Server-Side Cache (_cached, _server_cache)](#4-layer-2--server-side-cache)
5. [Layer 3 — Startup Sequence (prewarm)](#5-layer-3--startup-sequence)
6. [Layer 4 — Endpoint Guards (bar counts, short periods)](#6-layer-4--endpoint-guards)
7. [Layer 5 — CDN & HTTP Cache Suppression](#7-layer-5--cdn--http-cache-suppression)
8. [Layer 6 — Client-Side Retry Logic](#8-layer-6--client-side-retry-logic)
9. [Layer 7 — Leaderboard Pre-computation](#9-layer-7--leaderboard-pre-computation)
10. [What Was Broken Before & What Fixed It](#10-what-was-broken-before--what-fixed-it)
11. [Invariants That Must Never Be Violated](#11-invariants-that-must-never-be-violated)

---

## 1. The Core Problem We Solved

Yahoo Finance imposes an undocumented rate limit on their data endpoints. The original architecture had **two separate bulk downloads firing on every cold start**:

1. `_start_background_prefetch()` in `ohlcv_store.py` — called at **module import time**, downloaded the entire S&P 500 (~500 symbols) in the background before the server was even ready.
2. `_bg_refresh()` in `server.py` — downloaded S&P 500 + NASDAQ (~600 symbols) in two 300-symbol chunks immediately after prewarm.

**Effect:** Every cold start burned through Yahoo's rate-limit bucket within the first 80 seconds. Any user stock search arriving during or after this window received a 401/429 from Yahoo → `fetch()` returned an empty DataFrame → `_cached()` stored `_NO_DATA` → endpoint returned 404. Consecutive searches made the problem worse because each additional search fired another live Yahoo request against an already-exhausted bucket.

**Solution:** Fetch on demand only. The startup sequence now fetches exactly **20 symbols** (the leaderboard core) in one `yf.download()` call. Everything else is fetched when a user explicitly requests it. Yahoo's bucket is idle between that one startup call and each subsequent individual user request.

---

## 2. Architecture Overview

```
Browser
  │
  ├─ Next.js /app/api/* proxy routes  (Cache-Control: no-store on ALL responses)
  │    └─ forwards to FastAPI at PYTHON_API_BASE
  │
  └─ FastAPI api/server.py
       │
       ├─ _cached()  ← stale-while-revalidate, _NO_DATA sentinel, zero-signal rejection
       │
       ├─ _engine.analyze()  ← requires ≥50 raw bars (40-bar Hurst + dropna headroom)
       │
       └─ fetch()  ← ohlcv_store.py  6-tier hierarchy
            ├─ T1: hot memory cache (600s TTL, dict keyed sym|period|interval)
            ├─ T2: SQLite + period fallback (1y data serves 1mo/3mo/6mo requests)
            ├─ T3: Yahoo Finance chart v8 JSON (query1 + query2 round-robin)
            ├─ T4: Yahoo Finance CSV endpoint (separate cookie/crumb session)
            ├─ T5: yfinance library (direct Ticker.history)
            ├─ T5b: Alpha Vantage (20 calls/day hard cap)
            └─ T6: TwelveData (200 credits/day cap)
```

---

## 3. Layer 1 — OHLCV Fetch Hierarchy

**File:** `api/quant/ohlcv_store.py` → `fetch(symbol, period, interval)`

### 3.1 Hot Memory Cache (Tier 1)

```python
_hot_cache: dict[str, tuple[pd.DataFrame, str, float]] = {}
_HOT_TTL = 600  # 10 minutes
```

**Key format:** `"{SYM}|{period}|{interval}"`

**PROTECTED invariant:** TTL is 600 seconds. This must be ≥ the analyze endpoint TTL (also 600s) so that a symbol served from hot cache doesn't expire and force a live re-fetch while its analyze result is still valid.

### 3.2 SQLite + Period Fallback (Tier 2)

**PROTECTED:** `_db_get_with_fallback()` — if `period="1mo"` is requested and not in SQLite, it tries longer cached periods in order: `10y → 5y → 2y → 1y → 6mo → 3mo`. A symbol stored under `"1y"` will serve any shorter-period request by slicing `df.iloc[-requested_bars:]`.

```python
_PERIOD_FALLBACK_ORDER = ["10y", "5y", "2y", "1y", "6mo", "3mo", "1mo", "5d"]
```

This is what makes consecutive searches fast: the **first** request for TSLA fetches 1y of data and stores it in SQLite. The **second** request (regardless of period) hits SQLite instantly — no Yahoo call needed.

**PROTECTED:** All live-fetch tiers (T3–T6) always store under `"1y"`, never under the requested period, so the SQLite entry is maximally reusable:
```python
_db_put(sym, "1y", interval, df, "yfinance")
```

### 3.3 Minimum Bars Constant

```python
_MIN_BARS = 50
```

**PROTECTED invariant:** Must be ≥ 50. The engine's `feature_eng.compute()` uses a `rolling(40)` window for the Hurst exponent. After `f.dropna()`, any input with fewer than ~41 raw bars produces an empty features DataFrame → `_empty_result()` → all zeros. 50 gives safe headroom above 41. Reducing this below 50 will cause zero-signal results for short-period requests.

### 3.4 No Startup Bulk Download

**PROTECTED:** The line `_start_background_prefetch(period="1y")` was removed from the bottom of `ohlcv_store.py`. Do **not** restore it. It was firing a full S&P 500 download on every module import, exhausting Yahoo's rate limit before any user request arrived.

---

## 4. Layer 2 — Server-Side Cache

**File:** `api/server.py` → `_cached(key, ttl, fn)`

### 4.1 Return Value Contract

`_cached()` has exactly three return states. Every endpoint must handle all three:

| Return value | Meaning | Correct HTTP response |
|---|---|---|
| `dict` / real value | Fresh computed result | `200 OK` |
| `_NO_DATA` (sentinel `object()`) | `fn()` completed, returned `None` — symbol has no data | `404 Not Found` |
| `None` (Python `None`) | Still computing after 7s wait | `503 Service Unavailable` |

**PROTECTED:** Never check only `if val is None`. Every endpoint must check `if val is None or val is _NO_DATA` for error cases, otherwise `_NO_DATA` will be returned as a 200 response and FastAPI will throw `TypeError: Object of type object is not JSON serializable`.

The only endpoints that legitimately separate the two are those with both a 404 and 503 path (analyze, candles) — they check `if val is _NO_DATA` first, then `if val is None`.

### 4.2 Zero-Signal Rejection

```python
def _is_zero_signal_result(val) -> bool:
    return (
        isinstance(val, dict)
        and val.get("composite_signal", 1) == 0
        and val.get("composite_confidence", 1.0) == 0.0
        and not val.get("signals")
        and "error" not in val
    )
```

**PROTECTED:** This function identifies analyze results where the engine returned `_empty_result()` — all zeros, no signals. These must **never** be cached as valid results. The cache will store them as `_NO_DATA` with a backoff instead. If this check is removed, zero-signal results will be served as 200 OK and displayed to the user as legitimate signals.

### 4.3 _NO_DATA Backoff

When `fn()` returns `None` (no data), `_cached()` stores `_NO_DATA` with a timestamp artificially aged by `backoff` seconds:

```python
backoff = 290 if not _prewarm_done else 240
_server_cache[k] = {"val": _NO_DATA, "ts": _time.time() - backoff}
```

**PROTECTED:** The `backoff` (290s during prewarm, 240s after) is subtracted from the current time. Combined with `_no_data_block = 10 if not _prewarm_done else 60`, the effective re-fetch delay for a failed symbol is:

- `age = now - (now - 290) = 290`
- `_no_data_block = 60`
- `290 > 60` → block NOT applied → next request immediately recomputes

This means a transiently rate-limited symbol will retry on the very next request without a long lockout. **Do not increase `backoff` to a value less than `_no_data_block`** — that would create a genuine lockout window.

### 4.4 Cache Keys and TTLs

| Endpoint | Cache key | TTL |
|---|---|---|
| `/api/analyze` | `analyze:{SYM}:{fetch_period}` | 600s |
| `/api/candles` | `candles:{SYM}:{fetch_period}` | 600s |
| `/api/backtest` | `backtest:{SYM}:{period}` | 600s |
| `/api/backtest/stress` | `backtest_stress:{SYM}:{period}` | 3600s |
| `/api/leaderboard` | `leaderboard:{horizon}` | 3600s |
| `/api/daytrade-picks` | `daytrade_picks:{universe}:{limit}:{horizon}:{shorts}` | 900s |
| `/api/signal-history` | `signal_history:{SYM}:{period}` | 300s |
| `/api/portfolio/risk` | `portfolio_risk:{syms}:{period}` | 600s |
| `/api/portfolio/backtest` | `portfolio_backtest:{syms}:{period}:{cash}` | 300s |
| `/api/options/chain` | `options_chain:{SYM}` | 300s |
| `/api/options/signal` | `options_signal:{SYM}:{horizon}` | 180s |

**PROTECTED:** Analyze TTL is 600s. This was deliberately raised from 120s to match the hot-cache TTL in `ohlcv_store.py`. If analyze TTL < hot-cache TTL, a stale analyze result will recompute against the same hot-cached DataFrame, wasting compute without improving data freshness.

---

## 5. Layer 3 — Startup Sequence

**File:** `api/server.py` → `_prewarm()`

### 5.1 What Prewarm Does

```
Module load  →  _prewarm() thread starts
                │
                ├─ Phase 1: Check SQLite for each of 20 symbols
                │   └─ Hit → _cache_symbol() → populate _server_cache + hot_cache
                │
                ├─ Phase 2 (if any missed): yf.download(20 symbols in ONE call)
                │   └─ Store to SQLite, hot_cache, _server_cache
                │
                ├─ _prewarm_done = True  → /health returns "ok"  → frontend fires requests
                ├─ _bg_refresh_done = True  → daytrade-picks gate opens
                │
                └─ _prewarm_leaderboard() thread starts (uses symbols already in SQLite)
```

**PROTECTED:** The 20-symbol list is exactly `_LEADERBOARD_CORE`. These are the same symbols the leaderboard walk-forward loops require. If you add symbols to the leaderboard but not to the prewarm list, leaderboard pre-computation will score fewer symbols at startup.

```python
_WARM = list(dict.fromkeys([
    "AAPL", "NVDA", "MSFT", "GOOGL", "META", "AMZN", "TSLA",
    "AMD", "NFLX", "JPM", "BAC", "GS", "ORCL", "ADBE", "CRM",
    "SPY", "QQQ", "XLK", "XLF", "COST",
]))
```

**PROTECTED:** `threads=False` in `yf.download()`. The yfinance library has a known internal dict-mutation race condition (`RuntimeError: dictionary changed size during iteration`) when `threads=True` on large batches. Always pass `threads=False`.

### 5.2 The /health Gate

```python
@app.get("/health")
def health():
    if _prewarm_done:
        return {"status": "ok", "universe_ready": _bg_refresh_done}
    return JSONResponse({"status": "warming", "universe_ready": False}, status_code=200)
```

**PROTECTED:** The frontend's `wakeRender()` polls `/health` and only sets `serverReady = true` once it sees `"ok"`. No API calls fire until `serverReady` is true. This prevents the first user request from hitting an empty cache and triggering a redundant live fetch during prewarm's own fetch.

---

## 6. Layer 4 — Endpoint Guards

### 6.1 Universal Bar Guard

Every `engine.analyze()` call site is guarded with `len(df) < 50`. The engine's `_empty_result()` produces all-zero output for insufficient data; this guard prevents that result from ever reaching `_is_zero_signal_result()` and being cached as `_NO_DATA`.

**PROTECTED locations (must all remain at ≥ 50):**

| Location | Guard |
|---|---|
| `_cache_symbol()` | `if df is None or len(df) < 50: return 0` |
| `analyze` `_compute()` | `if df.empty or len(df) < 50: return None` |
| `backtest` `_compute()` | `if df.empty or len(df) < 50: return None` |
| `backtest_stress` `_compute()` | `if df.empty or len(df) < 50: return None` |
| `watchlist` inline | `if not df.empty and len(df) >= 50` |
| `options/signal` `_compute()` | `if df.empty or len(df) < 50: return None` |
| `engine.py` `analyze()` | `if df.empty or len(df) < 50: return self._empty_result()` |
| `agent.py` both call sites | `if df.empty or len(df) < 50: continue` |

### 6.2 Short-Period Canonicalization

**PROTECTED** in analyze endpoint:
```python
_SHORT_PERIODS = {"1d", "5d", "1mo", "3mo"}
fetch_period = "1y" if period in _SHORT_PERIODS else period
cache_key = f"analyze:{sym}:{fetch_period}"
```

**PROTECTED** in candles endpoint:
```python
_SHORT = {"1d", "5d", "1mo", "3mo"}
fetch_period = "1y" if period in _SHORT else period
cache_key = f"candles:{sym}:{fetch_period}"
```

**Why:** The TopBar and SearchBar UI expose `["1mo", "3mo", "6mo", "1y", "2y", "5y"]` as period options. `1mo` yields ~21 trading days and `3mo` yields ~63 — both below the 50-bar minimum. Without canonicalization, every `period=1mo` request would get `_NO_DATA` → 404, and would cache separately from the valid `period=1y` result for the same symbol, creating a permanent 404 for that period key.

Canonicalization ensures:
1. `analyze:TSLA:1mo`, `analyze:TSLA:5d`, `analyze:TSLA:3mo` all resolve to cache key `analyze:TSLA:1y`
2. The full 1y dataset is fetched and stored in SQLite
3. SQLite's period-fallback mechanism serves subsequent 1mo/3mo requests from the 1y cache entry

---

## 7. Layer 5 — CDN & HTTP Cache Suppression

### 7.1 Next.js API Routes

**PROTECTED:** Every `NextResponse.json()` call in every `/src/app/api/*/route.ts` file must include `{ "Cache-Control": "no-store" }` on **every response path** including error and catch blocks.

Previously, several routes had `s-maxage=600` or `s-maxage=3600` — Vercel's CDN cached a zero-signal or error response for hours, and every user received that cached bad result regardless of server-side cache state.

Routes that were fixed:
- `backtest/route.ts` — removed `s-maxage=600`
- `backtest/stress/route.ts` — removed `s-maxage=3600`
- `chart-data/[symbol]/route.ts` — removed `s-maxage=3600`
- `charts/batch/route.ts` — removed `s-maxage=3600`
- `portfolio/backtest/route.ts` — removed `s-maxage=600`
- `portfolio/risk/route.ts` — removed `s-maxage=600`

### 7.2 Next.js Page ISR

**PROTECTED:** `src/app/analysis/[symbol]/page.tsx` fetch must use `cache: "no-store"`, not `next: { revalidate: 60 }`. ISR would serve a stale zero-signal page from the edge cache for up to 60 seconds.

### 7.3 Client Fetch Calls

**PROTECTED:** `src/lib/api.ts` → `fetchWithTimeout()` and `wakeRender()` must use `cache: "no-store"`. Same for `src/lib/marketApi.ts` `get()` and `del()`.

---

## 8. Layer 6 — Client-Side Retry Logic

**File:** `src/app/page.tsx` → `fetchAnalysis()`

### 8.1 Zero-Signal Backstop

```typescript
if (data.composite_signal === 0 && data.composite_confidence === 0 &&
    (!data.signals || data.signals.length === 0)) {
  if (attempt < 4) {
    setTimeout(() => fetchAnalysis(sym, period, attempt + 1), 3000);
    return;
  }
}
```

**PROTECTED:** This is the last line of defense. If the server returns a 200 with all-zero signal data (which should not happen after server-side guards, but may occur during transient race conditions), the client treats it as "still computing" and retries up to 4 times at 3-second intervals.

### 8.2 ComputingError Retry

```typescript
if (e instanceof ComputingError && attempt < 4) {
  const delay = (e.retryAfter ?? 3) * 1000;
  setTimeout(() => fetchAnalysis(sym, period, attempt + 1), delay);
}
```

**PROTECTED:** `ComputingError` is thrown by `api.ts:get()` when the server returns a 503 with `{"error": "computing", "retry_after": N}`. The client uses the server-provided hint for the retry delay. Do not change this to a fixed delay — the server knows how long computation takes for each endpoint.

### 8.3 serverReady Gate

```typescript
wakeRender(300_000).then(ok => { setServerReady(ok); });
// ...
if (!serverReady) return; // gated
fetchAnalysis(activeSymbol, activePeriod);
```

**PROTECTED:** `wakeRender()` polls `/health` until `status === "ok"`, with a 5-minute timeout. No API calls fire until prewarm is confirmed complete. Without this gate, the very first request arrives during prewarm's yf.download() call, competes for Yahoo's rate-limit bucket, and may force a redundant fetch.

---

## 9. Layer 7 — Leaderboard Pre-computation

**File:** `api/server.py` → `_compute_leaderboard()` + `_prewarm_leaderboard()`

### 9.1 Why Pre-computation Is Necessary

The leaderboard runs walk-forward analysis: 20 symbols × ~60 windows of `_engine.analyze()` = ~1200 engine calls. This takes 30–90 seconds. `_cached()` waits at most 7 seconds before returning `None` (503). Without pre-computation, every cold-start leaderboard request 503s for the entire compute duration, and the client's 6-retry × 15s loop (90s total) may exhaust before the result is ready.

### 9.2 Pre-computation Sequence

```python
def _prewarm_leaderboard():
    for h in ("swing", "day", "month"):
        _cached(f"leaderboard:{h}", ttl=3600,
                fn=lambda horizon=h: _compute_leaderboard(horizon))
```

This runs in a daemon thread started immediately after `_prewarm_done = True`. By the time a user's browser has loaded the page and fired the leaderboard request (~5–15s after health returns ok), the "swing" leaderboard is typically already computing or complete.

**PROTECTED:** `_LEADERBOARD_CORE` — the 20 symbols used for walk-forward scoring — must match the 20 symbols in prewarm's `_WARM` list. If a symbol appears in `_LEADERBOARD_CORE` but not `_WARM`, `fetch()` will make a live Yahoo call during leaderboard pre-computation, competing with the prewarm batch download.

### 9.3 Client Retry for Leaderboard

**File:** `src/components/panels/LeaderboardPanel.tsx`

```typescript
if (e instanceof ComputingError && attempt < 6) {
  const delay = (e.retryAfter ?? 15) * 1000;
  retryTimer = setTimeout(() => load(attempt + 1), delay);
  setError(`warming_up:${attempt}`);
}
```

The leaderboard retries up to 6 times at 15-second intervals (90s total), displaying a "warming up" spinner instead of an error during this window. The server sends `retry_after: 15` in the 503 body.

---

## 10. What Was Broken Before & What Fixed It

### 10.1 Root Cause: Dual Bulk Downloads on Cold Start

| Problem | Location | Fix |
|---|---|---|
| S&P 500 batch download on module import | `ohlcv_store.py:1303` `_start_background_prefetch()` | **Removed entirely** |
| S&P 500 + NASDAQ batch on prewarm | `server.py` `_bg_refresh()` | **Removed entirely** |
| Both fires simultaneously, exhausts Yahoo rate limit | — | **Replaced with on-demand fetch only** |

### 10.2 Zero-Signal Results Being Served

| Problem | Root cause | Fix |
|---|---|---|
| All signals 0, confidence 0, kelly 0 | `len(df) < 30` bar guard too low; 40-bar Hurst window → `dropna()` → empty features | Raised all guards to `len(df) < 50` |
| `period=1mo` always 404 | 1mo yields ~21 bars, cached as `_NO_DATA` under separate key | Canonicalize 1d/5d/1mo/3mo → "1y" for fetch + cache key |
| Zero results persisting from CDN | Routes had `s-maxage=600` or ISR `revalidate: 60` | All routes: `Cache-Control: no-store` on every response path |
| Zero results cached for 60s in `_server_cache` | `_is_zero_signal_result` check missing from cache write path | Added rejection at `_compute()` return and in `_cached()` storage |

### 10.3 _NO_DATA Sentinel Bug

| Problem | Root cause | Fix |
|---|---|---|
| 8 endpoints returning HTTP 500 on no-data | `_cached()` returns `_NO_DATA` object, not Python `None`. Endpoints only checked `if val is None` — this is always False for `_NO_DATA`. FastAPI tried to serialize `object()` → `TypeError` | Changed all affected endpoints to `if val is None or val is _NO_DATA` |

### 10.4 Leaderboard 503 Loop

| Problem | Root cause | Fix |
|---|---|---|
| Leaderboard 503s on every cold-start request indefinitely | Compute takes 30–90s; `_cached()` 7s wait always expires; client retried 6× at 15s (90s) but compute took longer | Extracted `_compute_leaderboard()`, start pre-computation immediately after prewarm in background thread. Also: `retry_after` reduced from 60 → 15s |

### 10.5 Consecutive Search Rate Limiting

| Problem | Root cause | Fix |
|---|---|---|
| 2nd, 3rd stock search fails with 401/404 | Both `_bg_refresh` (server.py) and `_start_background_prefetch` (ohlcv_store.py) were running concurrent bulk Yahoo downloads. Individual user requests hit the same exhausted rate-limit bucket. | Eliminated all bulk downloads. Fetch is now strictly on-demand. Yahoo bucket is idle between user requests. |

---

## 11. Invariants That Must Never Be Violated

These are the non-negotiable constraints. Violating any one of them will cause a regression to a broken state.

### I1 — No Bulk Downloads at Startup

**Never** add a background thread that downloads more than the 20-symbol prewarm batch on cold start. Any bulk download competing with user requests will exhaust Yahoo's rate limit and cause 401s for real user searches.

### I2 — Bar Guard ≥ 50 at Every engine.analyze() Call Site

The Hurst exponent uses `rolling(40)`. After `dropna()`, fewer than 41 bars produce an empty feature set. The guard must be ≥ 50 everywhere to give safe headroom. The `< 30` guard that existed in the original code was the root cause of all-zero signal results.

### I3 — Short Periods Canonicalized to "1y"

Periods `1d`, `5d`, `1mo`, `3mo` yield fewer than 50 bars. Both the **analyze** and **candles** endpoints must map these to `"1y"` for both the fetch call and the cache key. If only one is canonicalized, the cache hit is missed and a live fetch is triggered.

### I4 — Cache-Control: no-store on All API Responses

Every `NextResponse.json()` in every `/src/app/api/*/route.ts` must include `"Cache-Control": "no-store"` on every response path (success, error, catch). Any CDN-cacheable response can serve a stale zero-signal result for hours.

### I5 — _NO_DATA vs None Must Both Be Checked

`_cached()` returns `_NO_DATA` (not `None`) for "compute completed, no data found". Every endpoint that calls `_cached()` must handle this: `if val is None or val is _NO_DATA`. Checking only `if val is None` passes the sentinel through to FastAPI's serializer, causing a 500.

### I6 — SQLite Always Stores Under "1y"

All live-fetch tiers (T3–T6) in `ohlcv_store.fetch()` must write `_db_put(sym, "1y", interval, df, source)` regardless of the requested period. The period-fallback mechanism in `_db_get_with_fallback()` slices the 1y data down. Storing under the requested period would fragment the cache and force new downloads for each period variant.

### I7 — Hot Cache TTL ≥ Analyze TTL

`_HOT_TTL = 600` in ohlcv_store must be ≥ the analyze endpoint TTL (600s). If hot cache expires before the analyze result does, a stale-but-valid analyze result will trigger a recompute that goes to SQLite (fast), but if SQLite also misses it goes to live Yahoo (slow and rate-limited).

### I8 — _LEADERBOARD_CORE == _WARM (prewarm symbol list)

The 20 symbols in `_LEADERBOARD_CORE` (server.py) and `_WARM` (prewarm) must be identical. Prewarm populates SQLite for exactly these 20 symbols; leaderboard pre-computation calls `fetch()` for exactly these 20 symbols immediately after prewarm. Any symbol in the leaderboard list but not the prewarm list will trigger a live Yahoo fetch during leaderboard computation.

### I9 — threads=False in yf.download()

Always pass `threads=False` to `yf.download()`. The yfinance library has an internal dict-mutation race condition (`RuntimeError: dictionary changed size during iteration`) when `threads=True` with large ticker lists.

### I10 — serverReady Gate in Frontend

The frontend must not fire `fetchAnalysis()` or any data API call before `wakeRender()` resolves and `serverReady` is set to `true`. Without this gate, requests arrive during prewarm's own `yf.download()` call, compete for the same rate-limit bucket, and may receive empty DataFrames.

---

## File Reference

| File | Role |
|---|---|
| `api/quant/ohlcv_store.py` | 6-tier OHLCV fetch, SQLite persistence, hot memory cache |
| `api/quant/engine.py` | `QuantEngine.analyze()` — requires ≥50 bars, returns `_empty_result()` if insufficient |
| `api/quant/feature_eng.py` | 40-bar rolling Hurst; `compute()` → `dropna()` → empty if <41 bars |
| `api/server.py` | `_cached()`, `_NO_DATA`, prewarm, leaderboard, all endpoint bar guards |
| `src/app/api/analyze/route.ts` | Next.js proxy — `Cache-Control: no-store` enforced |
| `src/app/api/candles/route.ts` | Next.js proxy — `Cache-Control: no-store` enforced |
| `src/app/analysis/[symbol]/page.tsx` | SSR analysis page — `cache: "no-store"` on fetch |
| `src/lib/api.ts` | `ComputingError`, `wakeRender()`, `fetchWithTimeout()` — all `cache: "no-store"` |
| `src/lib/marketApi.ts` | Quote fetch — `cache: "no-store"` |
| `src/app/page.tsx` | `serverReady` gate, zero-signal backstop retry, `ComputingError` retry |
| `src/components/panels/LeaderboardPanel.tsx` | 6-retry × 15s loop with `warming_up` spinner |
