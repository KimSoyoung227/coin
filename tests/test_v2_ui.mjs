/** 실제 V2 이벤트 처리기를 최소 DOM에 연결하여 계산·초기화·오류와 로컬 처리를 검증한다. */
import assert from 'node:assert/strict';

/** 화면이 사용하는 DOM 메서드와 선택값 기본 동작만 제공한다. */
class Element {
  constructor(tag = 'div') { this.tag = tag; this.children = []; this.handlers = {}; this.value = ''; this.hidden = false; this.attributes = {}; this.classList = {add() {}}; this.ownText = ''; }
  append(...children) { this.children.push(...children); if (this.tag === 'select' && this.value === '' && children.length) this.value = children[0].value; }
  replaceChildren(...children) { this.children = children; }
  addEventListener(type, handler) { (this.handlers[type] ??= []).push(handler); }
  dispatch(type) { for (const handler of this.handlers[type] ?? []) handler({preventDefault() {}}); }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  set textContent(value) { this.ownText = String(value); this.children = []; }
  get textContent() { return this.ownText + this.children.map(child => child.textContent).join(' '); }
  querySelectorAll(selector) { assert.equal(selector, 'input'); return Object.values(this.elements); }
}

/** 계산기마다 독립적인 DOM과 모듈 인스턴스를 구성한다. */
async function setup(slug) {
  const ids = ['calculator-fields', 'calculator-form', 'asset', 'currency', 'gold-unit', 'result', 'result-empty', 'form-error', 'gold-unit-field', 'unit-note', 'scenario-mode', 'scenarios'];
  const elements = Object.fromEntries(ids.map(id => [id, new Element(['asset', 'currency', 'gold-unit'].includes(id) ? 'select' : 'div')]));
  const form = elements['calculator-form'];
  form.elements = Object.fromEntries(['buyPrice', 'quantity', 'additionalPrice', 'additionalQuantity', 'targetPrice'].map(name => [name, new Element('input')]));
  for (const [name, value] of Object.entries({buyPrice: '100', quantity: '10', additionalPrice: '50', additionalQuantity: '10', targetPrice: '74'})) form.elements[name].value = value;
  elements['gold-unit'].value = 'g';
  globalThis.document = {body: {dataset: {calculator: slug}}, querySelector: selector => elements[selector.slice(1)], createElement: tag => new Element(tag), createElementNS: (_namespace, tag) => new Element(tag)};
  await import(`../src/coin/static/v2.js?test=${slug}`);
  return {elements, form, result: elements.result, error: elements['form-error']};
}
const originalFetch = globalThis.fetch;
globalThis.fetch = () => { throw new Error('투자 입력은 네트워크에 전송하면 안 됩니다.'); };
try {
  const average = await setup('average-price');
  average.form.dispatch('submit');
  assert.equal(average.result.hidden, false);
  assert.match(average.result.textContent, /75 KRW/);
  assert.match(average.result.textContent, /1,500 KRW/);
  average.form.elements.buyPrice.value = '9007199254740993';
  average.form.elements.additionalPrice.value = '9007199254740995';
  average.form.dispatch('submit');
  assert.match(average.result.textContent, /9,007,199,254,740,994 KRW/);
  average.form.elements.buyPrice.value = '0.000000000000000002';
  average.form.elements.additionalPrice.value = '0.000000000000000001';
  average.form.dispatch('submit');
  assert.equal(average.error.hidden, false);
  assert.match(average.error.textContent, /정수/);
  assert.equal(average.result.hidden, true);
  // 정수 단가와 소수 코인 수량을 계산하고 단가·금액 표시만 반올림한다.
  average.elements.asset.value = 'CRYPTO'; average.elements.asset.dispatch('change');
  Object.assign(average.form.elements.buyPrice, {value: '100'});
  Object.assign(average.form.elements.additionalPrice, {value: '50'});
  Object.assign(average.form.elements.quantity, {value: '0.00000001'});
  Object.assign(average.form.elements.additionalQuantity, {value: '0.00000002'});
  average.form.dispatch('submit');
  assert.match(average.result.textContent, /67 KRW/);
  assert.doesNotMatch(average.result.textContent, /66\.666/);
  assert.match(average.result.textContent, /0\.00000003 개/);
  average.elements.asset.value = 'DOMESTIC_STOCK'; average.elements.asset.dispatch('change');
  average.form.dispatch('input');
  assert.equal(average.result.hidden, true);
  assert.equal(average.result.children.length, 0);
  average.form.elements.quantity.value = '1.5';
  average.form.dispatch('submit');
  assert.equal(average.error.hidden, false);
  assert.equal(average.result.hidden, true);
  average.form.dispatch('reset');
  await Promise.resolve();
  assert.equal(average.error.hidden, true);
  assert.equal(average.elements['result-empty'].hidden, false);
  average.elements.asset.value = 'GOLD'; average.elements.asset.dispatch('change'); average.form.dispatch('change');
  assert.equal(average.elements['gold-unit-field'].hidden, false);
  average.elements['gold-unit'].value = 'oz'; average.elements['gold-unit'].dispatch('change');
  assert.ok(Object.values(average.form.elements).every(input => input.value === ''));
  assert.match(average.elements['unit-note'].textContent, /oz/);

  const target = await setup('target-average');
  target.form.dispatch('submit');
  assert.match(target.result.textContent, /11 주/);
  assert.match(target.result.textContent, /74 KRW/);
  assert.doesNotMatch(target.result.textContent, /73\.809/);
  target.form.elements.targetPrice.value = '100';
  target.form.elements.additionalPrice.value = '100';
  target.form.dispatch('submit');
  assert.match(target.result.textContent, /추가 매수가 필요하지 않습니다/);
  assert.doesNotMatch(target.result.textContent, /필요 추가수량 =/);
  target.form.elements.additionalPrice.value = '50';
  target.form.elements.targetPrice.value = '50'; target.form.dispatch('submit');
  assert.equal(target.error.hidden, false);
  assert.equal(target.result.hidden, true);

  const scenarios = await setup('additional-buy');
  scenarios.elements['scenario-mode'].value = 'amounts';
  scenarios.elements.scenarios.value = '125,250'; scenarios.form.dispatch('submit');
  assert.equal(scenarios.error.hidden, true);
  assert.match(scenarios.result.textContent, /미사용 금액/);
  assert.match(scenarios.result.textContent, /125 25 2 100/);
  assert.match(scenarios.result.textContent, /92/);
  assert.doesNotMatch(scenarios.result.textContent, /91\.666/);
  const chart = scenarios.result.children.find(child => child.tag === 'svg');
  const points = chart.children.find(child => child.tag === 'polyline').attributes.points;
  assert.doesNotMatch(points, /NaN|Infinity/);
  scenarios.elements.scenarios.value = '125'; scenarios.form.dispatch('submit');
  assert.equal(scenarios.error.hidden, false);
  assert.equal(scenarios.result.hidden, true);
} finally { globalThis.fetch = originalFetch; delete globalThis.document; }
console.log('V2 DOM 이벤트, 정확한 표시, 목표 및 예산 비교 검증 통과');
