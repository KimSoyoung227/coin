"""Flask 테스트 클라이언트로 계산 API와 HTTP 입력 경계를 검증한다."""

import json
import unittest
from html.parser import HTMLParser

from coin.web import create_app


class FormControlParser(HTMLParser):
    """폼 메서드를 가릴 수 있는 컨트롤의 id/name을 수집한다."""

    def __init__(self):
        """파서와 수집 목록을 초기화한다."""
        super().__init__()
        self.identifiers = []

    def handle_starttag(self, tag, attrs):
        """브라우저에서 폼의 이름 기반 속성이 되는 식별자를 기록한다."""
        if tag in ("input", "button", "select", "textarea", "fieldset", "output"):
            self.identifiers.extend(value for key, value in attrs if key in ("id", "name"))


class WebTests(unittest.TestCase):
    """실제 HTTP 직렬화, 금액 환산, 오류 응답 및 비저장 정책 테스트."""

    def setUp(self):
        """각 테스트에 독립적인 앱과 클라이언트를 만든다."""
        self.app = create_app()
        self.app.config["TESTING"] = True
        self.client = self.app.test_client()

    def test_profit_using_amount(self):
        """투자금액 입력을 수량으로 환산하고 순손익을 반환한다."""
        response = self.client.post("/api/calculate", json={
            "buy_price": 100, "sell_price": 120, "amount": 200, "fee_percent": 0.1
        })
        self.assertEqual(response.status_code, 200)
        self.assertAlmostEqual(response.json["result"]["profit"], 39.56)
        self.assertEqual(response.headers["Cache-Control"], "no-store")
        self.assertNotIn("Set-Cookie", response.headers)

    def test_page_and_assets(self):
        """한국어 화면과 계산기에 필요한 정적 자산이 제공되는지 확인한다."""
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        self.assertIn('암호화폐 수익률 계산기', response.get_data(as_text=True))
        self.assertIn('role="tablist"', response.get_data(as_text=True))
        for asset in ("app.js", "session.js", "style.css"):
            with self.subTest(asset=asset):
                response = self.client.get("/static/" + asset)
                self.assertEqual(response.status_code, 200)
                response.close()

    def test_form_controls_do_not_shadow_methods(self):
        """탭 전환에 쓰는 form.reset 등이 컨트롤에 가려지는 회귀를 방지한다."""
        parser = FormControlParser()
        parser.feed(self.client.get("/").get_data(as_text=True))
        for reserved in ("reset", "submit", "elements", "requestSubmit", "checkValidity"):
            self.assertNotIn(reserved, parser.identifiers)

    def test_average_modes(self):
        """추가 매수금액과 수량 입력을 모두 지원한다."""
        for mode, price, expected in (("down", 50, 75), ("up", 150, 125)):
            with self.subTest(mode=mode):
                response = self.client.post("/api/calculate", json={
                    "mode": mode, "buy_price": 100, "quantity": 2,
                    "additional_price": price, "additional_amount": price * 2
                })
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json["result"]["average_price"], expected)

    def test_bad_inputs(self):
        """누락, 중복, 잘못된 자료형 및 비정상 숫자는 400으로 처리한다."""
        base = {"buy_price": 100, "sell_price": 120, "quantity": 2}
        for payload in (None, [], {}, dict(base, amount=200), dict(base, quantity=None),
                        dict(base, mode=[]), dict(base, buy_price="NaN"),
                        dict(base, buy_price=True), dict(base, quantity=1e308)):
            with self.subTest(payload=payload):
                response = self.client.post("/api/calculate", data=json.dumps(payload),
                                            content_type="application/json")
                self.assertEqual(response.status_code, 400)
                self.assertIn("error", response.json)

    def test_http_errors(self):
        """잘못된 JSON, 미지원 형식/메서드, 대용량 요청을 거부한다."""
        self.assertEqual(self.client.post("/api/calculate", data="{",
                                         content_type="application/json").status_code, 400)
        self.assertEqual(self.client.post("/api/calculate", data="text").status_code, 415)
        self.assertEqual(self.client.get("/api/calculate").status_code, 405)
        self.assertEqual(self.client.post("/api/calculate", data=" " * 17000,
                                         content_type="application/json").status_code, 413)


if __name__ == "__main__":
    unittest.main()
