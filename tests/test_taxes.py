"""국가별 경계 세율, 원가 배분, 입력 거부 및 미확정 분기를 검증한다."""
import unittest
from decimal import Decimal
from coin.taxes import RULES, TaxInputError, calculate_tax
from coin.web import create_app


def payload(country='KR', asset='stock', gain=10000, **changes):
    """자국통화의 검증된 한 취득분과 한 처분으로 기준 요청을 만든다."""
    currency={'KR':'KRW','US':'USD','JP':'JPY','CN':'CNY','DE':'EUR','ES':'EUR'}[country]
    value=dict(country=country,asset=asset,market='foreign',year=2026,event='sale',basis_confirmed=True,annual_complete=True,lots=[dict(buy_date='2026-01-01',quantity='10',amount='10000',currency=currency,fee='0')],sell_date='2026-09-20',sell_quantity='10',sell_amount=str(10000+gain),sell_currency=currency,other_income='0')
    value.update(changes)
    return value


class TaxTests(unittest.TestCase):
    """예상세액의 중요한 법규 경계와 API 입력 경계를 확인한다."""

    def test_crypto_market_does_not_change_tax(self):
        """숨긴 거래구분이 암호자산 세액이나 해외 거래 경고를 바꾸지 않는다."""
        for country in ('KR','US','JP','DE','ES'):
            with self.subTest(country=country):
                domestic=calculate_tax(payload(country,asset='crypto',market='domestic'))
                foreign=calculate_tax(payload(country,asset='crypto',market='foreign'))
                self.assertEqual(domestic,foreign)
                self.assertNotIn('taxForeign',foreign['warnings'])

    def test_transfer_fee_note_removed(self):
        """삭제된 수수료 참고 문구가 어느 국가·자산에서도 표시되지 않는지 확인한다."""
        for country in ('KR','US','JP','CN','DE','ES'):
            for asset in ('stock','crypto'):
                with self.subTest(country=country,asset=asset):
                    result=calculate_tax(payload(country,asset=asset))
                    self.assertNotIn('taxTransfer',result['warnings'])
            # 기존 API 이전 요청에도 삭제된 참고 문구를 노출하지 않는다.
            result=calculate_tax(payload(country,asset='crypto',event='transfer'))
            self.assertNotIn('taxTransfer',result['warnings'])

    def test_korean_foreign_allowance(self):
        """250만원 공제와 본세·지방세를 따로 적용한다."""
        result=calculate_tax(payload(gain=10000000))
        self.assertEqual(result['total'],'1650000.00')
        self.assertEqual(result['lines'][0]['amount'],'1500000.00')

    def test_korean_markets_and_loss(self):
        """양도손실에도 시장별 거래세와 농특세는 매도액에 부과한다."""
        for market,total in [('KOSPI','10.00'),('KOSDAQ','10.00'),('KONEX','5.00')]:
            result=calculate_tax(payload(gain=-5000,market='domestic',eligible='yes',stock_market=market))
            self.assertEqual(result['total'],total)
        self.assertEqual(calculate_tax(payload(market='domestic',eligible='no'))['status'],'review_required')

    def test_korean_crypto_transition(self):
        """유예와 시행 예정 경과 취득가액을 구분한다."""
        self.assertEqual(calculate_tax(payload(asset='crypto'))['total'],'0.00')
        value=payload(asset='crypto',gain=10000000,year=2027,sell_date='2027-02-01')
        value['lots'][0]['transition_value']='5010000'
        result=calculate_tax(value)
        self.assertEqual(result['total'],'550000.00')
        self.assertEqual(result['status'],'scheduled')

    def test_exemption_without_transaction_inputs(self):
        """유예·NISA는 금액 없이 안내하고 특수 거래와 미지원 연도는 면세로 오인하지 않는다."""
        for market in ('domestic','foreign'):
            for country,asset,extra,warning in [('KR','crypto',{},'taxKoreaDeferred'),('JP','stock',{'nisa':True},'taxNisa')]:
                data=dict(country=country,asset=asset,market=market,year=2026,**extra)
                result=calculate_tax(data)
                self.assertEqual(result['status'],'exempt')
                self.assertEqual(result['total'],'0.00')
                self.assertIn(warning,result['warnings'])
                self.assertNotIn('realized',result)
                self.assertNotIn('after_tax',result)
                self.assertEqual(calculate_tax(dict(data,special=True))['status'],'review_required')
                self.assertEqual(calculate_tax(dict(data,year=2099))['status'],'review_required')
        self.assertEqual(calculate_tax(dict(country='KR',asset='crypto',market='foreign',year=2027))['status'],'review_required')
        self.assertEqual(calculate_tax(dict(country='JP',asset='stock',market='foreign',year=2026,nisa=False))['status'],'review_required')

    def test_fifo_partial_and_fx(self):
        """각 거래일 환율을 먼저 적용하고 FIFO 부분매도를 배분한다."""
        value=payload('ES',sell_quantity='15',sell_amount='100',sell_currency='USD',sell_fx='2')
        value['lots']=[dict(buy_date='2025-01-01',quantity='10',amount='10',currency='USD',fx='3'),dict(buy_date='2026-01-01',quantity='10',amount='20',currency='USD',fx='4')]
        result=calculate_tax(value)
        self.assertEqual(result['cost'],'70.00')
        self.assertEqual(result['realized'],'130.00')
        value.pop('sell_fx')
        self.assertIn('taxFxMissing',calculate_tax(value)['warnings'])

    def test_fee_inclusion(self):
        """총액에 이미 반영한 수수료는 중복 가산·차감하지 않는다."""
        value=payload('ES',sell_fee='100',sell_fees_included=True)
        value['lots'][0].update(fee='100',fees_included=True)
        self.assertEqual(calculate_tax(value)['realized'],'10000.00')

    def test_us_stacking_and_niit(self):
        """장기이득 0% 경계와 MAGI 한도의 NIIT 증가분을 적용한다."""
        value=payload('US',filing='single',other_income='49000',magi='199000',other_investment='0')
        value['lots'][0]['buy_date']='2025-01-01'
        result=calculate_tax(value)
        self.assertEqual(result['lines'][1]['amount'],'1432.50')
        self.assertEqual(result['lines'][2]['amount'],'342.00')
        self.assertEqual(result['total'],'1774.50')

    def test_us_missing_and_losses(self):
        """누락 입력에는 범위를, 순손실에는 일반소득 공제 및 이월액을 준다."""
        self.assertEqual(calculate_tax(payload('US'))['status'],'range')
        result=calculate_tax(payload('US',gain=-5000,filing='separate',magi='0',other_investment='0'))
        self.assertEqual(result['loss_deduction'],'1500.00')
        self.assertEqual(result['loss_carryforward'],'3500.00')

    def test_japan_stock_and_income(self):
        """주식 세목, NISA 및 코인 누진소득세 증가분을 검증한다."""
        self.assertEqual(calculate_tax(payload('JP'))['total'],'2031.50')
        self.assertEqual(calculate_tax(payload('JP',nisa=True))['total'],'0.00')
        result=calculate_tax(payload('JP','crypto',gain=100000,other_income='1900000'))
        self.assertEqual(result['total'],'17657.50')
        self.assertEqual(calculate_tax(payload('JP','crypto',other_income=''))['status'],'range')

    def test_germany_threshold_and_anniversary(self):
        """999.99는 면세, 1000은 전액 과세하고 기념일 초과를 확인한다."""
        self.assertEqual(calculate_tax(payload('DE','crypto',gain=Decimal('999.99'),other_income='30000'))['total'],'0.00')
        result=calculate_tax(payload('DE','crypto',gain=1000,other_income='30000'))
        self.assertEqual(result['taxable'],'1000.00')
        self.assertGreater(Decimal(result['total']),0)
        value=payload('DE','crypto',gain=10000,other_income='30000')
        value['lots'][0]['buy_date']='2025-09-20'
        self.assertGreater(Decimal(calculate_tax(value)['total']),0)
        value['lots'][0]['buy_date']='2025-09-19'
        self.assertEqual(calculate_tax(value)['total'],'0.00')
        value['annual_complete']=False
        self.assertEqual(calculate_tax(value)['status'],'review_required')

    def test_germany_church(self):
        """교회세로 조정된 본세와 연대부가세를 검증한다."""
        result=calculate_tax(payload('DE',gain=11000,church_rate='0.08'))
        self.assertEqual(result['lines'][0]['amount'],'2450.98')
        self.assertEqual(result['total'],'2781.86')

    def test_spain_progressive_and_swap(self):
        """8만 유로 누진 예제와 코인 교환의 큰 시장가치를 적용한다."""
        self.assertEqual(calculate_tax(payload('ES',gain=80000,other_savings='0'))['total'],'17280.00')
        self.assertEqual(calculate_tax(payload('ES','crypto',event='swap',swap_given_value='30000',sell_fee='0'))['realized'],'20000.00')

    def test_china_branches(self):
        """본토 코인은 계산하지 않으며 적격 주식은 인지세만 계산한다."""
        result=calculate_tax(dict(country='CN',asset='crypto',market='foreign',year=2026))
        self.assertIsNone(result['total'])
        self.assertIn('taxChinaCrypto',result['warnings'])
        self.assertEqual(calculate_tax(payload('CN',market='domestic',eligible='yes',stock_market='SSE'))['total'],'10.00')
        result=calculate_tax(payload('CN',other_losses='10000'))
        self.assertEqual(result['total'],'2000.00')
        self.assertIn('taxChinaForeign',result['warnings'])

    def test_foreign_credit_not_assumed(self):
        """납부액을 자동 공제하지 않고 공제 후 금액을 미확정 처리한다."""
        result=calculate_tax(payload('ES',foreign_tax='100'))
        self.assertIsNone(result['total_after_credit'])
        self.assertIsNone(result['after_tax'])

    def test_invalid_values(self):
        """음수·비유한·과다수량·잘못된 날짜·타입을 거부한다."""
        for changes in [dict(sell_quantity='11'),dict(sell_amount='-1'),dict(sell_amount='NaN'),dict(sell_amount='1e999'),dict(sell_amount='0e999999'),dict(sell_date='2025-01-01'),dict(sell_date='2026-00-00'),dict(year='2026.5'),dict(special='false'),dict(country=[]),dict(asset={}),dict(event=[]),dict(sell_currency=[])]:
            with self.subTest(changes=changes),self.assertRaises(TaxInputError):
                calculate_tax({**payload(), **changes})
        for raw in [None,[],42]:
            with self.assertRaises(TaxInputError):
                calculate_tax(raw)

    def test_rule_metadata_and_api(self):
        """규칙별 출처·검증일과 모든 국가·자산·지역 조합의 API를 확인한다."""
        client=create_app().test_client()
        for country,year,asset,market in RULES:
            self.assertTrue(RULES[country,year,asset,market]['officialSources'])
            value=payload(country,asset,market=market,year=year,sell_date=f'{year}-09-20',eligible='yes',stock_market='KOSPI' if country=='KR' else 'SSE',filing='single',magi='0',other_investment='0',other_savings='0')
            if year==2027:
                value['lots'][0]['transition_value']='10000'
            response=client.post('/api/tax/calculate',json=value)
            self.assertEqual(response.status_code,200,response.get_data(as_text=True))
            result=response.get_json()['result']
            expected='review_required' if country=='CN' and asset=='crypto' else 'exempt' if country=='KR' and asset=='crypto' and year==2026 else 'scheduled' if year==2027 else 'estimate'
            self.assertEqual(result['status'],expected)
            if expected=='review_required':self.assertIsNone(result['total'])
            else:
                expected_total = {'KR':'0.00','US':'1000.00','JP':'1510.50' if asset=='crypto' else '2031.50','CN':'2000.00','DE':'0.00' if asset=='crypto' else '2373.75','ES':'1980.00'}[country]
                if asset=='stock' and market=='domestic' and country in ('KR','CN'):
                    expected_total='40.00' if country=='KR' else '10.00'
                self.assertEqual(result['total'],expected_total)

        self.assertEqual(client.post('/api/tax/calculate',json=[]).status_code,400)
        self.assertEqual(calculate_tax(payload(year=2025))['status'],'review_required')

    def test_swap_fee_equivalence(self):
        """교환 시가의 대소·외화·포함 체크에 관계없이 같은 거래는 같은 세액이다."""
        for given in ('15000','20000','30000'):
            for currency,fx in [('EUR',1),('USD',2)]:
                results=[]
                for included in (False,True):
                    value=payload('ES','crypto',event='swap',swap_given_value=given,
                                  sell_currency=currency,sell_fx=str(fx),sell_fee=str(1000/fx),
                                  sell_amount=str((19000 if included else 20000)/fx),
                                  sell_fees_included=included,other_savings='0')
                    results.append(calculate_tax(value))
                self.assertEqual(results[0],results[1])
                self.assertEqual(Decimal(results[0]['proceeds']),max(Decimal(given),Decimal(20000))-1000)
        self.assertEqual(results[0]['total'],'3870.00')
        for missing in (None,''):
            with self.assertRaises(TaxInputError):
                calculate_tax(payload('ES','crypto',event='swap',swap_given_value='20000',sell_fee=missing))

    def test_japan_range_foreign_credit(self):
        """소득 누락 범위에도 납부액을 보존하고 음수 등 잘못된 납부액을 거부한다."""
        for paid in ('0','100'):
            result=calculate_tax(payload('JP','crypto',other_income='',foreign_tax=paid))
            self.assertEqual(result['status'],'range')
            self.assertIsNone(result['total'])
            self.assertEqual('taxCreditReview' in result['warnings'],paid=='100')
            if paid=='100':
                self.assertEqual(result['foreign_paid'],'100.00')
                self.assertIsNone(result['total_after_credit'])
                self.assertIsNone(result['after_tax'])
        with self.assertRaises(TaxInputError):
            calculate_tax(payload('JP','crypto',other_income='',foreign_tax='-1'))

    def test_same_day_fifo_input_order(self):
        """동일일 부분 처분은 수량·원가 크기 대신 입력 행 순서로 배분한다."""
        value=payload('ES',sell_quantity='1')
        value['lots']=[dict(buy_date='2026-01-01',quantity='2',amount='600',currency='EUR'),
                       dict(buy_date='2026-01-01',quantity='1',amount='100',currency='EUR')]
        self.assertEqual(calculate_tax(value)['cost'],'300.00')
        value['lots'].reverse()
        self.assertEqual(calculate_tax(value)['cost'],'100.00')

    def test_allowance_boundaries(self):
        """한국·독일의 공제 잔액 빈칸·0·한도·초과와 공동과세 한도를 검증한다."""
        for country,joint,limit in [('KR',False,2500000),('DE',False,1000),('DE',True,2000)]:
            for raw,expected in [('',limit),('0',0),(str(limit),limit)]:
                result=calculate_tax(payload(country,joint=joint,deduction_remaining=raw))
                self.assertEqual(Decimal(result['deduction']),expected)
            with self.assertRaises(TaxInputError):
                calculate_tax(payload(country,joint=joint,deduction_remaining=str(limit+1)))
        result=calculate_tax(payload('DE','crypto',gain=10000,other_income='30000',joint=True))
        # 공동과세: 2 × (ESt(20000) - ESt(15000)) = 2 × (1570 - 435).
        self.assertEqual(result['lines'][0]['amount'],'2270.00')

    def test_transition_date_and_spain_conditions(self):
        """경과가액 취득일 경계와 스페인 교차통산 한도·특별지역 분기를 검증한다."""
        value=payload('KR','crypto',year=2027,sell_date='2027-09-20')
        with self.assertRaises(TaxInputError):
            calculate_tax(value)
        value['lots'][0]['buy_date']='2027-01-01'
        self.assertEqual(calculate_tax(value)['status'],'scheduled')
        result=calculate_tax(payload('ES',savings_losses='99999',other_savings='0'))
        self.assertEqual(result['loss_offset'],'2500.00')
        self.assertEqual(result['taxable'],'7500.00')
        self.assertEqual(result['total'],'1455.00')
        self.assertEqual(calculate_tax(payload('ES',regional=True))['status'],'review_required')

    def test_rule_consistency(self):
        """규칙 키·적용일·자산별 설명과 복제 계산 파라미터의 일치를 보장한다."""
        from datetime import date
        from coin.taxes import TAX_DATA
        self.assertEqual(len(RULES),len(TAX_DATA['rules']))
        self.assertEqual(len(RULES),26)
        for (country,year,asset,market),rule in RULES.items():
            self.assertEqual(date.fromisoformat(rule['effectiveFrom']).year,year)
            self.assertEqual(date.fromisoformat(rule['effectiveTo']).year,year)
            self.assertLessEqual(date.fromisoformat(rule['lastVerifiedAt']),date.fromisoformat(rule['effectiveTo']))
            other=RULES[country,year,asset,'foreign' if market=='domestic' else 'domestic']
            self.assertEqual(rule['surtaxRules'],other['surtaxRules'])
            if country=='JP' and asset=='stock':self.assertEqual(rule['brackets'],[])
            elif country in ('JP','ES'):self.assertEqual(rule['brackets'],rule['surtaxRules']['brackets'])
            if country=='DE' and asset=='stock':self.assertEqual(rule['holdingPeriodRule'],'not_applicable')
            if country=='KR' and asset=='stock' and market=='domestic':
                self.assertEqual(rule['exemptionType'],'none')
                self.assertEqual(rule['exemptionAmount'],0)
