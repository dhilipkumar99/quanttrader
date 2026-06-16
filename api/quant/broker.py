"""
Alpaca broker integration — paper trading and live trading.
Uses alpaca-py SDK. Credentials come from env vars:
  ALPACA_API_KEY, ALPACA_SECRET_KEY, ALPACA_PAPER (true/false)
"""
import os
from typing import Optional
from .types import BrokerOrder, BrokerPosition, BrokerAccount, OrderBookSnapshot, BookLevel, Bar

def _clients():
    key    = os.environ.get("ALPACA_API_KEY", "")
    secret = os.environ.get("ALPACA_SECRET_KEY", "")
    paper  = os.environ.get("ALPACA_PAPER", "true").lower() != "false"

    if not key or not secret:
        return None, None, None

    try:
        from alpaca.trading.client import TradingClient
        from alpaca.data.historical import StockHistoricalDataClient
        from alpaca.data.live import StockDataStream
        trading = TradingClient(key, secret, paper=paper)
        data    = StockHistoricalDataClient(key, secret)
        return trading, data, paper
    except Exception:
        return None, None, None

def get_account() -> Optional[BrokerAccount]:
    trading, _, paper = _clients()
    if not trading:
        return None
    try:
        a = trading.get_account()
        return BrokerAccount(
            id=str(a.id),
            status=str(a.status),
            currency=str(a.currency),
            cash=float(a.cash),
            portfolio_value=float(a.portfolio_value),
            buying_power=float(a.buying_power),
            equity=float(a.equity),
            last_equity=float(a.last_equity),
            day_trade_count=int(a.daytrade_count or 0),
            pattern_day_trader=bool(a.pattern_day_trader),
            trading_blocked=bool(a.trading_blocked),
            paper=paper or False,
        )
    except Exception:
        return None

def get_positions() -> list[BrokerPosition]:
    trading, _, _ = _clients()
    if not trading:
        return []
    try:
        positions = trading.get_all_positions()
        result = []
        for p in positions:
            result.append(BrokerPosition(
                symbol=str(p.symbol),
                qty=float(p.qty),
                avg_entry_price=float(p.avg_entry_price),
                current_price=float(p.current_price or 0),
                market_value=float(p.market_value or 0),
                unrealized_pl=float(p.unrealized_pl or 0),
                unrealized_plpc=float(p.unrealized_plpc or 0),
                side=str(p.side),
            ))
        return result
    except Exception:
        return []

def get_orders(status: str = "open") -> list[BrokerOrder]:
    trading, _, _ = _clients()
    if not trading:
        return []
    try:
        from alpaca.trading.requests import GetOrdersRequest
        from alpaca.trading.enums import QueryOrderStatus
        req_status = QueryOrderStatus.OPEN if status == "open" else QueryOrderStatus.ALL
        orders = trading.get_orders(filter=GetOrdersRequest(status=req_status))
        result = []
        for o in orders:
            result.append(BrokerOrder(
                id=str(o.id),
                symbol=str(o.symbol),
                side=str(o.side),
                qty=float(o.qty or 0),
                order_type=str(o.order_type),
                status=str(o.status),
                filled_qty=float(o.filled_qty or 0),
                filled_avg_price=float(o.filled_avg_price) if o.filled_avg_price else None,
                limit_price=float(o.limit_price) if o.limit_price else None,
                created_at=str(o.created_at),
            ))
        return result
    except Exception:
        return []

def is_shortable(symbol: str) -> tuple[bool, str]:
    """
    Check Alpaca asset flags before opening a short.
    Returns (shortable, reason). Reason is "" when shortable.
    """
    trading, _, _ = _clients()
    if not trading:
        return False, "no_credentials"
    try:
        asset = trading.get_asset(symbol)
        if not asset.shortable:
            return False, f"{symbol} is not shortable on Alpaca"
        if not asset.easy_to_borrow:
            return False, f"{symbol} is hard-to-borrow — elevated borrow cost likely"
        return True, ""
    except Exception as e:
        return False, str(e)


