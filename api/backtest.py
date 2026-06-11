"""
Vercel Python serverless function: /api/backtest
Runs paper-trading backtest for a symbol and returns full stats + equity curve.
"""

from http.server import BaseHTTPRequestHandler
import json
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from api.quant.simulator import PaperTrader
from api.quant.data      import fetch


class handler(BaseHTTPRequestHandler):

    def do_GET(self):
        from urllib.parse import urlparse, parse_qs
        qs     = parse_qs(urlparse(self.path).query)
        symbol = qs.get("symbol",  ["AAPL"])[0].upper()
        period = qs.get("period",  ["1y"])[0]
        cash   = float(qs.get("cash", ["100000"])[0])

        df = fetch(symbol, period=period, interval="1d")
        if df.empty:
            self._json({"error": "no_data", "symbol": symbol}, 404)
            return

        trader = PaperTrader(initial_cash=cash)
        stats  = trader.run_backtest(df, symbol)
        self._json(stats)

    def _json(self, data: dict, code: int = 200):
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)
