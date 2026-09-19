"""Flask 애플리케이션 설정과 기능별 Blueprint를 조립한다."""

from flask import Flask

from coin.api import api
from coin.market import MarketService
from coin.pages import pages
from coin.security import register_request_handlers


def create_app() -> Flask:
    """요청 제한, 시세 서비스, 페이지·API 경로와 공통 응답 처리를 구성한다."""
    app = Flask(__name__)
    app.config["MAX_CONTENT_LENGTH"] = 16 * 1024
    app.json.ensure_ascii = False
    app.extensions["market_service"] = MarketService()
    app.register_blueprint(pages)
    app.register_blueprint(api)
    register_request_handlers(app)
    return app
