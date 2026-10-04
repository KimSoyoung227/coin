"""기존 언어별 계산기를 보존하며 V2의 브라우저 계산 화면을 제공한다."""

from flask import Blueprint, abort, current_app, render_template

from coin.localization import SITE_URL

v2_pages = Blueprint("v2_pages", __name__)

# 계산 종류별 메타데이터를 한 곳에서 관리하며 자산별 URL은 복제하지 않는다.
CALCULATORS = {
    "average-price": ("평균매입단가", "추가매수 후 평균매입단가와 투자금 변화를 계산합니다."),
    "target-average": ("목표 평균단가", "목표 평균단가에 필요한 추가수량과 투자금을 역산합니다."),
    "additional-buy": ("추가매수 시뮬레이션", "추가매수 조건별 평균단가와 투자금을 표와 그래프로 비교합니다."),
}
INFO_PAGES = {
    "about": ("About", "로그인 없이 사용하는 투자 계산 도구를 소개합니다."),
    "privacy": ("개인정보처리방침", "계산 입력의 처리와 브라우저 저장 방식을 안내합니다."),
    "disclaimer": ("면책사항", "투자 계산 및 세금 추정 결과의 적용 범위를 안내합니다."),
}
V2_PATHS = ["/v2/", *[f"/calculator/{slug}" for slug in CALCULATORS],
            *[f"/{slug}" for slug in INFO_PAGES]]


def render_v2(path, title, description, calculator_slug="home", info_page=None):
    """신뢰된 도메인의 canonical과 한국어 문맥으로 공통 화면을 렌더링한다."""
    html = render_template("v2.html", calculator_slug=calculator_slug,
                           info_page=info_page, page_title=title,
                           page_description=description, canonical_url=SITE_URL + path)
    response = current_app.make_response(html)
    response.headers["Content-Language"] = "ko"
    return response


@v2_pages.get("/v2/")
def home():
    """기존 진입 URL과 독립적으로 검토 가능한 개편 메인을 제공한다."""
    return render_v2("/v2/", "투자 계산 도구", "국내주식부터 해외주식, ETF, 금, 비트코인까지. 투자 조건에 따른 결과를 계산하고 비교해보세요.")


@v2_pages.get("/calculator/<slug>")
def calculator(slug):
    """등록된 계산 종류에만 고유 URL을 제공한다."""
    if slug not in CALCULATORS:
        abort(404)
    return render_v2(f"/calculator/{slug}", *CALCULATORS[slug], calculator_slug=slug)


@v2_pages.get("/about", defaults={"slug": "about"})
@v2_pages.get("/privacy", defaults={"slug": "privacy"})
@v2_pages.get("/disclaimer", defaults={"slug": "disclaimer"})
def information(slug):
    """서비스 소개, 실제 데이터 처리 방식과 계산 결과의 한계를 안내한다."""
    return render_v2(f"/{slug}", *INFO_PAGES[slug], info_page=slug)
