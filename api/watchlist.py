"""
Vercel Python serverless function: /api/watchlist
Scores a list of symbols and returns ranked signals.
"""

from http.server import BaseHTTPRequestHandler
import json
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from api.quant.engine import QuantEngine
from api.quant.data   import fetch, fetch_quote

_engine = QuantEngine()

DEFAULT_WATCHLIST = [
    "AAPL", "MSFT", "NVDA", "GOOGL", "AMZN",
    "META", "TSLA", "JPM", "V", "UNH",
    "SPY", "QQQ", "BRK-B", "JNJ", "XOM"
]


class handler(BaseHTTPRequestHandler):

    def do_GET(self):
        from urllib.parse import urlparse, parse_qs
        qs      = parse_qs(urlparse(self.path).query)
        symbols = qs.get("symbols", [",".join(DEFAULT_WATCHLIST)])[0].split(",")
        symbols = [s.strip().upper() for s in symbols if s.strip()][:20]

        results = []
        for sym in symbols:
            df = fetch(sym, period="6mo", interval="1d")
            if df.empty:
                continue
            r     = _engine.analyze(df, sym)
            quote = fetch_quote(sym)
            results.append({
                "symbol":     sym,
                "price":      quote.get("price", 0),
                "change_pct": quote.get("change_pct", 0),
                "signal":     r.composite_signal,
                "confidence": r.composite_confidence,
                "regime":     r.regime,
                "rsi":        r.indicators.get("rsi_14", 50),
                "sharpe":     r.risk_metrics.get("sharpe", 0),
                "kelly_pct":  r.position_size_pct,
            })

        # Rank by |confidence| × |signal|
        results.sort(key=lambda x: abs(x["confidence"]) * abs(x["signal"]), reverse=True)
        self._json({"watchlist": results})

    def _json(self, data: dict, code: int = 200):
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)
