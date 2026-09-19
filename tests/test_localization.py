"""언어 우선순위와 번역 사전의 서버 렌더링 데이터를 검증한다."""

import unittest
from werkzeug.datastructures import LanguageAccept
from werkzeug.http import parse_accept_header
from coin.localization import LANGUAGES, MESSAGES, page_context, preferred_language


class LocalizationTests(unittest.TestCase):
    """지역별 언어 변형과 기본 언어 선택의 회귀를 방지한다."""

    def test_language_negotiation(self):
        """품질 가중치, 지역 코드, 미지원 및 누락 헤더를 처리한다."""
        for header, expected in [("ko-KR, en;q=0.8", "ko"), ("en-GB", "en"),
                                 ("zh-TW", "zh"), ("es-MX", "es"),
                                 ("ko;q=0.2,ja;q=0.9", "ja"), ("de", "en"),
                                 ("", "en"), ("ko;q=0,en;q=1", "en")]:
            with self.subTest(header=header):
                self.assertEqual(preferred_language(parse_accept_header(header, LanguageAccept)), expected)

    def test_translation_keys_and_context(self):
        """모든 언어가 동일한 번역 키와 자기 언어의 canonical을 제공한다."""
        keys = set(MESSAGES["ko"])
        for code, locale in LANGUAGES.items():
            self.assertEqual(set(MESSAGES[locale]), keys)
            context = page_context(code)
            self.assertEqual(context["t"]("pageTitle"), MESSAGES[locale]["pageTitle"])
            self.assertEqual(context["canonical_url"], f"https://coin.sykim.dev/{code}/")
