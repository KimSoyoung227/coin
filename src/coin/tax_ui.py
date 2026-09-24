"""세금 입력 화면의 필드·조건을 선언하여 템플릿과 브라우저가 공유한다."""
from coin.taxes import TAX_DATA

CURRENCIES=[(value,value) for value in ['KRW','USD','JPY','CNY','EUR','GBP']]


def field(name,label,kind='number',options=None,when=None,required=False,**attrs):
    """선택적 도움말 번역 키와 표시 조건을 가진 입력 정의를 생성한다."""
    help_key = 'taxMoneyHelp' if name in {'amount','sell_amount','currency','sell_currency','fx','sell_fx','fee','sell_fee','fees_included','sell_fees_included'} else 'taxBasisHelp' if name in {'buy_date','quantity','basis_confirmed'} else 'taxMarketHelp' if name == 'market' else None if name == 'country' else 'taxIncomeMissing' if name == 'other_income' else 'taxUsNetting' if name in {'other_short','other_long','magi','other_investment','filing'} else 'taxScopeNote'
    return dict(help=help_key,name=name,label=label,kind=kind,options=options or [],when=when or {},required=required,**attrs)


BASIC=[
    field('country','taxCountry','select',[(c,'taxCountry'+c) for c in ['KR','US','JP','CN','DE','ES']],required=True),
    field('year','taxYear','select',[(str(year),str(year)) for year in sorted({r['taxYear'] for r in TAX_DATA['rules']})],when={'country':['KR'],'asset':['crypto']},required=True),
    field('asset','taxAsset','select',[('stock','taxStock'),('crypto','taxCrypto')],required=True),
    field('market','taxMarket','select',[('domestic','taxDomestic'),('foreign','taxForeignOption')],when={'asset':['stock']},required=True),
    field('event','taxEvent','select',[(v,k) for v,k in [('sale','taxSale'),('swap','taxSwap'),('payment','taxPayment')]],when={'asset':['crypto']},required=True),
    field('special','taxSpecialLabel','checkbox'),
]
LOTS=[field('buy_date','taxBuyDate','date',required=True),field('quantity','taxQuantityLabel',required=True),field('amount','taxAmount',required=True),field('currency','taxCurrency','select',CURRENCIES,required=True),field('fx','taxFx',required=True),field('fee','taxFee'),field('fees_included','taxIncluded','checkbox'),field('transition_value','taxTransition',when={'country':['KR'],'asset':['crypto'],'year':['2027']})]
SALE=[field('sell_date','taxSellDate','date',required=True),field('sell_quantity','taxSellQuantity',required=True),field('sell_amount','taxSellAmount',required=True),field('sell_currency','taxCurrency','select',CURRENCIES,required=True),field('sell_fx','taxFx',required=True),field('sell_fee','taxFee'),field('sell_fees_included','taxIncluded','checkbox'),field('swap_given_value','taxSwapGiven',when={'country':['ES'],'asset':['crypto'],'event':['swap']},required=True)]
CONDITIONS=[
    field('eligible','taxEligible','select',[('unknown','taxUnknown'),('yes','taxYes'),('no','taxNo')],when={'country':['KR','CN'],'asset':['stock'],'market':['domestic']}),
    field('stock_market','taxStockMarket','select',[(s,s) for s in ['KOSPI','KOSDAQ','KONEX','SSE','SZSE']],when={'country':['KR','CN'],'asset':['stock'],'market':['domestic']}),
    field('other_gains','taxOtherGains',when={'country':['KR','JP','CN','DE','ES']}),
    field('other_losses','taxOtherLosses',when={'country':['KR','JP','CN','DE','ES']}),
    field('other_short','taxShortOther',when={'country':['US']},signed=True),
    field('other_long','taxLongOther',when={'country':['US']},signed=True),
    field('other_income','taxOtherIncome',when={'country':['US','JP','DE']}),
    field('filing','taxFiling','select',[(v,k) for v,k in [('single','taxSingle'),('joint','taxJoint'),('separate','taxSeparate'),('head','taxHead')]],when={'country':['US']}),
    field('magi','taxMagi',when={'country':['US']}),
    field('other_investment','taxInvestmentOther',when={'country':['US']}),
    field('deduction_remaining','taxDeduction',when={'country':['KR','DE']}),
    field('joint','taxJoint','checkbox',when={'country':['DE']}),
    field('church_rate','taxChurchRate','select',[('0','0%'),('0.08','8%'),('0.09','9%')],when={'country':['DE']}),
    field('nisa','taxNisaLabel','checkbox',when={'country':['JP'],'asset':['stock']}),
    field('other_savings','taxSavings',when={'country':['ES']}),
    field('savings_losses','taxSavingsLoss',when={'country':['ES']}),
    field('regional','taxRegional','checkbox',when={'country':['ES']}),
    field('foreign_tax','taxForeignTax'),
    field('annual_complete','taxComplete','checkbox'),
    field('basis_confirmed','taxBasisConfirm','checkbox'),
]


# 연간 조건은 문서 5.3절의 항목별 정의를 기존 공통 도움말 대신 표시한다.
for condition in CONDITIONS:
    condition['help'] = condition['label'] + 'Definition'


def tax_context():
    """화면 정의와 최소 규칙 메타데이터를 템플릿에 전달한다."""
    return {'tax_basic':BASIC,'tax_lots':LOTS,'tax_sale':SALE,'tax_conditions':CONDITIONS,'tax_metadata':{'version':TAX_DATA['version'],'rules':[{k:r[k] for k in ['country','taxYear','assetType','domesticForeignType','currency','status','taxableEvents','lastVerifiedAt','officialSources']} for r in TAX_DATA['rules']]}}
