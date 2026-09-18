"""외부 호출을 가짜 응답으로 대체해 환산과 그룹별 캐시를 검증한다."""

import json
import unittest

from coin.market import MarketService, POUND_GRAMS, TROY_OUNCE_GRAMS


class Response:
    """urllib 응답에 필요한 최소 컨텍스트 관리자."""
    def __init__(self, data): self.data = json.dumps(data).encode()
    def __enter__(self): return self
    def __exit__(self, *_): return False
    def read(self, _size): return self.data


class MarketTests(unittest.TestCase):
    """통화 및 g 단위 환산과 60초·300초·3600초 캐시를 검증한다."""

    def setUp(self):
        self.now = 0
        self.calls = []
        def open_url(request, timeout):
            self.assertEqual(timeout, 8)
            url = request.full_url
            self.calls.append(url)
            if "exchangerate" in url:
                return Response({"rates": {"KRW": 1400, "CNY": 7, "JPY": 140,
                                            "EUR": .8, "GBP": .7}})
            symbol = url.split("/")[-2]
            return Response({"price": {"XAU": 3110.34768, "XAG": 31.1034768,
                                       "HG": 453.59237, "BTC": 100_000_000}[symbol],
                             "updatedAt": "2026-09-18T00:00:00Z"})
        self.service = MarketService(open_url, lambda: self.now)

    def test_units_and_values(self):
        """통화는 KRW/1단위, 금속은 KRW/g, BTC는 KRW/개로 반환한다."""
        data = self.service.snapshot()["groups"]
        self.assertEqual(data["currencies"]["items"]["USD"], 1400)
        self.assertEqual(data["currencies"]["items"]["JPY"], 10)
        self.assertAlmostEqual(data["metals"]["items"]["XAU"], 100)
        self.assertAlmostEqual(data["metals"]["items"]["XAG"], 1)
        self.assertAlmostEqual(data["metals"]["items"]["HG"], 1)
        self.assertEqual(data["bitcoin"]["items"]["BTC"], 100_000_000)
        self.assertEqual(TROY_OUNCE_GRAMS, 31.1034768)
        self.assertEqual(POUND_GRAMS, 453.59237)

    def test_group_cache_expiry(self):
        """각 그룹은 지정된 TTL 전에는 외부 API를 다시 호출하지 않는다."""
        self.service.snapshot()
        self.assertEqual(len(self.calls), 5)
        self.now = 59; self.service.snapshot(); self.assertEqual(len(self.calls), 5)
        self.now = 60; self.service.snapshot(); self.assertEqual(len(self.calls), 6)
        self.now = 300; self.service.snapshot(); self.assertEqual(len(self.calls), 10)
        self.now = 3600; self.service.snapshot(); self.assertEqual(len(self.calls), 15)

    def test_partial_failure(self):
        """일부 공급자가 실패해도 성공한 그룹은 반환한다."""
        def fail_exchange(request, timeout):
            if "exchangerate" in request.full_url: raise OSError("offline")
            return Response({"price": 100, "updatedAt": None})
        result = MarketService(fail_exchange).snapshot()
        self.assertIn("currencies", result["errors"])
        self.assertIn("metals", result["groups"])


if __name__ == "__main__":
    unittest.main()
