"""연도별 공개 세법 데이터로 개인 현물 거래의 참고 세액과 계산 근거를 산출한다."""

import calendar
import json
from datetime import date
from decimal import Decimal, InvalidOperation, ROUND_DOWN, ROUND_HALF_UP, localcontext
from pathlib import Path

TAX_DATA = json.loads(Path(__file__).with_name('data').joinpath('tax_rules.json').read_text())
RULES = {(r['country'], r['taxYear'], r['assetType'], r['domesticForeignType']): r for r in TAX_DATA['rules']}
ZERO = Decimal(0)


class TaxInputError(ValueError):
    """번역 가능한 입력 오류 코드와 해당 필드를 전달한다."""

    def __init__(self, key='taxInvalid', field=''):
        super().__init__(key)
        self.key, self.field = key, field


def number(data, key, default=None, signed=False):
    """문자열 40자·절댓값 1e15·소수 지수 -12~15 범위의 유한수를 검증한다."""
    raw = data.get(key)
    if raw is None or raw == '':
        if default is None:
            raise TaxInputError('taxMissing', key)
        return Decimal(str(default))
    if isinstance(raw, bool) or not isinstance(raw, (str, int, float)) or len(str(raw)) > 40:
        raise TaxInputError(field=key)
    try:
        value = Decimal(str(raw))
    except InvalidOperation:
        raise TaxInputError(field=key) from None
    if not value.is_finite() or abs(value) > Decimal('1e15') or (value < 0 and not signed) or not -12 <= value.as_tuple().exponent <= 15:
        raise TaxInputError(field=key)
    return value


def flag(data, key):
    """JSON 불리언만 허용해 문자열 false가 참으로 해석되는 것을 방지한다."""
    value = data.get(key, False)
    if not isinstance(value, bool):
        raise TaxInputError(field=key)
    return value


def present(data, key):
    """조건부 입력이 명시되었는지 판별한다."""
    return data.get(key) not in (None, '')


def calendar_date(data, key):
    """ISO 날짜를 검증한다."""
    try:
        return date.fromisoformat(data[key])
    except (KeyError, ValueError, TypeError):
        raise TaxInputError('taxDates', key) from None


def long_term(acquired, disposed):
    """윤년을 고려해 취득일의 다음 해 기념일을 초과했는지 판별한다."""
    day = min(acquired.day, calendar.monthrange(acquired.year + 1, acquired.month)[1])
    return disposed > acquired.replace(year=acquired.year + 1, day=day)


def progressive(amount, brackets, base=ZERO):
    """기존 과세소득 위에 쌓인 금액을 구간별로 나눠 세액과 계산식을 반환한다."""
    total, lower, rows = ZERO, ZERO, []
    for upper, rate in brackets:
        top = Decimal(str(upper)) if upper is not None else base + amount
        taxable = max(ZERO, min(base + amount, top) - max(base, lower))
        rate = Decimal(str(rate))
        if taxable:
            tax = taxable * rate
            total += tax
            rows.append(f'{taxable} × {rate} = {tax}')
        lower = top
    return total, rows


def german_income(amount, params, joint):
    """독일 §32a의 연도별 다항식과 공동과세 분할 계산을 적용한다."""
    divisor = Decimal(2 if joint else 1)
    x = (max(ZERO, amount) / divisor).to_integral_value(rounding=ROUND_DOWN)
    a, b, c, d = map(Decimal, params['incomeBands'])
    p, q, r, s, t, u, v, w, z = map(Decimal, params['incomeCoefficients'])
    if x <= a:
        tax = ZERO
    elif x <= b:
        y = (x-a)/10000
        tax = (p*y+q)*y
    elif x <= c:
        y = (x-b)/10000
        tax = (r*y+s)*y+t
    elif x <= d:
        tax = u*x-v
    else:
        tax = w*x-z
    return tax.to_integral_value(rounding=ROUND_DOWN)*divisor


