"""입력을 저장하지 않는 Flask 계산 API와 애플리케이션 팩토리."""

from dataclasses import asdict

import secrets

from flask import Flask, g, jsonify, request, render_template
from werkzeug.exceptions import HTTPException

from coin.calculations import calculate_average, calculate_profit, quantity_from_amount


def _quantity(data: dict, price_key: str, quantity_key: str, amount_key: str) -> float:
    """수량 또는 투자금액 중 정확히 하나를 받아 계산용 수량을 구한다."""
    has_quantity = quantity_key in data
    has_amount = amount_key in data
    if has_quantity == has_amount:
        raise ValueError(f"{quantity_key} 또는 {amount_key} 중 하나만 입력해주세요.")
    if has_amount:
        return quantity_from_amount(data[amount_key], data[price_key])
    return data[quantity_key]


def create_app() -> Flask:
    """요청 크기를 제한하고 계산 경로와 공통 오류 응답을 등록한다."""
    app = Flask(__name__)
    app.config["MAX_CONTENT_LENGTH"] = 16 * 1024
    app.json.ensure_ascii = False

    @app.get("/")
    def index():
        """로그인 없이 사용하는 원페이지 계산 화면을 제공한다."""
        return render_template("index.html")

    @app.after_request
    def response_headers(response):
        """개인 입력과 결과의 캐싱을 방지하고 기본 브라우저 보안 정책을 설정한다."""
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"

        nonce = g.get("csp_nonce", "")

        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            f"script-src 'nonce-{nonce}' 'unsafe-inline' 'unsafe-eval' "
            "'strict-dynamic' https: http:; "
            "object-src 'none'; "
            "base-uri 'none'; "
            "style-src 'self' 'unsafe-inline' https:; "
            "img-src 'self' data: https:; "
            "form-action 'self'; "
            "frame-ancestors 'none'"
        )
        response.headers["Referrer-Policy"] = "no-referrer"
        return response

    @app.errorhandler(HTTPException)
    def http_error(error):
        """잘못된 JSON, 과도한 요청 크기 등을 일관된 JSON 오류로 반환한다."""
        messages = {
            400: "올바른 JSON 요청을 보내주세요.",
            404: "요청한 경로를 찾을 수 없습니다.",
            405: "지원하지 않는 요청 방식입니다.",
            413: "입력 데이터가 너무 큽니다.",
            415: "Content-Type은 application/json이어야 합니다.",
        }
        return jsonify(error=messages.get(error.code, "요청을 처리할 수 없습니다.")), error.code

    @app.post("/api/calculate")
    def calculate():
        """수익률/물타기/불타기를 계산하며 입력과 결과를 서버에 보관하지 않는다."""
        data = request.get_json()
        if not isinstance(data, dict):
            return jsonify(error="JSON 객체를 입력해주세요."), 400
        try:
            mode = data.get("mode", "profit")
            if mode not in ("profit", "down", "up"):
                raise ValueError("올바른 계산 탭을 선택해주세요.")
            quantity = _quantity(data, "buy_price", "quantity", "amount")
            if mode == "profit":
                result = calculate_profit(
                    data["buy_price"], data["sell_price"], quantity, data.get("fee_percent", 0.0)
                )
            else:
                additional_quantity = _quantity(
                    data, "additional_price", "additional_quantity", "additional_amount"
                )
                result = calculate_average(
                    data["buy_price"], quantity, data["additional_price"], additional_quantity, mode
                )
        except KeyError:
            return jsonify(error="필수 입력 항목이 누락되었습니다."), 400
        except ValueError as error:
            return jsonify(error=str(error)), 400
        return jsonify(mode=mode, result=asdict(result))

    @app.before_request
    def create_csp_nonce():
        g.csp_nonce = secrets.token_urlsafe(16)

    return app

