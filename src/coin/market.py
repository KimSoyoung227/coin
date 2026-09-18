"""무료 공개 API의 환율·원자재 가격을 검증하고 메모리에 캐시한다."""

from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor, as_completed
import json
from math import isfinite
from threading import Lock
from time import monotonic
from urllib.request import Request, urlopen

TROY_OUNCE_GRAMS = 31.1034768
POUND_GRAMS = 453.59237
EXCHANGE_URL = "https://api.exchangerate.fun/latest?base=USD"
GOLD_URL = "https://api.gold-api.com/price/{symbol}/KRW"


def _positive(value, label: str) -> float:
    """외부 응답의 가격이 유한한 양수인지 확인한다."""
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError) as exc:
        raise ValueError(f"{label} 가격 형식이 올바르지 않습니다.") from exc
    if not isfinite(number) or number <= 0:
        raise ValueError(f"{label} 가격이 올바르지 않습니다.")
    return number


class MarketService:
    """그룹별 만료 시간이 다른 시세 데이터를 프로세스 메모리에 저장한다."""

    def __init__(self, opener=urlopen, clock=monotonic):
        self._opener = opener
        self._clock = clock
        self._cache = {}
        self._locks = {name: Lock() for name in ("currencies", "metals", "bitcoin")}

    def _json(self, url: str) -> dict:
        """시간 제한과 응답 크기 제한을 적용해 외부 JSON을 읽는다."""
        request = Request(url, headers={"User-Agent": "coin-calculator/0.5"})
        with self._opener(request, timeout=8) as response:
            payload = response.read(256 * 1024 + 1)
        if len(payload) > 256 * 1024:
            raise ValueError("외부 API 응답이 너무 큽니다.")
        data = json.loads(payload)
        if not isinstance(data, dict):
            raise ValueError("외부 API 응답 형식이 올바르지 않습니다.")
        return data

    def _cached(self, key: str, ttl: int, loader):
        """유효한 캐시를 반환하고 만료 시 한 번만 새 데이터를 조회한다."""
        with self._locks[key]:
            cached = self._cache.get(key)
            if cached and self._clock() < cached["expires"]:
                return cached["data"]
            try:
                data = loader()
            except Exception:
                if cached:
                    stale = dict(cached["data"])
                    stale["stale"] = True
                    return stale
                raise
            self._cache[key] = {"expires": self._clock() + ttl, "data": data}
            return data

    @staticmethod
    def _completed_at() -> str:
        """사용자에게 노출할 조회 완료 시각을 UTC ISO 형식으로 반환한다."""
        return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    def currencies(self) -> dict:
        """USD 기준 응답을 1단위당 KRW 가격으로 바꿔 한 시간 캐시한다."""
        def load():
            data = self._json(EXCHANGE_URL)
            rates = data.get("rates")
            if not isinstance(rates, dict):
                raise ValueError("환율 목록이 없습니다.")
            krw = _positive(rates.get("KRW"), "KRW")
            values = {"KRW": 1.0}
            for code in ("USD", "CNY", "JPY", "EUR", "GBP"):
                rate = 1.0 if code == "USD" else _positive(rates.get(code), code)
                values[code] = krw / rate
            return {"items": values, "completed_at": self._completed_at(), "stale": False}
        return self._cached("currencies", 3600, load)

    def metals(self) -> dict:
        """금·은의 트로이온스 및 구리의 파운드 가격을 KRW/g으로 환산한다."""
        def load():
            divisors = {"XAU": TROY_OUNCE_GRAMS, "XAG": TROY_OUNCE_GRAMS, "HG": POUND_GRAMS}
            def fetch(symbol):
                data = self._json(GOLD_URL.format(symbol=symbol))
                return symbol, _positive(data.get("price"), symbol) / divisors[symbol], data.get("updatedAt")
            values, source_times = {}, {}
            with ThreadPoolExecutor(max_workers=3) as executor:
                for future in as_completed(executor.submit(fetch, symbol) for symbol in divisors):
                    symbol, price, updated = future.result()
                    values[symbol], source_times[symbol] = price, updated
            return {"items": values, "source_updated_at": source_times,
                    "completed_at": self._completed_at(), "stale": False}
        return self._cached("metals", 300, load)

    def bitcoin(self) -> dict:
        """원화 기준 비트코인 1개 가격을 1분 캐시한다."""
        def load():
            data = self._json(GOLD_URL.format(symbol="BTC"))
            return {"items": {"BTC": _positive(data.get("price"), "BTC")},
                    "source_updated_at": {"BTC": data.get("updatedAt")},
                    "completed_at": self._completed_at(), "stale": False}
        return self._cached("bitcoin", 60, load)

    def snapshot(self) -> dict:
        """각 캐시 그룹의 최신 스냅샷을 한 응답으로 합친다."""
        groups, errors = {}, []
        getters = {"currencies": self.currencies, "metals": self.metals, "bitcoin": self.bitcoin}
        with ThreadPoolExecutor(max_workers=3) as executor:
            pending = {executor.submit(getter): name for name, getter in getters.items()}
            for future in as_completed(pending):
                name = pending[future]
                try:
                    groups[name] = future.result()
                except Exception:
                    errors.append(name)
        return {"groups": groups, "errors": errors}