def transactions(data, rule):
    """한 자산의 잔여 취득 로트를 FIFO 또는 확인된 평균법으로 부분 매도에 배분한다."""
    disposed = calendar_date(data, 'sell_date')
    if disposed.year != rule['taxYear']:
        raise TaxInputError('taxYearMismatch', 'sell_date')
    lots = data.get('lots')
    if not isinstance(lots, list) or not 1 <= len(lots) <= 50:
        raise TaxInputError('taxMissing', 'lots')
    parsed, quantity = [], ZERO
    for lot in lots:
        if not isinstance(lot, dict):
            raise TaxInputError(field='lots')
        acquired = calendar_date(lot, 'buy_date')
        if acquired > disposed:
            raise TaxInputError('taxDates', 'buy_date')
        qty = number(lot, 'quantity')
        if qty <= 0:
            raise TaxInputError(field='quantity')
        fx = exchange_rate(lot, 'currency', 'fx', rule['currency'])
        cost = number(lot, 'amount') * fx
        if not flag(lot, 'fees_included'):
            cost += number(lot, 'fee', 0)*fx
        if rule['country']=='KR' and rule['taxYear']==2027 and acquired.year < 2027:
            cost = max(cost, number(lot, 'transition_value'))
        parsed.append((acquired, qty, cost))
        quantity += qty
    sell_qty = number(data, 'sell_quantity')
    if sell_qty <= 0 or sell_qty > quantity:
        raise TaxInputError('taxQuantity', 'sell_quantity')
    fx = exchange_rate(data, 'sell_currency', 'sell_fx', rule['currency'])
    gross = number(data, 'sell_amount')*fx
    included = flag(data, 'sell_fees_included')
    # 교환은 차감 전 시가끼리 비교한 뒤 수수료를 한 번만 반영한다.
    if rule['country']=='ES' and data.get('event')=='swap':
        fee = number(data, 'sell_fee')*fx
        gross = max(gross + (fee if included else ZERO), number(data, 'swap_given_value'))
    else:
        fee = ZERO if included else number(data, 'sell_fee', 0)*fx
    net = gross-fee
    if net < 0:
        raise TaxInputError(field='sell_fee')
    remaining, cost, short, long = sell_qty, ZERO, ZERO, ZERO
    allocation=[]
    if rule['costBasisMethod']=='average':
        cost = sum((lot[2] for lot in parsed), ZERO)*sell_qty/quantity
        short=net-cost
        allocation.append(f'({sum((lot[2] for lot in parsed), ZERO)} / {quantity}) × {sell_qty} = {cost}')
    else:
        for acquired, qty, purchase in sorted(parsed, key=lambda lot: lot[0]):
            used=min(qty,remaining)
            if not used:
                break
            allocated=purchase*used/qty
            gain=net*used/sell_qty-allocated
            cost+=allocated
            if long_term(acquired,disposed):
                long+=gain
            else:
                short+=gain
            remaining-=used
            allocation.append(f'{acquired}: {purchase} × {used} / {qty} = {allocated}')
    return {'gross':gross,'net':net,'cost':cost,'gain':net-cost,'short':short,'long':long,'allocation':allocation}


def exchange_rate(data, currency_key, rate_key, local_currency):
    """자국통화에는 1을 쓰고 외화에는 해당 거래일의 명시적 환율을 요구한다."""
    currency=data.get(currency_key)
    if not isinstance(currency, str) or currency not in {'KRW','USD','JPY','CNY','EUR','GBP'}:
        raise TaxInputError(field=currency_key)
    if currency==local_currency:
        return Decimal(1)
    if not present(data,rate_key):
        raise TaxInputError('taxFxMissing',rate_key)
    rate=number(data,rate_key)
    if rate<=0:
        raise TaxInputError(field=rate_key)
    return rate


def calculate_tax(data):
    """요청을 검증하고 Decimal 정밀도를 고정한 뒤 국가별 계산으로 전달한다."""
    if not isinstance(data,dict):
        raise TaxInputError()
    with localcontext() as context:
        context.prec=50
        return _calculate_tax(data)


