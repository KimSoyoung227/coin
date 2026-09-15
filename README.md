# coin

로그인 없는 반응형 암호화폐 수익률 계산기. 수익률, 물타기, 불타기 계산을 지원합니다.

- `src/coin/calculations.py`: 손익, 수익률, 물타기/불타기 평균 단가 계산
- `tests/test_calculations.py`: 계산 및 입력 검증 테스트
- `src/coin/web.py`: Flask 앱 팩토리 및 계산 API
- `tests/test_web.py`: API 통합 테스트
- `pyproject.toml`: 패키지 구조 및 필수 의존성
- `requirements.txt`: 검증한 의존성 버전
- `src/coin/__main__.py`: 기본 포트 5050의 로컬 실행 진입점
- `src/coin/templates/index.html`: 원페이지 화면
- `src/coin/static/style.css`: 반응형 레이아웃 및 화면 여백
- `src/coin/static/app.js`: 탭, 입력 및 계산 결과 표시
- `src/coin/static/session.js`: 브라우저 세션 보관 및 1시간 만료
- `tests/test_session.mjs`: 저장 및 만료 검증 (Node.js 사용, 추가 패키지 없음)
- `WORK_LOG.md`: 작업 일지 및 정책

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

API는 JSON 객체를 받습니다. `mode`는 `profit`(기본), `down`, `up`입니다.
공통 입력은 `buy_price`와 `quantity` 또는 `amount` 중 하나입니다.
수익률은 `sell_price`, 선택 항목 `fee_percent`(기본 0%)를 받습니다.
물타기/불타기는 `additional_price`와 `additional_quantity` 또는 `additional_amount` 중 하나를 받습니다.
성공 응답은 `mode`, `result`이고 입력 오류는 HTTP 400의 `error`입니다.
