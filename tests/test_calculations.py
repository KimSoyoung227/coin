"""공식, 소수 수량 및 입력 경계값에 대한 회귀 테스트."""

import unittest

from coin.calculations import calculate_average, calculate_profit, quantity_from_amount


class CalculationTests(unittest.TestCase):
    """실제 거래 예시와 유효하지 않은 입력을 검증한다."""

    def test_profit_with_both_fees(self):
        """매수/매도 양쪽 수수료를 차감한다."""
        result = calculate_profit(100.0, 120.0, 2.0, 0.1)
        self.assertAlmostEqual(result.fees, 0.44)
        self.assertAlmostEqual(result.profit, 39.56)
        self.assertAlmostEqual(result.return_percent, 19.78)

    def test_loss_and_fractional_quantity(self):
        """소수 코인과 매도 가격 0을 허용한다."""
        self.assertEqual(calculate_profit(100, 0, 0.25).return_percent, -100)
        self.assertEqual(calculate_profit(100, 80, 0.25).profit, -5)
        self.assertEqual(quantity_from_amount(25, 100), 0.25)

    def test_averaging(self):
        """물타기/불타기에서 수량 가중 평균을 사용한다."""
        down = calculate_average(100, 2, 50, 2, "down")
        self.assertEqual(down.average_price, 75)
        self.assertEqual(down.price_change_percent, -25)
        up = calculate_average(100, 2, 200, 1, "up")
        self.assertAlmostEqual(up.average_price, 400 / 3)
        self.assertEqual(up.total_quantity, 3)

    def test_invalid_inputs(self):
        """0, 음수, 무한대, NaN, 잘못된 문자열을 거부한다."""
        for value in (0, -1, float("inf"), float("nan"), "abc", True):
            with self.subTest(value=value), self.assertRaises(ValueError):
                calculate_profit(value, 120, 1)
        with self.assertRaises(ValueError):
            calculate_profit(100, 120, 1, 101)
        with self.assertRaises(ValueError):
            calculate_profit(1e308, 1e308, 10)

    def test_invalid_average_direction(self):
        """탭에 맞지 않는 추가 매수 단가와 잘못된 모드를 거부한다."""
        for price, mode in ((110, "down"), (90, "up"), (100, "down"), (90, "other")):
            with self.subTest(price=price, mode=mode), self.assertRaises(ValueError):
                calculate_average(100, 1, price, 1, mode)


if __name__ == "__main__":
    unittest.main()