def _calculate_tax(data):
    """필수 조건을 확인하고 세목·근거·검토 상태가 포함된 결과를 작성한다."""
    country,asset,market=data.get('country'),data.get('asset'),data.get('market')
    if not all(isinstance(v, str) for v in (country, asset, market)) or country not in {'KR','US','JP','CN','DE','ES'} or asset not in {'stock','crypto'} or market not in {'domestic','foreign'}:
        raise TaxInputError('taxMissing','country/asset/market')
    try:
        year=int(str(data.get('year')))
    except ValueError:
        raise TaxInputError(field='year') from None
    rule=RULES.get((country,year,asset,market))
    if rule is None:
        return {'status':'review_required','warnings':['taxUnsupportedYear'],'country':country,'year':year,'total':None,'sources':[],'verified':None}
    p=rule['surtaxRules']
    result={'status':'estimate','country':country,'year':year,'currency':rule['currency'],'rule_status':rule['status'],'version':TAX_DATA['version'],'verified':rule['lastVerifiedAt'],'sources':rule['officialSources'],'warnings':['taxDisclaimer','taxScopeNote'],'lines':[],'steps':[],'total':None,'category':rule['incomeCategory'],'basis_method':rule['costBasisMethod']}
    if country=='CN' and asset=='crypto':
        return review(result,'taxChinaCrypto')
    if flag(data,'special'):
        return review(result,'taxSpecial')
    event=data.get('event','sale')
    if not isinstance(event, str) or event not in {'sale','swap','payment','transfer'} or (asset=='stock' and event!='sale'):
        raise TaxInputError(field='event')
    if event=='transfer':
        result.update(status='not_disposal',total='0')
        return result
    # 과세 유예·적격 NISA는 금액이나 취득원가 확인 없이 비과세를 안내한다.
    exemption = 'taxKoreaDeferred' if country=='KR' and asset=='crypto' and rule['status']=='suspended' else 'taxNisa' if country=='JP' and asset=='stock' and flag(data,'nisa') else None
    if exemption:
        result.update(status='exempt',taxable=ZERO,total=ZERO)
        result['warnings'].append(exemption)
        return serialize(result)
    if not flag(data,'basis_confirmed'):
        return review(result,'taxBasisReview')
    try:
        tx=transactions(data,rule)
    except TaxInputError as error:
        if error.key=='taxFxMissing':
            return review(result,error.key)
        raise
    result.update(realized=tx['gain'],cost=tx['cost'],proceeds=tx['net'])
    result['steps']=tx['allocation']+[f"{tx['net']} − {tx['cost']} = {tx['gain']}"]
    gains=number(data,'other_gains',0)
    losses=number(data,'other_losses',0)
    annual=tx['gain']+gains-losses
    result.update(annual=annual,loss_offset=min(max(ZERO,tx['gain']+gains),losses),deduction=ZERO,threshold=ZERO,taxable=max(ZERO,annual))
    if not flag(data,'annual_complete'):
        result['warnings'].append('taxPartial')
    # 암호자산의 내부 규칙 조회값만으로 해외 거래라고 단정하지 않는다.
    if asset=='stock' and market=='foreign':
        result['warnings'].append('taxForeign')
    if rule['status']=='scheduled':
        result['warnings'].append('taxScheduled')
        result['status']='scheduled'
    if country=='KR':
        if asset=='stock' and market=='domestic':
            eligibility=data.get('eligible','unknown')
            if eligibility=='no':
                return serialize(review(result,'taxSpecial'))
            if eligibility!='yes':
                result['warnings'].append('taxKoreaAssumption')
            market_name = data.get('stock_market')
            rates=p['markets'].get(market_name) if isinstance(market_name, str) else None
            if not rates:
                return serialize(review(result,'taxMarketMissing'))
            result['taxable']=ZERO
            add_line(result,'taxIncome',ZERO)
            add_rate(result,'taxTransaction',tx['gross'],rates[0])
            add_rate(result,'taxRural',tx['gross'],rates[1])
            result['warnings'].append('taxGainExempt')
        else:
            deduction=number(data,'deduction_remaining',p['deduction'])
            if deduction>Decimal(p['deduction']):
                raise TaxInputError(field='deduction_remaining')
            result['deduction']=deduction
            result['taxable']=max(ZERO,annual-deduction)
            add_rate(result,'taxIncome',result['taxable'],p['incomeRate'])
            add_rate(result,'taxLocal',result['taxable'],p['localRate'])
    elif country=='CN':
        if market=='domestic':
            if data.get('eligible')!='yes' or data.get('stock_market') not in ('SSE','SZSE'):
                return serialize(review(result,'taxSpecial'))
            result['taxable']=ZERO
            add_line(result,'taxIncome',ZERO)
            add_rate(result,'taxStamp',tx['gross'],p['stampRate'])
            result['warnings'].append('taxGainExempt')
        else:
            # 중국 재산양도는 일반 연간 손실통산을 가정하지 않고 이번 거래만 계산한다.
            result.update(taxable=max(ZERO,tx['gain']),annual=tx['gain'],loss_offset=ZERO)
            add_rate(result,'taxIncome',result['taxable'],p['incomeRate'])
            result['warnings'].append('taxChinaForeign')
    elif country=='JP':
        if asset=='stock':
            base=result['taxable']
            income=add_rate(result,'taxIncome',base,p['stockIncome'])
            add_rate(result,'taxReconstruction',income,p['reconstruction'])
            add_rate(result,'taxLocal',base,p['stockLocal'])
        else:
            if not present(data,'other_income'):
                tax_range(result,ZERO,result['taxable']*(Decimal(p['brackets'][-1][1])*(1+Decimal(p['reconstruction']))+Decimal(p['local'])),'taxIncomeMissing')
            else:
                other=number(data,'other_income')
                before=(other/1000).to_integral_value(rounding=ROUND_DOWN)*1000
                after=((other+result['taxable'])/1000).to_integral_value(rounding=ROUND_DOWN)*1000
                tax,rows=progressive(after-before,p['brackets'],before)
                add_line(result,'taxIncome',tax)
                result['steps']+=rows
                add_rate(result,'taxReconstruction',tax,p['reconstruction'])
                add_rate(result,'taxLocal',result['taxable'],p['local'])
                result['warnings'].append('taxJapanLocal')
    elif country=='US':
        calculate_us(data,result,tx,p)
    elif country=='DE':
        calculate_de(data,result,tx,p)
    else:
        if flag(data,'regional'):
            return serialize(review(result,'taxSpecial'))
        other=number(data,'other_savings',0)
        cross=number(data,'savings_losses',0)
        offset=min(max(ZERO,annual)*Decimal(p['crossLossLimit']),cross)
        result['loss_offset']+=offset
        result['taxable']=max(ZERO,annual-offset)
        tax,rows=progressive(result['taxable'],p['brackets'],other)
        add_line(result,'taxIncome',tax)
        result['steps']+=rows
        result['warnings'].append('taxSpainNote')
        if not present(data,'other_savings'):
            result['warnings'].append('taxPartial')
    paid=number(data,'foreign_tax',0)
    if paid:
        result.update(foreign_paid=paid,total_before_credit=None,total_after_credit=None,after_tax=None)
        result['warnings'].append('taxCreditReview')
    if result['status'] in {'review_required','range'}:
        return serialize(result)
    result['steps'].append(f"{result['annual']} − {result['deduction']} → {result['taxable']}")
    total=sum((row['amount'] for row in result['lines']),ZERO)
    # 단순 표시 반올림이며 실제 신고서의 공제·세액 절사 규칙은 별도 검토한다.
    result.update(total=total,after_tax=result['annual']-total)
    if paid:
        result.update(foreign_paid=paid,total_before_credit=total,total_after_credit=None,after_tax=None)
    result['warnings']=list(dict.fromkeys(result['warnings']))
    return serialize(result)


