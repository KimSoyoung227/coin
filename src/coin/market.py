"""무료 공개 API의 환율·원자재 가격을 검증하고 메모리에 캐시한다."""

import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from math import isfinite
from threading import Lock
from time import monotonic
from urllib.request import Request, urlopen

TROY_OUNCE_GRAMS = 31.1034768
POUND_GRAMS = 453.59237
EXCHANGE_URL = "https://api.exchangerate.fun/latest?base=USD"
GOLD_URL = "https://api.gold-api.com/price/{symbol}/KRW"
CACHE_TTL_SECONDS = {"currencies": 3600, "metals": 300, "bitcoin": 60}
METAL_GRAMS = {"XAU": TROY_OUNCE_GRAMS, "XAG": TROY_OUNCE_GRAMS, "HG": POUND_GRAMS}
MAX_RESPONSE_BYTES = 256 * 1024


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
        """조회 함수와 시계를 주입하고 그룹별 캐시 및 잠금을 초기화한다."""
        self._opener = opener
        self._clock = clock
        self._cache = {}
        self._locks = {name: Lock() for name in CACHE_TTL_SECONDS}

    def _json(self, url: str) -> dict:
        """시간 제한과 응답 크기 제한을 적용해 외부 JSON을 읽는다."""
        request = Request(url, headers={"User-Agent": "coin-calculator/0.5"})
        with self._opener(request, timeout=8) as response:
            payload = response.read(MAX_RESPONSE_BYTES + 1)
        if len(payload) > MAX_RESPONSE_BYTES:
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

    def _group_data(self, items: dict, source_times=None) -> dict:
        """조회 결과에 공통 완료 시각과 캐시 상태를 붙인다."""
        data = {"items": items}
        if source_times is not None:
            data["source_updated_at"] = source_times
        data.update(completed_at=self._completed_at(), stale=False)
        return data

    def _fetch_price(self, symbol: str, divisor: float = 1.0) -> tuple:
        """단일 자산의 가격을 검증하고 지정 단위로 환산한다."""
        data = self._json(GOLD_URL.format(symbol=symbol))
        price = _positive(data.get("price"), symbol) / divisor
        return symbol, price, data.get("updatedAt")

    def _load_currencies(self) -> dict:
        """USD 기준 환율을 각 통화 1단위당 원화 가격으로 정규화한다."""
        data = self._json(EXCHANGE_URL)
        rates = data.get("rates")
        if not isinstance(rates, dict):
            raise ValueError("환율 목록이 없습니다.")
        krw = _positive(rates.get("KRW"), "KRW")
        values = {"KRW": 1.0}
        for code in ("USD", "CNY", "JPY", "EUR", "GBP"):
            rate = 1.0 if code == "USD" else _positive(rates.get(code), code)
            values[code] = krw / rate
        return self._group_data(values)

    def _load_metals(self) -> dict:
        """금·은·구리 시세를 병렬 조회하고 g당 가격과 갱신 시각을 모은다."""
        values, source_times = {}, {}
        with ThreadPoolExecutor(max_workers=3) as executor:
            pending = [
                executor.submit(self._fetch_price, symbol, divisor)
                for symbol, divisor in METAL_GRAMS.items()
            ]
            for future in as_completed(pending):
                symbol, price, updated = future.result()
                values[symbol], source_times[symbol] = price, updated
        return self._group_data(values, source_times)

    def _load_bitcoin(self) -> dict:
        """비트코인 1개 가격과 공급자 갱신 시각을 조회한다."""
        symbol, price, updated = self._fetch_price("BTC")
        return self._group_data({symbol: price}, {symbol: updated})

    def currencies(self) -> dict:
        """원화 기준 통화 가격을 한 시간 캐시한다."""
        return self._cached("currencies", CACHE_TTL_SECONDS["currencies"], self._load_currencies)

    def metals(self) -> dict:
        """원화 기준 금속 g당 가격을 5분 캐시한다."""
        return self._cached("metals", CACHE_TTL_SECONDS["metals"], self._load_metals)

    def bitcoin(self) -> dict:
        """원화 기준 비트코인 가격을 1분 캐시한다."""
        return self._cached("bitcoin", CACHE_TTL_SECONDS["bitcoin"], self._load_bitcoin)

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
