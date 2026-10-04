/* V2 browser presentation: inputs never leave the browser. */
import { ASSETS, calculateAverage, calculateTarget, calculateScenarios } from './v2-engine.js';
const form = document.querySelector('#calculator-form');

// Preserve decimal strings when grouping: display never round-trips through Number.
function format(value) {
  const [integer, fraction] = String(value).split('.');
  return integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fraction ? `.${fraction}` : '');
}
// 단가·금액은 문자열 기반 사사오입으로 정수 표시하고 계산 원본은 유지한다.
function displayDecimal(value, precision) {
  const text = String(value), negative = text.startsWith('-');
  const [whole, fraction = ''] = text.replace(/^-/, '').split('.');
  if (fraction.length <= precision) return format(text);
  const scale = 10n ** BigInt(precision);
  let rounded = BigInt(whole) * scale + BigInt(fraction.slice(0, precision) || '0');
  if (Number(fraction[precision]) >= 5) rounded += 1n;
  const tail = precision ? String(rounded % scale).padStart(precision, '0').replace(/0+$/, '') : '';
  return format(`${negative && rounded ? '-' : ''}${rounded / scale}${tail ? '.' + tail : ''}`);
}
// Build text-only DOM nodes so numeric input cannot become markup.
function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}
if (form) {
  const assetSelect = document.querySelector('#asset');
  const currency = document.querySelector('#currency');
  const goldUnit = document.querySelector('#gold-unit');
  const output = document.querySelector('#result');
  const empty = document.querySelector('#result-empty');
  const error = document.querySelector('#form-error');
  const slug = document.body.dataset.calculator;
  ASSETS.forEach(asset => { const option = node('option', asset.label); option.value = asset.id; assetSelect.append(option); });
  // Read active context and append labels without converting exact decimal strings.
  const asset = () => ASSETS.find(item => item.id === assetSelect.value);
  const unit = () => asset().id === 'GOLD' ? goldUnit.value : asset().unit;
  const money = value => `${displayDecimal(value, 0)} ${currency.value}`;
  const quantity = value => `${format(value)} ${unit()}`;

  // Clear results whenever a source condition changes, preventing stale comparisons.
  function invalidate() { output.hidden = true; output.replaceChildren(); empty.hidden = false; error.hidden = true; }
  // 자산별 정수 단가·수량 단위를 짧게 표시한다.
  function updateContext(resetCurrency = false) {
    if (resetCurrency) currency.value = asset().currency;
    document.querySelector('#gold-unit-field').hidden = asset().id !== 'GOLD';
    document.querySelector('#unit-note').textContent = `단가: ${currency.value}/${unit()} · 정수 입력 · 수량: ${unit()}${asset().quantityPrecision ? ` (소수 ${asset().quantityPrecision}자리)` : " (정수)"}`;
  }
  assetSelect.addEventListener('change', () => updateContext(true));
  currency.addEventListener('change', () => updateContext());
  goldUnit.addEventListener('change', () => {
    // Unit changes require fresh values, avoiding accidental reinterpretation of holdings.
    form.querySelectorAll('input').forEach(input => { input.value = ''; });
    updateContext();
  });
  form.addEventListener('input', invalidate);
  form.addEventListener('change', invalidate);
  form.addEventListener('reset', () => { invalidate(); queueMicrotask(() => updateContext(true)); });
  updateContext(true);

  // 단가·금액은 정수, 수량은 자산별 정밀도로 결과와 계산 과정을 표시한다.
  function renderResult(result, inputs) {
    const primary = node('div', undefined, 'result-primary');
    primary.append(node('p', slug === 'target-average' ? '필요한 추가수량' : '새로운 평균매입단가'));
    primary.append(node('strong', slug === 'target-average' ? quantity(result.additionalQuantity) : `${displayDecimal(result.averagePrice, asset().pricePrecision)} ${currency.value}`));
    primary.append(node('p', `평균단가 변화 ${money(result.priceChange)} (${displayDecimal(result.changePercent, 2)}%)`));

    output.append(primary);
    const list = node('dl', undefined, 'result-details');
    const rows = [['최종 평균매입단가', money(result.averagePrice)], ['기존 투자금', money(result.existingInvestment)], ['추가 투자금', money(result.additionalInvestment)], ['총 투자금', money(result.totalInvestment)], ['총 보유수량', quantity(result.totalQuantity)]];
    rows.forEach(([label, value]) => { const row = node('div'); row.append(node('dt', label), node('dd', value)); list.append(row); });
    output.append(list);
    const process = node('div', undefined, 'process');
    process.append(node('h3', '계산 과정'));
    if (slug === 'target-average' && result.additionalQuantity === '0') process.append(node('p', '현재 평균단가가 목표와 같아 추가 매수가 필요하지 않습니다.'));
    else if (slug === 'target-average') process.append(node('p', `필요 추가수량 = ${format(inputs.quantity)} × (${displayDecimal(inputs.buyPrice, 0)} − ${displayDecimal(inputs.targetPrice, 0)}) ÷ (${displayDecimal(inputs.targetPrice, 0)} − ${displayDecimal(inputs.additionalPrice, 0)}). 거래 단위로 올림한 수량: ${quantity(result.additionalQuantity)}`));
    process.append(node('p', `기존 투자금 ${money(result.existingInvestment)} + 추가 투자금 ${money(result.additionalInvestment)} = 총 투자금 ${money(result.totalInvestment)}`));
    process.append(node('p', `${money(result.totalInvestment)} ÷ ${quantity(result.totalQuantity)} ≈ ${money(result.averagePrice)} / ${unit()}`));
    process.append(node('p', '단가·금액은 정수로 반올림해 표시합니다. 수수료·세금 제외.'));
    output.append(process);
  }

  // Draw a compact SVG chart; the adjacent table exposes every value without vision.
  function chart(rows) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 480 230'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-labelledby', 'chart-title chart-desc'); svg.classList.add('scenario-chart');
    const add = (tag, attributes, text) => { const el = document.createElementNS(ns, tag); Object.entries(attributes).forEach(([key, value]) => el.setAttribute(key, value)); if (text) el.textContent = text; svg.append(el); return el; };
    add('title', { id: 'chart-title' }, '시나리오별 평균매입단가');
    add('desc', { id: 'chart-desc' }, '가로축은 입력 순서의 시나리오 번호, 세로축은 평균매입단가입니다. 단가는 정수로 반올림하며 조건별 값은 아래 표에 있습니다.');
    const values = rows.map(row => Number(row.averagePrice));
    const min = Math.min(...values), max = Math.max(...values), spread = max - min;
    const points = values.map((value, index) => [65 + index * 385 / (values.length - 1), spread === 0 ? 106 : 176 - (value - min) / spread * 140]);
    add('line', { x1: 65, y1: 26, x2: 65, y2: 184, class: 'chart-axis' });
    add('line', { x1: 65, y1: 184, x2: 450, y2: 184, class: 'chart-axis' });
    add('text', { x: 4, y: 16, class: 'chart-label' }, `평균단가 (${currency.value})`);
    add('text', { x: 4, y: 40, class: 'chart-label' }, displayDecimal(rows[values.indexOf(max)].averagePrice, 0));
    if (spread) add('text', { x: 4, y: 178, class: 'chart-label' }, displayDecimal(rows[values.indexOf(min)].averagePrice, 0));
    add('polyline', { points: points.map(point => point.join(',')).join(' '), class: 'chart-line' });
    points.forEach(([x, y], index) => { add('circle', { cx: x, cy: y, r: 4, class: 'chart-dot' }); add('text', { x, y: 208, 'text-anchor': 'middle', class: 'chart-label' }, `조건 ${index + 1}`); });
    return svg;
  }

  // 시나리오 표에서도 단가·금액은 정수, 수량과 비율은 별도 형식으로 표시한다.
  function renderScenarios(rows, amountMode, inputs) {
    output.append(node('p', `${rows.length}개 조건을 비교했습니다. 연결선은 입력한 조건의 순서를 나타냅니다.`, 'quiet'), chart(rows));
    const wrapper = node('div', undefined, 'table-scroll'); wrapper.tabIndex = 0; wrapper.setAttribute('role', 'region'); wrapper.setAttribute('aria-label', '시나리오 결과 표, 가로 스크롤 가능');
    const table = node('table'); table.append(node('caption', `금액: ${currency.value} · 수량: ${unit()}`));
    const head = node('thead'), headRow = node('tr');
    const labels = ['조건', ...(amountMode ? ['입력 예산', '미사용 금액'] : []), '추가수량', '추가 투자금', '새 평균단가', '변화액', '변화율'];
    labels.forEach(label => { const th = node('th', label); th.scope = 'col'; headRow.append(th); }); head.append(headRow); table.append(head);
    const body = node('tbody');
    rows.forEach((row, index) => { const tr = node('tr'); const values = [String(index + 1), ...(amountMode ? [displayDecimal(row.requestedInvestment, 0), displayDecimal(row.unspentInvestment, 0)] : []), format(row.additionalQuantity), displayDecimal(row.additionalInvestment, 0), displayDecimal(row.averagePrice, 0), displayDecimal(row.priceChange, 0), `${displayDecimal(row.changePercent, 2)}%`]; values.forEach(value => tr.append(node('td', value))); body.append(tr); });
    table.append(body); wrapper.append(table); output.append(wrapper);
    const process = node('div', undefined, 'process');
    process.append(node('h3', '계산 과정'), node('p', `각 조건: (${displayDecimal(inputs.buyPrice, 0)} × ${format(inputs.quantity)} + ${displayDecimal(inputs.additionalPrice, 0)} × 추가수량) ÷ (${format(inputs.quantity)} + 추가수량)`));
    if (amountMode) process.append(node('p', '추가수량 = 입력 예산 ÷ 추가 매수가를 거래 단위로 내림. 실제 투자금과 남는 금액을 분리해 표시합니다.'));
    process.append(node('p', '단가·금액은 정수로 반올림해 표시합니다.'));
    output.append(process);
  }
  form.addEventListener('submit', event => {
    event.preventDefault(); invalidate();
    try {
      const inputs = { asset: assetSelect.value };
      for (const name of ['buyPrice', 'quantity', 'additionalPrice', 'additionalQuantity', 'targetPrice']) {
        if (form.elements[name]) inputs[name] = form.elements[name].value.trim();
      }
      if (slug === 'additional-buy') {
        const mode = document.querySelector('#scenario-mode').value;
        const values = document.querySelector('#scenarios').value.split(',').map(value => value.trim());
        if (values.length < 2 || values.length > 8 || values.some(value => !value)) throw new Error('비교할 값을 쉼표로 구분해 2~8개 입력해 주세요.');
        renderScenarios(calculateScenarios({ ...inputs, [mode]: values }), mode === 'amounts', inputs);
      } else renderResult(slug === 'target-average' ? calculateTarget(inputs) : calculateAverage(inputs), inputs);
      empty.hidden = true; output.hidden = false;
    } catch (exception) {
      error.textContent = exception.message || '입력값을 확인해 주세요.'; error.hidden = false;
    }
  });
  document.querySelector("#calculator-fields").disabled = false;
}
