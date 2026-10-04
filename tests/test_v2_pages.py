"""V2 경로, SEO, CSP 및 기존 계산기의 공존을 검증한다."""

import re
import unittest

from coin.localization import SITE_URL
from coin.v2_pages import V2_PATHS
from coin.web import create_app
from test_seo import PageParser


class V2PageTests(unittest.TestCase):
    """새 페이지의 직접 접근과 정적 모듈 전달 계약을 검사한다."""

    def setUp(self):
        """요청마다 외부 API가 필요 없는 테스트 클라이언트를 만든다."""
        self.client = create_app().test_client()

    def test_pages_have_distinct_canonical_and_security(self):
        """모든 신규 URL이 호스트 주입 없는 메타데이터와 CSP를 제공한다."""
        titles = set()
        for path in V2_PATHS:
            with self.subTest(path=path):
                response = self.client.get(path, headers={"Host": "untrusted.example"})
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.headers["Content-Language"], "ko")
                html = response.get_data(as_text=True)
                self.assertIn(f'href="{SITE_URL}{path}"', html)
                self.assertNotIn("untrusted.example", html)
                self.assertIn('property="og:title"', html)
                titles.add(re.search(r"<title>(.*?)</title>", html).group(1))
                nonce = re.search(r"'nonce-([^']+)'", response.headers["Content-Security-Policy"]).group(1)
                for script in re.findall(r"<script\b[^>]*>", html):
                    self.assertIn(f'nonce="{nonce}"', script)
        self.assertEqual(len(titles), len(V2_PATHS))

    def test_static_modules_and_unknown_calculator(self):
        """엔진과 화면 자산이 제공되고 미구현 계산기는 404를 반환한다."""
        for filename in ("v2.css", "v2.js", "v2-engine.js"):
            response = self.client.get("/static/" + filename)
            self.assertEqual(response.status_code, 200)
            response.close()
        self.assertEqual(self.client.get("/calculator/unknown").status_code, 404)

    def test_existing_entry_and_calculation_remain_available(self):
        """기존 언어 진입, 일반 계산 및 세금 화면이 유지된다."""
        self.assertEqual(self.client.get("/", headers={"Accept-Language": "ko"}).location, "/ko/")
        self.assertIn('id="tax-panel"', self.client.get("/ko/").get_data(as_text=True))
        response = self.client.post("/api/calculate", json={
            "mode": "average", "buy_price": 100, "quantity": 10,
            "additional_price": 50, "additional_quantity": 10,
        })
        self.assertEqual(response.status_code, 200)

    def test_local_form_waits_for_javascript(self):
        """모듈 로딩 실패 시 투자정보가 기본 GET 폼으로 전송되지 않게 잠근다."""
        for slug in ("average-price", "target-average", "additional-buy"):
            html = self.client.get("/calculator/" + slug).get_data(as_text=True)
            elements = PageParser(html).elements
            fieldset = next(e for e in elements if e["attrs"].get("id") == "calculator-fields")
            self.assertIn("disabled", fieldset["attrs"])
            self.assertIn("<noscript>", html)


if __name__ == "__main__":
    unittest.main()
