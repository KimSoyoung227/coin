"""서버와 브라우저가 공유하는 번역 사전 및 언어 URL 정보를 제공한다."""

import json
from pathlib import Path

from werkzeug.datastructures import LanguageAccept

MESSAGES = json.loads(Path(__file__).with_name("translations.json").read_text(encoding="utf-8"))
LANGUAGES = {"ko": "ko", "en": "en-US", "zh": "zh", "ja": "ja", "es": "es"}
SITE_URL = "https://coin.sykim.dev"
LANGUAGE_LINKS = (
    ("ko", "한국어", "🇰🇷"), ("en", "American English", "🇺🇸"),
    ("zh", "简体中文", "🇨🇳"), ("ja", "日本語", "🇯🇵"), ("es", "Español", "🇪🇸"),
)


def preferred_language(accepted: LanguageAccept) -> str:
    """브라우저 선호 언어를 지원 URL에 대응시키고 미지원 시 영어를 사용한다."""
    for language, quality in accepted:
        base = language.lower().replace("_", "-").split("-", 1)[0]
        if quality > 0 and base in LANGUAGES:
            return base
    return "en"


def page_context(language: str) -> dict:
    """URL 언어에 맞는 번역과 고정 도메인의 검색 메타데이터를 구성한다."""
    return {
        "page_language": language,
        "locale": LANGUAGES[language],
        "t": MESSAGES[LANGUAGES[language]].__getitem__,
        "translations": MESSAGES,
        "language_links": LANGUAGE_LINKS,
        "site_url": SITE_URL,
        "canonical_url": f"{SITE_URL}/{language}/",
    }
