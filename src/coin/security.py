"""요청별 CSP nonce, 공통 응답 헤더 및 HTTP 오류 처리를 등록한다."""

import secrets

from flask import Flask, g, jsonify
from werkzeug.exceptions import HTTPException


HTTP_ERROR_MESSAGES = {
    400: "올바른 JSON 요청을 보내주세요.",
    404: "요청한 경로를 찾을 수 없습니다.",
    405: "지원하지 않는 요청 방식입니다.",
    413: "입력 데이터가 너무 큽니다.",
    415: "Content-Type은 application/json이어야 합니다.",
}


def _content_security_policy(nonce: str) -> str:
    """기존 광고 허용 목록과 보안 지시문을 요청별 nonce와 결합한다."""
    return (
        "default-src 'self'; "
        # AdSense Strict CSP
        f"script-src 'nonce-{nonce}' 'unsafe-inline' 'unsafe-eval' "
        "'strict-dynamic' https://*.google.com "
        "https://*.googlesyndication.com "
        "https://googlesyndication.com "
        "https://*.adtrafficquality.google;"
        # AdSense iframe
        "frame-src 'self' https://*.google.com https://doubleclick.net "
        "https://*.googlesyndication.com "
        "https://*.adtrafficquality.google "
        "https://googleads.g.doubleclick.net; "
        # AdSense 네트워크 통신
        "connect-src 'self' https://*.google.com https://*.google-analytics.com "
        "https://*.googlesyndication.com "
        "https://*.adtrafficquality.google; "
        # 기존 보안 정책
        "object-src 'none'; "
        "base-uri 'none'; "
        "form-action 'self'; "
        "frame-ancestors 'none'; "
        # 자체 리소스
        "style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data: https://*.google.com https://*.gptimages.g.doubleclick.net "
        "https://*.googlesyndication.com "
        "https://*.adtrafficquality.google; "
    )


def register_request_handlers(app: Flask) -> None:
    """보안 정책과 오류 응답을 모든 경로에 동일하게 적용한다."""

    @app.after_request
    def response_headers(response):
        """개인 입력과 결과의 캐싱을 방지하고 기본 브라우저 보안 정책을 설정한다."""
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"

        nonce = g.get("csp_nonce", "")
        response.headers["Content-Security-Policy"] = _content_security_policy(nonce)

        response.headers["Referrer-Policy"] = "no-referrer"
        return response

    @app.errorhandler(HTTPException)
    def http_error(error):
        """잘못된 JSON, 과도한 요청 크기 등을 일관된 JSON 오류로 반환한다."""
        return jsonify(error=HTTP_ERROR_MESSAGES.get(error.code, "요청을 처리할 수 없습니다.")), error.code

    @app.before_request
    def create_csp_nonce():
        """요청마다 스크립트 허용용 CSP nonce를 생성한다."""
        g.csp_nonce = secrets.token_urlsafe(16)
