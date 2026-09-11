"""PyCharm과 python -m coin에서 사용하는 로컬 개발 서버 진입점."""

import argparse

from coin.web import create_app


def main() -> None:
    """AirPlay와 충돌하지 않는 기본 포트로 로컬 서버를 시작한다."""
    parser = argparse.ArgumentParser(description="암호화폐 수익률 계산기 개발 서버")
    parser.add_argument("--port", type=int, default=5050, help="로컬 포트 (기본: 5050)")
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("포트는 1~65535 사이여야 합니다.")
    create_app().run(host="127.0.0.1", port=args.port, debug=False)


if __name__ == "__main__":
    main()
