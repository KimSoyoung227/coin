"""언어별 HTML, 사이트맵 및 공개 정적 문서 경로를 제공한다."""

from flask import (
    Blueprint,
    Response,
    abort,
    current_app,
    redirect,
    render_template,
    request,
    url_for,
)

from coin.localization import LANGUAGES, SITE_URL, page_context, preferred_language

pages = Blueprint("pages", __name__)



@pages.get("/")
def index():
    """브라우저 선호 언어에 따라 언어별 페이지로 임시 이동한다."""
    language = preferred_language(request.accept_languages)
    response = redirect(url_for("pages.localized_index", language=language), code=302)
    response.vary.add("Accept-Language")
    return response


@pages.get("/<language>/")
def localized_index(language):
    """명시된 URL의 언어로 검색 가능한 계산기 HTML을 렌더링한다."""
    if language not in LANGUAGES:
        abort(404)
    html = render_template("index.html", **page_context(language))
    response = current_app.make_response(html)
    response.headers["Content-Language"] = language
    return response


@pages.get("/sitemap.xml")
def sitemap():
    """각 언어 URL과 상호 대체 언어 링크를 XML 사이트맵으로 제공한다."""
    xml = render_template("sitemap.xml", languages=LANGUAGES, site_url=SITE_URL)
    return Response(xml, mimetype="application/xml")


@pages.get("/robots.txt")
def robots():
    """검색 로봇에 공개 페이지와 사이트맵 위치를 안내한다."""
    content = f"User-agent: *\nAllow: /\nSitemap: {SITE_URL}/sitemap.xml\n"
    return Response(content, mimetype="text/plain")


@pages.get("/ads.txt")
def ads_txt():
    """광고 판매자 정보를 정적 파일로 제공한다."""
    return current_app.send_static_file("ads.txt")
