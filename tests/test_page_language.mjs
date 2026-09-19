/** 실제 초기화 코드를 실행해 URL 언어와 기존 입력 세션의 동시 복원을 검증한다. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {localeFor} from '../src/coin/static/formatting.js';
import {createSession, KEY} from '../src/coin/static/session.js';
const dictionaries = readFileSync(new URL('../src/coin/translations.json', import.meta.url), 'utf8');
globalThis.document = {getElementById: () => ({dataset: {messages: dictionaries}})};
const {translator} = await import('../src/coin/static/i18n.js');
delete globalThis.document;
const source = readFileSync(new URL('../src/coin/static/app.js', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '');

/** 필요한 DOM 인터페이스만 제공해 앱 초기화와 이벤트 연결을 실행한다. */
function element(name = '') {
  return {name, value: '', dataset: {}, attributes: {}, handlers: {},
    setAttribute(key, value) { this.attributes[key] = value; },
    removeAttribute(key) { delete this.attributes[key]; },
    addEventListener(key, handler) { this.handlers[key] = handler; }};
}

for (const page of ['ko', 'en', 'ja', 'zh', 'es']) {
  for (const saved of [false, true]) {
    const controls = Object.fromEntries(['buy_price', 'sell_price', 'fee_percent', 'holding_unit', 'holding_value', 'additional_unit', 'additional_price', 'additional_value'].map(name => [name, element(name)]));
    const elements = new Map();
    const get = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
    const form = get('calculation-form');
    form.elements = {namedItem: name => controls[name]};
    form.querySelectorAll = () => Object.values(controls);
    form.querySelector = () => get('submit');
    form.reset = () => { for (const field of Object.values(controls)) field.value = ''; controls.holding_unit.value = controls.additional_unit.value = 'quantity'; controls.fee_percent.value = '0'; };
    const tabs = ['profit', 'average'].map(mode => ({...element(), dataset: {mode}}));
    const flags = ['ko', 'en-US', 'zh', 'ja', 'es'].map(lang => ({...element(), dataset: {lang}}));
    const data = new Map();
    if (saved) data.set(KEY, JSON.stringify({startedAt: Date.now(), data: {mode: 'average', language: page === 'ko' ? 'ja' : 'ko', currency: 'USD', drafts: {average: {buy_price: '100', holding_value: '2', holding_unit: 'quantity'}}}}));
    const storage = {getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key)};
    const document = {documentElement: {lang: page}, getElementById: get, addEventListener() {}, querySelectorAll: selector => selector === '[role=tab]' ? tabs : selector === '[data-lang]' ? flags : []};
    let marketLanguage;
    const context = vm.createContext({document, Event, window: {sessionStorage: storage, addEventListener() {}}, createSession, translator, localeFor, renderMarketRates() {}, refreshMarketRates() {}, startMarketRates: current => {marketLanguage = current().language;}, setTimeout: () => 1, clearTimeout() {}});
    vm.runInContext(source, context);
    const expected = translator(page);
    assert.equal(document.documentElement.lang, page);
    assert.equal(marketLanguage, expected.lang);
    assert.equal(get('form-title').textContent, expected.t(saved ? 'tabAverage' : 'tabProfit'));
    assert.equal(get('session-note').textContent, expected.t('session'));
    assert.equal(flags.filter(flag => flag.attributes['aria-current'] === 'page')[0].dataset.lang, expected.lang);
    assert.ok(flags.every(flag => !flag.handlers.click), '국기 링크의 기본 URL 이동을 가로채지 않는다');
    if (saved) {
      assert.equal(controls.buy_price.value, '100');
      assert.equal(controls.holding_value.value, '2');
      assert.equal(get('currency-select').value, 'USD');
    }
    // 실제 클릭·입력 핸들러로 탭별 저장과 매도 단가 버튼을 검증한다.
    tabs[0].handlers.click();
    controls.buy_price.value = '100';
    controls.buy_price.valueAsNumber = 100;
    controls.buy_price.checkValidity = () => true;
    controls.buy_price.focus = () => {};
    controls.sell_price.dispatchEvent = () => form.handlers.input();
    controls.holding_unit.value = 'quantity';
    controls.holding_value.value = '2';
    for (const [percent, expectedPrice] of [[5, '105'], [10, '110'], [20, '120']]) {
      context.applySellPreset(percent);
      assert.equal(controls.sell_price.value, expectedPrice);
      assert.equal(JSON.parse(data.get(KEY)).data.drafts.profit.sell_price, expectedPrice);
    }
    assert.equal(JSON.stringify(context.buildCalculationPayload()), JSON.stringify({
      mode: 'profit', buy_price: '100', quantity: '2', sell_price: '120', fee_percent: '0'
    }));
    controls.buy_price.valueAsNumber = NaN;
    context.applySellPreset(5);
    assert.equal(controls.sell_price.value, '120');
    assert.equal(get('error').hidden, false);
    tabs[1].handlers.click();
    controls.holding_unit.value = 'amount';
    controls.holding_value.value = '200';
    controls.additional_unit.value = 'amount';
    controls.additional_value.value = '50';
    controls.additional_price.value = '25';
    form.handlers.change();
    const payload = context.buildCalculationPayload();
    assert.equal(payload.amount, '200');
    assert.equal(payload.additional_amount, '50');
    assert.equal(payload.additional_price, '25');
    assert.equal('sell_price' in payload, false);
    assert.equal(get('holding-label').textContent, expected.t('holdingAmount'));
  }
}
console.log('5개 URL 언어·세션 복원·국기 링크·입력 저장·매도 버튼·요청 본문 검증 통과');