def submit_order(
    symbol: str,
    qty: float,
    side: str,
    order_type: str = "market",
    limit_price: Optional[float] = None,
    time_in_force: str = "day",
    position_intent: str = "auto",  # "buy_to_open" | "sell_to_close" | "sell_to_open" | "buy_to_cover" | "auto"
) -> dict:
    """
    Submit equity order to Alpaca.

    position_intent disambiguates short vs close for SELL orders:
      sell_to_close  → close an existing long (OrderSide.SELL)
      sell_to_open   → open a new short (OrderSide.SELL + short check)
      buy_to_cover   → close an existing short (OrderSide.BUY)
      buy_to_open    → open a new long (OrderSide.BUY)
      auto           → infer from side string ("buy" or "sell")

    For short sells, checks asset.shortable and asset.easy_to_borrow first.
    """
    trading, _, _ = _clients()
    if not trading:
        return {"error": "no_credentials", "message": "Alpaca API keys not configured. Add ALPACA_API_KEY and ALPACA_SECRET_KEY to .env.local to enable live/paper trading."}
    try:
        from alpaca.trading.requests import MarketOrderRequest, LimitOrderRequest
        from alpaca.trading.enums import OrderSide, TimeInForce

        side_lower  = side.lower()
        intent      = position_intent.lower()

        # Resolve intent → Alpaca side
        if intent in ("sell_to_open", "sell_short"):
            _side = OrderSide.SELL
            # Check shortability before placing
            ok, reason = is_shortable(symbol)
            if not ok:
                return {"error": "not_shortable", "message": reason, "symbol": symbol}
        elif intent in ("buy_to_cover",):
            _side = OrderSide.BUY
        elif intent in ("sell_to_close",):
            _side = OrderSide.SELL
        elif intent in ("buy_to_open",):
            _side = OrderSide.BUY
        else:
            # auto: plain "buy" or "sell"
            _side = OrderSide.BUY if side_lower == "buy" else OrderSide.SELL

        _tif = TimeInForce.DAY if time_in_force.lower() == "day" else TimeInForce.GTC

        if order_type == "limit" and limit_price:
            req = LimitOrderRequest(symbol=symbol, qty=qty, side=_side, time_in_force=_tif, limit_price=limit_price)
        else:
            req = MarketOrderRequest(symbol=symbol, qty=qty, side=_side, time_in_force=_tif)

        order = trading.submit_order(req)
        return {
            "id":              str(order.id),
            "symbol":          str(order.symbol),
            "side":            str(order.side),
            "position_intent": position_intent,
            "qty":             float(order.qty or 0),
            "order_type":      str(order.order_type),
            "status":          str(order.status),
            "filled_qty":      float(order.filled_qty or 0),
            "limit_price":     float(order.limit_price) if order.limit_price else None,
            "created_at":      str(order.created_at),
        }
    except Exception as e:
        return {"error": "order_failed", "message": str(e)}

def cancel_order(order_id: str) -> dict:
    trading, _, _ = _clients()
    if not trading:
        return {"error": "no_credentials"}
    try:
        trading.cancel_order_by_id(order_id)
        return {"cancelled": order_id}
    except Exception as e:
        return {"error": str(e)}

def get_order_book(symbol: str) -> Optional[OrderBookSnapshot]:
    """Get L2 order book via Alpaca data API."""
    _, data_client, _ = _clients()
    if not data_client:
        return None
    try:
        from alpaca.data.requests import StockLatestOrderbookRequest
        req  = StockLatestOrderbookRequest(symbol_or_symbols=symbol)
        resp = data_client.get_stock_latest_orderbook(req)
        ob   = resp.get(symbol)
        if not ob:
            return None
        bids = [BookLevel(price=float(b.p), size=float(b.s), side="buy") for b in (ob.bids or [])]
        asks = [BookLevel(price=float(a.p), size=float(a.s), side="sell") for a in (ob.asks or [])]
        bids.sort(key=lambda x: x.price, reverse=True)
        asks.sort(key=lambda x: x.price)
        best_bid = bids[0].price if bids else None
        best_ask = asks[0].price if asks else None
        spread   = (best_ask - best_bid) if best_bid and best_ask else 0
        mid      = ((best_bid + best_ask) / 2) if best_bid and best_ask else 0
        return OrderBookSnapshot(
            symbol=symbol,
            bids=bids[:20],
            asks=asks[:20],
            timestamp=str(ob.timestamp),
            spread=round(spread, 4),
            mid_price=round(mid, 4),
            best_bid=best_bid,
            best_ask=best_ask,
        )
    except Exception:
        return None