def calculate_us(data,result,tx,p):
    """단·장기 상계, 일반소득 위 장기이득 누진 적용과 NIIT 증가분을 계산한다."""
    short=tx['short']+number(data,'other_short',0,signed=True)
    long=tx['long']+number(data,'other_long',0,signed=True)
    if short*long<0:
        offset=min(abs(short),abs(long))
        short+=offset if short<0 else -offset
        long+=offset if long<0 else -offset
    net=short+long
    result.update(annual=net,taxable=max(ZERO,net),short_gain=short,long_gain=long,loss_offset=sum((max(ZERO, v) for v in [tx['short'], tx['long'], number(data,'other_short',0,signed=True), number(data,'other_long',0,signed=True)]),ZERO)-max(ZERO,net))
    filing=data.get('filing')
    if not isinstance(filing, str) or filing not in p['ordinary'] or not present(data,'other_income'):
        tax_range(result,ZERO,max(ZERO,short)*Decimal(p['rates'][-1])+max(ZERO,long)*Decimal(p['longRates'][-1])+max(ZERO,net)*Decimal(p['niitRate']),'taxUsMissing')
        return
    other=number(data,'other_income')
    short,long=max(ZERO,short),max(ZERO,long)
    brackets=list(zip(p['ordinary'][filing]+[None],p['rates']))
    tax,rows=progressive(short,brackets,other)
    add_line(result,'taxShort',tax)
    result['steps']+=rows
    tax,rows=progressive(long,list(zip(p['long'][filing]+[None],p['longRates'])),other+short)
    add_line(result,'taxLong',tax)
    result['steps']+=rows
    if net<0:
        result['loss_deduction']=min(-net,Decimal(p['separateLossLimit'] if filing=='separate' else p['lossLimit']))
        result['loss_carryforward']=-net-result['loss_deduction']
        result['warnings'].append('taxLossCarry')
    base=sum((r['amount'] for r in result['lines']),ZERO)
    if not present(data,'magi') or not present(data,'other_investment'):
        tax_range(result,base,base+max(ZERO,net)*Decimal(p['niitRate']),'taxNiitMissing')
    else:
        magi=number(data,'magi')
        investment=number(data,'other_investment')
        threshold=Decimal(p['niitThresholds'][filing])
        before=min(investment,max(ZERO,magi-threshold))
        after=min(investment+max(ZERO,net),max(ZERO,magi+max(ZERO,net)-threshold))
        add_rate(result,'taxNiit',max(ZERO,after-before),p['niitRate'])
    result['warnings'].append('taxUsState')
    result['warnings'].append('taxUsNetting')


