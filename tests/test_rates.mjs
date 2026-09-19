/** 시세 렌더링을 실제 조회 함수와 연결해 통화 환산·부분 실패·갱신 오류를 검증한다. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {localeFor} from '../src/coin/static/formatting.js';

/** 시세 표에 필요한 DOM 자식 추가와 초기화 동작을 제공한다. */
function element() {
  return {children: [], textContent: '', value: 'KRW', hidden: false,
    append(...children) { this.children.push(...children); },
    replaceChildren() { this.children = []; }};
}
const elements = new Map();
const document = {createElement: element, getElementById(id) {
  if (!elements.has(id)) elements.set(id, element());
  return elements.get(id);
}};
let response = {ok: true, data: {groups: {
  currencies: {items: {KRW: 1, USD: 1400}, completed_at: '2026-09-18T00:00:00Z', stale: true},
  bitcoin: {items: {BTC: 140000000}, completed_at: '2026-09-18T00:00:00Z'}
}, errors: ['metals']}};
const sourcePath = process.argv[2] || new URL('../src/coin/static/rates.js', import.meta.url);
const source = readFileSync(sourcePath, 'utf8').replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
const context = vm.createContext({document, localeFor, fetch: async () => ({ok: response.ok, json: async () => response.data})});
vm.runInContext(source, context);
await context.refreshMarketRates('en-US', key => key);
const body = document.getElementById('market-body');
assert.equal(body.children.length, 10);
assert.equal(body.children[1].children[1].textContent, '1,400 KRW');
assert.equal(body.children[6].children[1].textContent, '—');
assert.equal(body.children[9].children[1].textContent, '140,000,000 KRW/BTC');
assert.equal(document.getElementById('market-error').textContent, 'marketPartialError');
assert.equal(document.getElementById('market-error').hidden, false);
assert.ok(document.getElementById('market-times').children[0].textContent.endsWith(' · marketStale'));
document.getElementById('market-base-currency').value = 'USD';
context.renderMarketRates('en-US', key => key);
assert.equal(body.children[9].children[1].textContent, '100,000 USD/BTC');
response = {ok: false, data: {groups: {}, errors: ['currencies', 'metals', 'bitcoin']}};
await context.refreshMarketRates('en-US', key => key);
assert.equal(document.getElementById('market-error').textContent, 'marketError');
assert.equal(document.getElementById('market-refresh').disabled, false);
assert.equal(body.children[9].children[1].textContent, '100,000 USD/BTC');
console.log('시세 렌더링, 기준 통화 환산, 이전 시세 및 조회 오류 검증 통과');
