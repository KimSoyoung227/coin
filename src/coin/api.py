"""계산 입력 검증과 시세 JSON API를 HTTP 요청에 연결한다."""

from dataclasses import asdict

from flask import Blueprint, current_app, jsonify, request

from coin.calculations import calculate_average, calculate_profit, quantity_from_amount

api = Blueprint("api", __name__, url_prefix="/api")


def _resolve_quantity(data: dict, price_key: str, quantity_key: str, amount_key: str) -> float:
    """수량 또는 투자금액 중 정확히 하나를 받아 계산용 수량을 구한다."""
    has_quantity = quantity_key in data
    has_amount = amount_key in data
    if has_quantity == has_amount:
        raise ValueError(f"{quantity_key} 또는 {amount_key} 중 하나만 입력해주세요.")
    if has_amount:
        return quantity_from_amount(data[amount_key], data[price_key])
    return data[quantity_key]


@api.post("/calculate")
def calculate():
    """수익률 또는 추가 매수 평균 단가를 계산하며 결과를 저장하지 않는다."""
    data = request.get_json()
    if not isinstance(data, dict):
        return jsonify(error="JSON 객체를 입력해주세요."), 400
    try:
        mode = data.get("mode", "profit")
        if mode not in ("profit", "average"):
            raise ValueError("올바른 계산 탭을 선택해주세요.")
        quantity = _resolve_quantity(data, "buy_price", "quantity", "amount")
        if mode == "profit":
            result = calculate_profit(
                data["buy_price"], data["sell_price"], quantity, data.get("fee_percent", 0.0)
            )
        else:
            additional_quantity = _resolve_quantity(
                data, "additional_price", "additional_quantity", "additional_amount"
            )
            result = calculate_average(
                data["buy_price"], quantity, data["additional_price"], additional_quantity
            )
    except KeyError:
        return jsonify(error="필수 입력 항목이 누락되었습니다."), 400
    except ValueError as error:
        return jsonify(error=str(error)), 400
    return jsonify(mode=mode, result=asdict(result))


@api.get("/market-rates")
def market_rates():
    """캐시된 환율·원자재·비트코인 가격과 조회 완료 시각을 제공한다."""
    result = current_app.extensions["market_service"].snapshot()
    status = 200 if result["groups"] else 503
    return jsonify(result), status



@api.post('/tax/calculate')
def tax_calculate():
    """세금 참고 계산을 수행하며 민감한 거래·소득 입력은 저장하지 않는다."""
    from coin.taxes import TaxInputError, calculate_tax

    try:
        result = calculate_tax(request.get_json())
    except TaxInputError as error:
        return jsonify(error=error.key, field=error.field), 400
    return jsonify(result=result)
