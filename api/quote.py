"""Vercel Python serverless function: /api/quote — lightweight live quote."""
from http.server import BaseHTTPRequestHandler
import json, sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from api.quant.data import fetch_quote


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        from urllib.parse import urlparse, parse_qs
        qs     = parse_qs(urlparse(self.path).query)
        symbol = qs.get("symbol", ["AAPL"])[0].upper()
        data   = fetch_quote(symbol)
        body   = json.dumps(data).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)
