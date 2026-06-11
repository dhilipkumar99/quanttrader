"""
Vercel Python serverless function: /api/analyze
Runs the full QuantEngine on a symbol and returns JSON result.
"""

from http.server import BaseHTTPRequestHandler
import json
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from api.quant.engine import QuantEngine
from api.quant.data   import fetch, fetch_quote


_engine = QuantEngine()


class handler(BaseHTTPRequestHandler):

    def do_GET(self):
        from urllib.parse import urlparse, parse_qs
        qs     = parse_qs(urlparse(self.path).query)
        symbol = qs.get("symbol", ["AAPL"])[0].upper()
        period = qs.get("period",  ["1y"])[0]

        df = fetch(symbol, period=period, interval="1d")
        if df.empty:
            self._json({"error": "no_data", "symbol": symbol}, 404)
            return

        result = _engine.analyze(df, symbol)
        quote  = fetch_quote(symbol)

        payload = {
            "symbol":             result.symbol,
            "price":              quote.get("price", 0),
            "change_pct":         quote.get("change_pct", 0),
            "composite_signal":   result.composite_signal,
            "composite_confidence": result.composite_confidence,
            "regime":             result.regime,
            "position_size_pct":  result.position_size_pct,
            "expected_return":    result.expected_return,
            "risk_metrics":       result.risk_metrics,
            "indicators":         result.indicators,
            "monte_carlo":        result.monte_carlo,
            "signals": [
                {
                    "source":     s.source,
                    "direction":  s.direction,
                    "confidence": round(s.confidence, 4),
                    "stop_loss":  round(s.stop_loss, 4),
                    "take_profit": round(s.take_profit, 4),
                }
                for s in result.signals
            ],
        }
        self._json(payload)

    def _json(self, data: dict, code: int = 200):
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)