def calculate_de(data,result,tx,p):
    """주식의 교회세 조정 및 단기 코인의 면세한도·누진소득세를 계산한다."""
    joint=flag(data,'joint')
    church=number(data,'church_rate',0)
    if church not in {ZERO,Decimal('0.08'),Decimal('0.09')}:
        raise TaxInputError(field='church_rate')
    if data['asset']=='stock':
        allowance=Decimal(p['jointDeduction'] if joint else p['deduction'])
        remaining=number(data,'deduction_remaining',allowance)
        if remaining>allowance:
            raise TaxInputError(field='deduction_remaining')
        result['deduction']=remaining
        result['taxable']=max(ZERO,result['annual']-remaining)
        rate=Decimal(p['capitalRate'])
        income=result['taxable']*rate/(1+rate*church)
        add_line(result,'taxIncome',income)
        result['steps'].append(f"{result['taxable']} × {rate} / (1 + {rate} × {church}) = {income}")
        add_rate(result,'taxSolidarity',income,p['solidarityRate'])
        add_rate(result,'taxChurch',income,church)
        result['warnings'].append('taxGermanyStock')
        return
    short=tx['short']+number(data,'other_gains',0)-number(data,'other_losses',0)
    result.update(annual=tx['gain']+number(data,'other_gains',0)-number(data,'other_losses',0),threshold=Decimal(p['threshold']),taxable=max(ZERO,short))
    if not flag(data,'annual_complete'):
        review(result,'taxGermanyAnnual')
        return
    if short<Decimal(p['threshold']):
        result.update(status='exempt',taxable=ZERO)
        result['warnings'].append('taxGermanyThreshold')
        return
    if not present(data,'other_income'):
        review(result,'taxIncomeMissing')
        return
    other=number(data,'other_income')
    before=german_income(other,p,joint)
    after=german_income(other+short,p,joint)
    add_line(result,'taxIncome',after-before)
    result['steps'].append(f'ESt({other} + {short}) − ESt({other}) = {after} − {before} = {after-before}')
    a,b,c,d=p['incomeBands']
    q=p['incomeCoefficients']
    result['steps'] += [f'ESt §32a: x ≤ {a}: 0; x ≤ {b}: ({q[0]} × y + {q[1]}) × y; y = (x − {a}) / 10000', f'x ≤ {c}: ({q[2]} × z + {q[3]}) × z + {q[4]}; z = (x − {b}) / 10000', f'x ≤ {d}: {q[5]} × x − {q[6]}; x > {d}: {q[7]} × x − {q[8]}']
    if joint:
        result['steps'].append('ESt_joint(x) = 2 × ESt(x / 2)')
    limit=Decimal(p['solidarityThreshold'])*(2 if joint else 1)
    rate=Decimal(p['solidarityRate'])
    taper=Decimal(p['solidarityTaper'])
    soli_before=min(before*rate,max(ZERO,before-limit)*taper)
    soli_after=min(after*rate,max(ZERO,after-limit)*taper)
    add_line(result,'taxSolidarity',soli_after-soli_before)
    add_rate(result,'taxChurch',after-before,church)
    result['warnings']+=['taxGermanyThreshold','taxGermanyPersonal']


def add_line(result,label,amount):
    """세목별 원시 Decimal 세액을 보관한다."""
    result['lines'].append({'label':label,'amount':amount})
    return amount


def add_rate(result,label,base,rate):
    """단일 세율의 적용 금액과 공식을 기록한다."""
    amount=base*Decimal(str(rate))
    result['steps'].append(f'{base} × {rate} = {amount}')
    return add_line(result,label,amount)


def review(result,warning):
    """확정 계산이 불가능한 경우 세액을 0으로 오해하지 않도록 비워 둔다."""
    result.update(status='review_required',total=None)
    result['warnings'].append(warning)
    return result


def tax_range(result,low,high,warning):
    """필수 소득정보가 없을 때 계산 가능한 세액 범위만 제공한다."""
    result.update(status='range',total=None,range=[low,high])
    result['warnings'].append(warning)
    return result


def serialize(value):
    """금액을 마지막 단계에서 소수 둘째 자리까지 문자열로 직렬화한다."""
    if isinstance(value,Decimal):
        return str(value.quantize(Decimal('0.01'),rounding=ROUND_HALF_UP))
    if isinstance(value,list):
        return [serialize(item) for item in value]
    if isinstance(value,dict):
        return {key:serialize(item) for key,item in value.items()}
    return value
