"""외부 의존성 없이 float 입력으로 손익과 추가 매수 평단가를 계산한다."""

from dataclasses import dataclass
from math import isfinite


def _number(value: float, label: str, allow_zero: bool = False) -> float:
    """숫자를 float로 변환하고 비정상 값과 허용하지 않는 범위를 거부한다."""
    if isinstance(value, bool):
        raise ValueError(f"{label}: 숫자를 입력해주세요.")
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError) as exc:
        raise ValueError(f"{label}: 숫자를 입력해주세요.") from exc
    if not isfinite(number) or number < 0 or (number == 0 and not allow_zero):
        raise ValueError(f"{label}: {'0 이상' if allow_zero else '0보다 큰'} 유한한 숫자를 입력해주세요.")
    return number


def _finite(*values: float) -> None:
    """연산 중 float 범위를 초과한 결과를 사용자 오류로 처리한다."""
    if not all(isfinite(value) for value in values):
        raise ValueError("계산 가능한 숫자 범위를 초과했습니다.")


@dataclass(frozen=True)
class ProfitResult:
    """매수 원금, 매도 금액, 양방향 수수료 및 순손익 계산 결과."""

    investment: float
    proceeds: float
    fees: float
    profit: float
    return_percent: float


def calculate_profit(
    buy_price: float, sell_price: float, quantity: float, fee_percent: float = 0.0
) -> ProfitResult:
    """양쪽 거래에 동일 수수료율(%)을 적용하고 매수 원금 대비 수익률을 반환한다."""
    buy = _number(buy_price, "매수 단가")
    sell = _number(sell_price, "매도 단가", allow_zero=True)
    count = _number(quantity, "수량")
    fee = _number(fee_percent, "수수료율", allow_zero=True)
    if fee > 100:
        raise ValueError("수수료율은 100% 이하여야 합니다.")
    investment, proceeds = buy * count, sell * count
    fees = investment * (fee / 100) + proceeds * (fee / 100)
    profit = proceeds - investment - fees
    if investment == 0:
        raise ValueError("투자금액이 너무 작습니다.")
    percent = profit / investment * 100
    _finite(investment, proceeds, fees, profit, percent)
    return ProfitResult(investment, proceeds, fees, profit, percent)


def quantity_from_amount(amount: float, price: float) -> float:
    """수수료를 제외한 매수금액을 코인 수량으로 변환한다."""
    quantity = _number(amount, "투자금액") / _number(price, "매수 단가")
    return _number(quantity, "환산 수량")


@dataclass(frozen=True)
class AverageResult:
    """수수료를 제외한 추가 매수 후 보유 금액, 수량 및 평균 단가."""

    total_amount: float
    total_quantity: float
    average_price: float
    price_change_percent: float


def calculate_average(
    buy_price: float,
    quantity: float,
    additional_price: float,
    additional_quantity: float,
    mode: str,
) -> AverageResult:
    """물타기/불타기 방향을 검증하고 수량 가중 평균 단가를 계산한다."""
    buy = _number(buy_price, "기존 매수 단가")
    count = _number(quantity, "기존 수량")
    extra = _number(additional_price, "추가 매수 단가")
    extra_count = _number(additional_quantity, "추가 수량")
    if mode not in ("down", "up"):
        raise ValueError("물타기 또는 불타기를 선택해주세요.")
    if mode == "down" and extra >= buy:
        raise ValueError("물타기의 추가 매수 단가는 기존 단가보다 낮아야 합니다.")
    if mode == "up" and extra <= buy:
        raise ValueError("불타기의 추가 매수 단가는 기존 단가보다 높아야 합니다.")
    amount = buy * count + extra * extra_count
    total = count + extra_count
    average = amount / total
    change = (average - buy) / buy * 100
    _finite(amount, total, average, change)
    if average == 0:
        raise ValueError("평균 단가가 너무 작습니다.")
    return AverageResult(amount, total, average, change)
