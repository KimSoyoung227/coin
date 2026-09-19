"""JavaScript 실행 전 언어별 HTML과 검색 엔진용 URL 관계를 검증한다."""

import json
import unittest
from html.parser import HTMLParser
from xml.etree import ElementTree

from coin.localization import LANGUAGES, MESSAGES, SITE_URL
from coin.web import create_app


class PageParser(HTMLParser):
    """메타데이터, 링크 및 서버가 렌더링한 요소별 텍스트를 수집한다."""

    def __init__(self, html):
        """HTML을 읽고 태그와 직접 포함된 텍스트를 기록한다."""
        super().__init__()
        self.elements = []
        self.stack = []
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        """시작 태그를 기록하며 void 요소는 스택에서 제외한다."""
        element = {"tag": tag, "attrs": dict(attrs), "text": ""}
        self.elements.append(element)
        if tag not in {"meta", "link", "input", "br", "hr", "img"}:
            self.stack.append(element)

    def handle_endtag(self, tag):
        """종료된 요소를 스택에서 제거한다."""
        if self.stack and self.stack[-1]["tag"] == tag:
            self.stack.pop()

    def handle_data(self, data):
        """현재 요소의 본문을 누적한다."""
        if self.stack:
            self.stack[-1]["text"] += data


class SeoTests(unittest.TestCase):
    """언어별 직접 접근, 리디렉션 및 상호 검색 링크를 검사한다."""

    def setUp(self):
        """독립된 Flask 클라이언트를 생성한다."""
        self.client = create_app().test_client()

    def test_root_redirects_only_by_preferred_language(self):
        """선호 언어에 맞게 임시 이동하고 미지원 언어는 영어로 이동한다."""
        for header, expected in [("ko-KR,en;q=0.5", "ko"), ("ja", "ja"),
                                 ("zh-CN", "zh"), ("es-MX", "es"),
                                 ("en-GB", "en"), ("fr-FR", "en"), ("", "en")]:
            response = self.client.get("/", headers={"Accept-Language": header})
            self.assertEqual(response.status_code, 302)
            self.assertEqual(response.location, f"/{expected}/")
            self.assertIn("Accept-Language", response.vary)
        self.assertEqual(self.client.get("/de/").status_code, 404)
        self.assertEqual(self.client.get("/ja").status_code, 308)

    def test_all_pages_render_localized_content_and_links(self):
        """본문·메타·접근성 문구가 JS 없이 번역되며 URL이 언어를 결정한다."""
        for language, locale in LANGUAGES.items():
            with self.subTest(language=language):
                response = self.client.get(f"/{language}/", headers={"Accept-Language": "de", "Host": "untrusted.example"})
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.headers["Content-Language"], language)
                elements = PageParser(response.get_data(as_text=True)).elements
                dictionary = MESSAGES[locale]
                self.assertEqual(next(e for e in elements if e["tag"] == "html")["attrs"]["lang"], language)
                self.assertEqual(next(e for e in elements if e["tag"] == "title")["text"], dictionary["pageTitle"])
                self.assertEqual(next(e for e in elements if e["tag"] == "h1")["text"], dictionary["heroTitle"])
                for element in elements:
                    attrs = element["attrs"]
                    for marker, target in [("data-i18n", None), ("data-i18n-content", "content"), ("data-i18n-aria", "aria-label")]:
                        if marker in attrs:
                            value = attrs[target] if target else element["text"]
                            self.assertEqual(value, dictionary[attrs[marker]])
                links = [e["attrs"] for e in elements if e["tag"] == "link"]
                self.assertEqual([l["href"] for l in links if l.get("rel") == "canonical"], [f"{SITE_URL}/{language}/"])
                alternates = {l["hreflang"]: l["href"] for l in links if l.get("rel") == "alternate"}
                self.assertEqual(alternates, {**{code: f"{SITE_URL}/{code}/" for code in LANGUAGES}, "x-default": SITE_URL + "/"})
                flags = [e["attrs"] for e in elements if e["tag"] == "a" and "data-lang" in e["attrs"]]
                self.assertEqual(len(flags), 5)
                self.assertEqual([a["hreflang"] for a in flags if a.get("aria-current") == "page"], [language])
                for link in flags:
                    self.assertEqual(link["href"], f'/{link["hreflang"]}/')
                embedded = next(e["attrs"]["data-messages"] for e in elements if e["attrs"].get("id") == "translations")
                self.assertEqual(json.loads(embedded), MESSAGES)

    def test_sitemap_and_robots(self):
        """사이트맵 URL과 상호 대체 링크가 실제 제공되는 페이지를 가리킨다."""
        response = self.client.get("/sitemap.xml")
        self.assertEqual(response.mimetype, "application/xml")
        root = ElementTree.fromstring(response.data)
        ns = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9", "x": "http://www.w3.org/1999/xhtml"}
        entries = root.findall("s:url", ns)
        self.assertEqual(len(entries), 5)
        self.assertEqual({entry.find("s:loc", ns).text for entry in entries}, {f"{SITE_URL}/{code}/" for code in LANGUAGES})
        for entry in entries:
            links = {link.attrib["hreflang"]: link.attrib["href"] for link in entry.findall("x:link", ns)}
            self.assertEqual(links, {**{code: f"{SITE_URL}/{code}/" for code in LANGUAGES}, "x-default": SITE_URL + "/"})
        robots = self.client.get("/robots.txt")
        self.assertEqual(robots.mimetype, "text/plain")
        self.assertIn(f"Sitemap: {SITE_URL}/sitemap.xml", robots.get_data(as_text=True))
