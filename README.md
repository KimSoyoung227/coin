# coin

로그인 없는 반응형 암호화폐 계산기. 수익률과 추가 매수 후 평균 단가 계산을 지원합니다.

- `src/coin/taxes.py`: 세금 입력 검증·FIFO/평균 원가 배분·국가별 예상세액
- `src/coin/data/tax_rules.json`: 과세연도별 규칙·공식 출처·최종 확인일
- `src/coin/tax_ui.py`, `src/coin/templates/tax.html`: 조건부 입력 정의·세금 폼
- `src/coin/static/tax.js`: 세금 입력·결과·계산식·세션 연결
- `tests/test_taxes.py`, `tests/test_tax_ui.mjs`: 세율 경계·입력·UI 상태 검증
- `TAX_RULES.md`: 검증 출처 및 지원 범위
- `src/coin/calculations.py`: 손익, 수익률, 추가 매수 평균 단가 계산
- `tests/test_calculations.py`: 계산 및 입력 검증 테스트
- `src/coin/web.py`: Flask 앱 팩토리와 Blueprint 등록
- `src/coin/pages.py`: 언어별 페이지·SEO·공개 문서 경로
- `src/coin/api.py`: 계산 입력 검증과 계산·시세 JSON API
- `src/coin/security.py`: 요청별 CSP nonce·공통 응답 헤더·HTTP 오류 처리
- `src/coin/localization.py`: 선호 언어 선택 및 서버 번역 컨텍스트
- `src/coin/translations.json`: 서버·브라우저 공통 6개 언어 사전
- `src/coin/templates/sitemap.xml`: 언어별 URL 및 대체 언어 사이트맵
- `tests/test_localization.py`, `tests/test_seo.py`: 언어 선택·서버 렌더링·SEO 검증
- `tests/test_page_language.mjs`: URL 언어·세션·매도 버튼·입력 저장·요청 본문 검증
- `tests/test_rates.mjs`: 시세 표시·기준 통화 환산·캐시 안내·오류 검증
- `tests/test_web.py`: API 통합 테스트
- `pyproject.toml`: 패키지 구조 및 필수 의존성
- `requirements.txt`: 검증한 의존성 버전
- `src/coin/__main__.py`: 기본 포트 5050의 로컬 실행 진입점
- `src/coin/templates/index.html`: 원페이지 화면
- `src/coin/static/style.css`: 반응형 레이아웃 및 화면 여백
- `src/coin/static/app.js`: 탭·입력·계산 요청·세션 복원
- `src/coin/static/formatting.js`: 계산기·시세 공통 표시 로케일
- `src/coin/static/session.js`: 브라우저 세션 보관 및 1시간 만료
- `src/coin/market.py`: 환율·금속·비트코인 조회, 단위 환산 및 메모리 캐시
- `src/coin/static/rates.js`: 반응형 시세 표 표시 및 1분 갱신
- `tests/test_session.mjs`: 저장 및 만료 검증 (Node.js 사용, 추가 패키지 없음)
- `AGENTS.md`: 개발·검토·주석·보안·커밋 규칙
- `WORK_LOG.md`: 날짜순 작업 일지

Python 3.9 이상에서 프로젝트 루트를 기준으로 테스트합니다.

```sh
PYTHONPATH=src .venv/bin/python -m unittest discover -s tests -v
```

PyCharm에서는 `src`를 Sources Root로 지정하고 Python 인터프리터를 `.venv/bin/python`으로 선택합니다. Run/Debug Configuration의 Module name을 `coin`, Working directory를 프로젝트 루트로 설정하면 실행 버튼으로 시작할 수 있습니다.

설치: `.venv/bin/python -m pip install -c requirements.txt -e .`

개발 서버 실행: `PYTHONPATH=src .venv/bin/python -m coin`
브라우저에서 http://127.0.0.1:5050 을 열면 됩니다. 개발 서버는 배포용이 아닙니다.

macOS AirPlay 서비스와의 포트 충돌을 피하도록 기본 포트를 5050으로 설정했습니다. 다른 포트가 필요하면 실행 명령 끝에 `--port 5051`처럼 지정하세요.

