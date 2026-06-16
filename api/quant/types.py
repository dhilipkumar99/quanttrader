"""Shared type definitions for market data and broker integration."""
from dataclasses import dataclass, field
from typing import Optional, Literal

@dataclass
class BookLevel:
    price: float
    size: float
    side: Literal["buy", "sell"]

@dataclass
class OrderBookSnapshot:
    symbol: str
    bids: list[BookLevel]
    asks: list[BookLevel]
    timestamp: str
    spread: float
    mid_price: float
    best_bid: Optional[float]
    best_ask: Optional[float]

@dataclass
class Trade:
    id: str
    symbol: str
    price: float
    size: float
    side: Literal["buy", "sell"]
    timestamp: str
    conditions: list[str] = field(default_factory=list)

@dataclass
class Bar:
    t: str
    o: float
    h: float
    l: float
    c: float
    v: int
    vw: float

@dataclass
class BrokerOrder:
    id: str
    symbol: str
    side: str
    qty: float
    order_type: str
    status: str
    filled_qty: float
    filled_avg_price: Optional[float]
    limit_price: Optional[float]
    created_at: str

@dataclass
class BrokerPosition:
    symbol: str
    qty: float
    avg_entry_price: float
    current_price: float
    market_value: float
    unrealized_pl: float
    unrealized_plpc: float
    side: str

@dataclass
class BrokerAccount:
    id: str
    status: str
    currency: str
    cash: float
    portfolio_value: float
    buying_power: float
    equity: float
    last_equity: float
    day_trade_count: int
    pattern_day_trader: bool
    trading_blocked: bool
    paper: bool