def get_bars(symbol: str, timeframe: str = "1Day", limit: int = 100) -> list[Bar]:
    _, data_client, _ = _clients()
    if not data_client:
        return []
    try:
        from alpaca.data.requests import StockBarsRequest
        from alpaca.data.timeframe import TimeFrame, TimeFrameUnit
        tf_map = {"1Min": TimeFrame.Minute, "5Min": TimeFrame(5, TimeFrameUnit.Minute), "1Hour": TimeFrame.Hour, "1Day": TimeFrame.Day}
        tf = tf_map.get(timeframe, TimeFrame.Day)
        req  = StockBarsRequest(symbol_or_symbols=symbol, timeframe=tf, limit=limit)
        resp = data_client.get_stock_bars(req)
        bars = resp.get(symbol, [])
        return [Bar(t=str(b.timestamp), o=float(b.open), h=float(b.high), l=float(b.low), c=float(b.close), v=int(b.volume), vw=float(b.vwap or b.close)) for b in bars]
    except Exception:
        return []

def get_market_movers(limit: int = 10) -> dict:
    """
    Top gainers and losers via yf.download() batch — avoids fast_info rate limiting.
    Falls back to OHLCV SQLite cache if yfinance is throttled.
    """
    UNIVERSE = [
        "AAPL","MSFT","NVDA","AMZN","GOOGL","META","TSLA","BRK-B","JPM","V",
        "UNH","XOM","LLY","JNJ","PG","MA","HD","MRK","AVGO","CVX",
        "PEP","KO","ABBV","COST","MCD","WMT","BAC","TMO","ACN","CRM",
    ]
    try:
        import yfinance as yf
        import pandas as pd
        import time

        results: list[dict] = []

        # One HTTP call for all 30 symbols
        raw = yf.download(
            tickers=UNIVERSE,
            period="5d",
            interval="1d",
            group_by="ticker",
            auto_adjust=True,
            progress=False,
            threads=True,
        )

        for sym in UNIVERSE:
            try:
                sym_u = sym.upper()
                if sym_u not in raw.columns.get_level_values(0):
                    continue
                df = raw[sym_u].dropna(how="all").dropna(subset=["Close"])
                if len(df) < 2:
                    continue
                price = float(df["Close"].iloc[-1])
                prev  = float(df["Close"].iloc[-2])
                vol   = int(df["Volume"].iloc[-1]) if "Volume" in df.columns else 0
                chg   = ((price / prev) - 1) * 100 if prev else 0
                results.append({"symbol": sym, "price": round(price, 2),
                                "change_pct": round(chg, 2), "volume": vol})
            except Exception:
                continue

        # SQLite fallback for any misses
        missed = [s for s in UNIVERSE if s not in {r["symbol"] for r in results}]
        if missed:
            try:
                from api.quant.ohlcv_store import _db_get
                for sym in missed:
                    cached = _db_get(sym, "6mo", "1d") or _db_get(sym, "1y", "1d")
                    if not cached:
                        continue
                    df, _ = cached
                    df = df.dropna(subset=["Close"])
                    if len(df) < 2:
                        continue
                    price = float(df["Close"].iloc[-1])
                    prev  = float(df["Close"].iloc[-2])
                    vol   = int(df["Volume"].iloc[-1]) if "Volume" in df.columns else 0
                    chg   = ((price / prev) - 1) * 100 if prev else 0
                    results.append({"symbol": sym, "price": round(price, 2),
                                    "change_pct": round(chg, 2), "volume": vol})
            except Exception:
                pass

        gainers = sorted(results, key=lambda x: x["change_pct"], reverse=True)[:limit]
        losers  = sorted(results, key=lambda x: x["change_pct"])[:limit]
        return {"gainers": gainers, "losers": losers}

    except Exception as e:
        return {"gainers": [], "losers": [], "error": str(e)}