입력은 탭별로 sessionStorage에 저장되며 새로고침 시 복원됩니다. 최초 저장 후 1시간이 지나면 전체 입력과 결과를 삭제하며, 입력 수정으로 보관 시간을 연장하지 않습니다. 브라우저가 백그라운드 타이머를 중단하면 복귀 시 즉시 만료를 확인합니다. 저장소가 차단된 브라우저에서도 계산은 가능하지만 새로고침 시 복원되지 않습니다. 서버와 DB에는 입력을 보관하지 않습니다.

세션 테스트: `node tests/test_session.mjs`

계산 API는 JSON 객체를 받습니다. `mode`는 `profit`(기본) 또는 `average`입니다.
환율·시세는 `GET /api/market-rates`에서 원화 기준으로 제공됩니다. BTC는 1분, 금·은·구리는 5분, 통화는 1시간 동안 프로세스 메모리에 캐시되며 DB는 사용하지 않습니다.
공통 입력은 `buy_price`와 `quantity` 또는 `amount` 중 하나입니다.
수익률은 `sell_price`, 선택 항목 `fee_percent`(기본 0%)를 받습니다.
평균 단가 계산은 `mode=average`, `additional_price`와 `additional_quantity` 또는 `additional_amount` 중 하나를 받습니다.
성공 응답은 `mode`, `result`이고 입력 오류는 HTTP 400의 `error`입니다.

언어별 페이지는 `/ko/`, `/en/`, `/ja/`, `/zh/`, `/es/`, `/de/`로 제공합니다. `/`는 브라우저의 `Accept-Language` 우선순위에 따라 임시 이동(302)하며 지원 언어가 없으면 `/en/`으로 이동합니다. IP 기반 국가 조회는 하지 않습니다. 직접 방문한 언어 URL은 브라우저 언어와 세션의 이전 언어보다 우선합니다.

국기 아이콘은 언어별 URL 링크이며 계산 입력은 기존 세션에서 복원합니다. 페이지 제목, 메타 설명, 제목·설명·레이블은 서버에서 번역합니다. canonical과 hreflang(6개 언어 및 x-default), `/sitemap.xml`, `/robots.txt`는 공개 도메인 `https://coin.sykim.dev`를 기준으로 생성합니다. 도메인 변경 시 `src/coin/localization.py`의 `SITE_URL`을 변경하세요. 새 DB와 패키지는 필요하지 않습니다.

프런트엔드 검증: `node tests/test_i18n.mjs`, `node tests/test_session.mjs`, `node tests/test_page_language.mjs`, `node tests/test_rates.mjs`.


세금 계산 탭은 표시 언어와 독립적으로 세법상 거주 국가를 선택합니다. 6개국의 2026년 규칙과 한국 암호자산의 2027년 예정 규칙을 제공합니다. 미검증 국가·연도는 계산 대신 검토 필요 상태를 표시합니다. 세법 확인일은 2026-09-20이며 자동 갱신 기능은 포함하지 않습니다.

`POST /api/tax/calculate`는 `country`, `year`, `asset`, `market`, `lots` 및 처분·소득 정보를 받습니다. 각 취득·처분 당시 환율은 직접 입력하며 현재 시세를 대신 적용하지 않습니다. 취득 내역은 동일 자산의 미처분 잔여 로트로 입력하고, 연간 다른 거래는 허용되는 분류별 손익으로 합산합니다. 일본은 사용자가 확인한 총평균/신고된 이동평균 원가 풀을 사용합니다. 세무 장부나 모든 과거 거래를 자동 복원하지 않습니다.

세액은 참고 추정입니다. 주·지방세와 개인별 공제의 일부, 외국납부세액공제·조세조약은 별도 검토합니다. 외국 납부액을 넣더라도 자동 공제하지 않고 공제 후 세액은 미확정으로 표시합니다. 수수료 포함 여부를 구분하고 결과에 세목별 세액·계산식·공식 출처를 제공합니다. 세금 입력도 기존 세션과 함께 최초 저장 후 1시간에 삭제됩니다. DB·추가 의존성은 없습니다.

전체 프런트엔드 테스트: `node --test tests/*.mjs`.
