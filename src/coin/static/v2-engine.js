/** 브라우저 전용 평균매입 계산 엔진. 입력은 최대 소수 18자리와 정수 24자리다.
 * BigInt 유리수로 중간값을 정확히 유지하고 결과만 소수 18자리에서 반올림한다.
 * 단가·예산은 정수로 입력하고 수량 소수점은 가상자산에만 허용한다.
 * 중간값은 반올림하지 않으며 정수 표시와 계산 precision을 분리한다.
 */
export const ASSETS = Object.freeze([
  {id: 'DOMESTIC_STOCK', label: '국내주식', currency: 'KRW', unit: '주', pricePrecision: 0, quantityPrecision: 0},
  {id: 'FOREIGN_STOCK', label: '해외주식', currency: 'USD', unit: '주', pricePrecision: 0, quantityPrecision: 0},
  {id: 'ETF', label: 'ETF', currency: 'KRW', unit: '주', pricePrecision: 0, quantityPrecision: 0},
  {id: 'GOLD', label: '금', currency: 'KRW', unit: 'g', pricePrecision: 0, quantityPrecision: 0},
  {id: 'CRYPTO', label: '비트코인/가상자산', currency: 'KRW', unit: '개', pricePrecision: 0, quantityPrecision: 8},
  {id: 'OTHER', label: '기타 투자자산', currency: 'KRW', unit: '단위', pricePrecision: 0, quantityPrecision: 0},
].map(asset => Object.freeze(asset)));
const SCALE = 10n ** 18n;
const MAX = 10n ** 24n * SCALE;

/** 선택한 자산의 수량 거래단위를 가져온다. */
function assetRule(id) {
  const rule = ASSETS.find(asset => asset.id === id);
  if (!rule) throw new Error('지원하는 자산 종류를 선택해주세요.');
  return rule;
}

/** 숫자 문자열을 18자리 고정 소수 정수로 읽고 범위와 거래단위를 검증한다. */
function parse(value, label, precision = 18, allowZero = false) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (raw.length > 44 || !/^\d+(?:\.\d+)?$/.test(raw)) throw new Error(`${label}: 올바른 숫자를 입력해주세요.`);
  if (precision === 0 && raw.includes('.')) throw new Error(`${label}: 소수점 없이 정수로 입력해주세요.`);
  const [integer, fractional = ''] = raw.split('.');
  if (fractional.length > 18 || /[1-9]/.test(fractional.slice(precision))) {
    throw new Error(`${label}: 소수 ${precision}자리까지 입력할 수 있습니다.`);
  }
  const result = BigInt(integer) * SCALE + BigInt(fractional.padEnd(18, '0'));
  if (result >= MAX || result < 0n || (!allowZero && result === 0n)) {
    throw new Error(`${label}: ${allowZero ? '0 이상' : '0보다 큰'} 24자리 이하 숫자를 입력해주세요.`);
  }
  return result;
}

/** 정확한 유리수를 소수 18자리에서 절댓값 사사오입하여 정규 문자열로 출력한다. */
function decimal(numerator, denominator = SCALE) {
  const negative = numerator < 0n;
  const absolute = negative ? -numerator : numerator;
  const rounded = (absolute * SCALE * 2n + denominator) / (denominator * 2n);
  const whole = rounded / SCALE;
  const fraction = String(rounded % SCALE).padStart(18, '0').replace(/0+$/, '');
  return `${negative && rounded !== 0n ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

/** 공통 입력의 가격과 수량을 검증한다. */
function inputs(input) {
  const rule = assetRule(input.asset);
  return {
    rule,
    buy: parse(input.buyPrice, '현재 평균매입단가', 0),
    quantity: parse(input.quantity, '현재 보유수량', rule.quantityPrecision),
    extra: parse(input.additionalPrice, '추가 매수가', 0),
  };
}

/** 검증된 정수 입력으로 투자금과 가중평균을 정확하게 계산한다. */
function average(buy, quantity, extra, extraQuantity) {
  const existing = buy * quantity;
  const additional = extra * extraQuantity;
  const total = existing + additional;
  const totalQuantity = quantity + extraQuantity;
  const difference = total - buy * totalQuantity;
  return {
    averagePrice: decimal(total, totalQuantity * SCALE),
    priceChange: decimal(difference, totalQuantity * SCALE),
    changePercent: decimal(difference * 100n, buy * totalQuantity),
    existingInvestment: decimal(existing, SCALE * SCALE),
    additionalInvestment: decimal(additional, SCALE * SCALE),
    totalInvestment: decimal(total, SCALE * SCALE),
    totalQuantity: decimal(totalQuantity),
  };
}

/** 추가 매수 수량을 입력받아 평균매입단가와 변화액을 반환한다. */
export function calculateAverage(input) {
  const {rule, buy, quantity, extra} = inputs(input);
  const extraQuantity = parse(input.additionalQuantity, '추가 매수수량', rule.quantityPrecision, true);
  return average(buy, quantity, extra, extraQuantity);
}

/** 목표까지 도달하는 최소 추가수량을 거래단위로 올림하고 실제 평균을 반환한다. */
export function calculateTarget(input) {
  const {rule, buy, quantity, extra} = inputs(input);
  const target = parse(input.targetPrice, '목표 평균단가', 0);
  if (target === buy) return {...average(buy, quantity, extra, 0n), additionalQuantity: '0'};
  if (!((extra < target && target < buy) || (buy < target && target < extra))) {
    throw new Error('목표 평균단가는 현재 평균단가와 추가 매수가 사이여야 합니다. 추가 매수가와 같은 목표는 유한한 수량으로 도달할 수 없습니다.');
  }
  const distance = buy > target ? buy - target : target - buy;
  const gap = target > extra ? target - extra : extra - target;
  const lot = 10n ** BigInt(18 - rule.quantityPrecision);
  const numerator = quantity * distance;
  const denominator = gap * lot;
  const extraQuantity = ((numerator + denominator - 1n) / denominator) * lot;
  if (extraQuantity >= MAX) throw new Error('필요한 추가수량이 계산 가능한 범위를 초과했습니다.');
  return {...average(buy, quantity, extra, extraQuantity), additionalQuantity: decimal(extraQuantity)};
}

/** 최대 20개 수량/투자금 조건을 비교하며 투자금은 거래단위로 내림하고 잔액을 남긴다. */
export function calculateScenarios(input) {
  const {rule, buy, quantity, extra} = inputs(input);
  const values = input.amounts ?? input.quantities;
  const amountMode = input.amounts !== undefined;
  if (!Array.isArray(values) || !values.length || values.length > 20) {
    throw new Error('비교할 조건을 1개 이상 20개 이하로 입력해주세요.');
  }
  return values.map(value => {
    const requested = amountMode ? parse(value, '시나리오 투자금', 0, true) : null;
    const lot = 10n ** BigInt(18 - rule.quantityPrecision);
    const extraQuantity = amountMode
      ? (requested * SCALE / (extra * lot)) * lot
      : parse(value, '시나리오 추가수량', rule.quantityPrecision, true);
    if (extraQuantity >= MAX) throw new Error('추가수량이 계산 가능한 범위를 초과했습니다.');
    return {...average(buy, quantity, extra, extraQuantity), additionalQuantity: decimal(extraQuantity),
      ...(amountMode ? {requestedInvestment: decimal(requested), unspentInvestment: decimal(requested * SCALE - extra * extraQuantity, SCALE * SCALE)} : {})};
  });
}
