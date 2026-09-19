"""입력을 저장하지 않는 Flask 계산 API와 애플리케이션 팩토리."""

from dataclasses import asdict

import secrets

from flask import Flask, Response, abort, g, jsonify, redirect, request, render_template, url_for
from werkzeug.exceptions import HTTPException

from coin.calculations import calculate_average, calculate_profit, quantity_from_amount
from coin.market import MarketService
from coin.localization import LANGUAGES, SITE_URL, page_context, preferred_language


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
    market_service = MarketService()
    app.extensions["market_service"] = market_service

    @app.get("/")
    def index():
        """브라우저 선호 언어에 따라 언어별 페이지로 임시 이동한다."""
        response = redirect(url_for("localized_index", language=preferred_language(request.accept_languages)), code=302)
        response.vary.add("Accept-Language")
        return response

    @app.get("/<language>/")
    def localized_index(language):
        """명시된 URL의 언어로 검색 가능한 계산기 HTML을 렌더링한다."""
        if language not in LANGUAGES:
            abort(404)
        response = app.make_response(render_template("index.html", **page_context(language)))
        response.headers["Content-Language"] = language
        return response

    @app.get("/sitemap.xml")
    def sitemap():
        """각 언어 URL과 상호 대체 언어 링크를 XML 사이트맵으로 제공한다."""
        return Response(render_template("sitemap.xml", languages=LANGUAGES, site_url=SITE_URL), mimetype="application/xml")

    @app.get("/robots.txt")
    def robots():
        """검색 로봇에 공개 페이지와 사이트맵 위치를 안내한다."""
        return Response(f"User-agent: *\nAllow: /\nSitemap: {SITE_URL}/sitemap.xml\n", mimetype="text/plain")

    @app.after_request
    def response_headers(response):
        """개인 입력과 결과의 캐싱을 방지하고 기본 브라우저 보안 정책을 설정한다."""
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"

        nonce = g.get("csp_nonce", "")
        response.headers["Content-Security-Policy"] = (
                "default-src 'self'; "
            
                # AdSense Strict CSP
                f"script-src 'nonce-{nonce}' 'unsafe-inline' 'unsafe-eval' "
                "'strict-dynamic' https://*.google.com https://*.googlesyndication.com https://googlesyndication.com https://*.adtrafficquality.google;"
                # AdSense iframe
                "frame-src 'self' https://*.google.com https://doubleclick.net https://*.googlesyndication.com https://*.adtrafficquality.google https://googleads.g.doubleclick.net; "
                # AdSense 네트워크 통신
                "connect-src 'self' https://*.google.com https://*.google-analytics.com https://*.googlesyndication.com https://*.adtrafficquality.google; "
            
                # 기존 보안 정책
                "object-src 'none'; "
                "base-uri 'none'; "
                "form-action 'self'; "
                "frame-ancestors 'none'; "
                
                # 자체 리소스
                "style-src 'self' 'unsafe-inline'; "
                "img-src 'self' data: https://*.google.com https://*.gptimages.g.doubleclick.net https://*.googlesyndication.com https://*.adtrafficquality.google; "
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
        """수익률 또는 추가 매수 평균 단가를 계산하며 결과를 저장하지 않는다."""
        data = request.get_json()
        if not isinstance(data, dict):
            return jsonify(error="JSON 객체를 입력해주세요."), 400
        try:
            mode = data.get("mode", "profit")
            if mode not in ("profit", "average"):
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
                    data["buy_price"], quantity, data["additional_price"], additional_quantity
                )
        except KeyError:
            return jsonify(error="필수 입력 항목이 누락되었습니다."), 400
        except ValueError as error:
            return jsonify(error=str(error)), 400
        return jsonify(mode=mode, result=asdict(result))

    @app.get("/api/market-rates")
    def market_rates():
        """캐시된 환율·원자재·비트코인 가격과 조회 완료 시각을 제공한다."""
        result = app.extensions["market_service"].snapshot()
        status = 200 if result["groups"] else 503
        return jsonify(result), status

    @app.before_request
    def create_csp_nonce():
        """요청마다 스크립트 허용용 CSP nonce를 생성한다."""
        g.csp_nonce = secrets.token_urlsafe(16)


    @app.get("/ads.txt")
    def ads_txt():
        """광고 판매자 정보를 정적 파일로 제공한다."""
        return app.send_static_file("ads.txt")

    return app
