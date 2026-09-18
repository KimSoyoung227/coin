/** 입력, 탭 접근성, Python API 호출 및 세션 만료를 연결한다. */
import {createSession} from './session.js';
import {translator} from './i18n.js';
import {refreshMarketRates, renderMarketRates, startMarketRates} from './rates.js';
const $ = id => document.getElementById(id);
const form = $('calculation-form');
const field = name => form.elements.namedItem(name);
const tabs = [...document.querySelectorAll('[role=tab]')];
const modes = ['profit', 'average'];
const names = [...form.querySelectorAll('input,select')].map(el => el.name);
const currencies = ['KRW', 'GBP', 'USD', 'EUR', 'CNY', 'JPY'];
let mode = 'profit', drafts = {}, language = 'ko', currency = 'KRW', t = translator(language).t, lastResult = null, sessionStatus = 'session', timer, requestId = 0, controller;
let session;
try { session = createSession(window.sessionStorage); }
catch { session = createSession({getItem: () => null, setItem: () => { throw Error(); }, removeItem() {}}); }
const descriptions = {profit: 'descProfit', average: 'descAverage'};
/** 정적 문구와 현재 화면 상태를 선택한 언어로 갱신한다. */
function applyLanguage(next, save = true) {
  const result = lastResult;
  ({lang: language, t} = translator(next));
  document.documentElement.lang = language;
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-content]').forEach(el => el.setAttribute('content', t(el.dataset.i18nContent)));
  document.querySelectorAll('[data-i18n-aria]').forEach(el => el.setAttribute('aria-label', t(el.dataset.i18nAria)));
  document.querySelectorAll('[data-lang]').forEach(el => el.setAttribute('aria-pressed', String(el.dataset.lang === language)));
  updateFields();
  $('form-title').textContent = t('tab' + mode[0].toUpperCase() + mode.slice(1));
  $('explanation').textContent = t(descriptions[mode]);
  $('session-note').textContent = t(sessionStatus);
  invalidate();
  if (result) renderResult(result);
  renderMarketRates(language, t);
  if (save) persist();
}
/** 선택 통화를 입력 단위와 기존 계산 결과에 즉시 반영한다. */
function applyCurrency(next, save = true) {
  currency = currencies.includes(next) ? next : 'KRW';
  $('currency-select').value = currency;
  document.querySelectorAll('[data-currency-unit]').forEach(el => { el.textContent = currency; });
  updateFields();
  if (lastResult) renderResult(lastResult);
  if (save) persist();
}
/** 이전 계산을 취소하여 변경 전 입력의 결과가 표시되지 않도록 한다. */
function invalidate() {
  lastResult = null;
  requestId++; controller?.abort();
  form.querySelector('[type=submit]').disabled = false;
  $('error').hidden = true;
  $('result-caption').textContent = t('prompt');
  $('result-body').className = 'result-empty';
  $('result-body').textContent = t(mode === 'profit' ? 'emptyProfit' : 'emptyAverage');
}
/** 수량/금액 선택에 맞게 레이블을 바꾸고 비활성 입력을 제외한다. */
function updateFields() {
  const profit = mode === 'profit';
  for (const name of ['sell', 'fee']) $(name + '-field').hidden = !profit;
  field('sell_price').disabled = field('fee_percent').disabled = !profit;
  $('additional-fields').hidden = profit;
  $('additional-fields').disabled = profit;
  for (const prefix of ['holding', 'additional']) {
    const amount = field(prefix + '_unit').value === 'amount';
    $(prefix + '-label').textContent = t(prefix === 'holding' ? (amount ? 'holdingAmount' : 'holdingQuantity') : (amount ? 'additionalAmount' : 'additionalQuantity'));
    $(prefix + '-suffix').textContent = amount ? currency : t('item');
    field(prefix + '_value').placeholder = amount ? '100000' : '0.5';
  }
}
/** 현재 탭의 입력을 복사한다. */
function capture() { drafts[mode] = Object.fromEntries(names.map(name => [name, field(name).value])); }
/** 만료 타이머는 입력할 때에도 최초 저장 시각을 유지한다. */
function persist() {
  capture();
  try {
    if (!session.save({mode, drafts, language, currency})) { reset(true); return; }
    clearTimeout(timer); timer = setTimeout(() => reset(true), session.remaining());
  } catch { sessionStatus = 'sessionUnavailable'; $('session-note').textContent = t(sessionStatus); }
}
/** 탭별 초안을 복원하고 키보드 포커스 및 ARIA 상태를 갱신한다. */
function selectMode(next, save = true) {
  mode = next;
  form.reset();
  const draft = drafts[mode];
  if (draft && typeof draft === 'object') {
    for (const name of names) if (typeof draft[name] === 'string') field(name).value = draft[name];
  }
  for (const name of ['holding_unit', 'additional_unit']) if (!['quantity', 'amount'].includes(field(name).value)) field(name).value = 'quantity';
  tabs.forEach(tab => { const active = tab.dataset.mode === mode; tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1; });
  $('calculator').setAttribute('aria-labelledby', 'tab-' + mode);
  $('form-title').textContent = t('tab' + mode[0].toUpperCase() + mode.slice(1));
  $('explanation').textContent = t(descriptions[mode]);
  updateFields(); invalidate();
  if (save) persist();
}
/** 저장값과 화면의 입력/결과를 함께 삭제한다. */
function reset(expired = false) {
  clearTimeout(timer); session.clear(); drafts = {}; selectMode('profit', false);
  sessionStatus = expired ? 'expired' : 'session';
  $('session-note').textContent = t(sessionStatus);
}
/** 백그라운드에서 타이머가 지연된 경우에도 복귀 시 만료를 확인한다. */
function checkExpiry() { if (session.expired()) { reset(true); return true; } return false; }
/** API 결과는 HTML 해석 없이 텍스트로 표시한다. */
function renderResult(result) {
  lastResult = result;
  const entries = mode === 'profit' ? [
    [t('profit'), result.profit, currency], [t('returnPercent'), result.return_percent, '%'],
    [t('investment'), result.investment, currency], [t('proceeds'), result.proceeds, currency], [t('fees'), result.fees, currency]
  ] : [
    [t('averagePrice'), result.average_price, currency], [t('priceChange'), result.price_change_percent, '%'],
    [t('totalAmount'), result.total_amount, currency], [t('totalQuantity'), result.total_quantity, t('item')]
  ];
  const body = $('result-body'); body.replaceChildren(); body.className = 'result-grid';
  entries.forEach(([label, value, unit], index) => {
    const metric = document.createElement('dl'); metric.className = 'metric' + (index < 2 ? ' featured' : '');
    const title = document.createElement('dt'); title.textContent = label;
    const amount = document.createElement('dd');
    amount.textContent = new Intl.NumberFormat({ko:'ko-KR','en-US':'en-US',es:'es-ES',zh:'zh-CN',ja:'ja-JP'}[language], {maximumSignificantDigits: 12}).format(value) + ' ' + unit;
    if (mode === 'profit' && index < 2) amount.className = value > 0 ? 'positive' : value < 0 ? 'negative' : '';
    metric.append(title, amount); body.append(metric);
  });
  $('result-caption').textContent = t(mode === 'profit' ? 'profitCaption' : 'averageCaption');
}
/** 활성 입력만 전송하며 변경·만료 이후 도착한 응답은 폐기한다. */
form.addEventListener('submit', async event => {
  event.preventDefault(); if (checkExpiry()) return;
  invalidate(); persist();
  const payload = {mode, buy_price: field('buy_price').value};
  payload[field('holding_unit').value] = field('holding_value').value;
  if (mode === 'profit') {
    payload.sell_price = field('sell_price').value; payload.fee_percent = field('fee_percent').value;
  } else {
    payload.additional_price = field('additional_price').value;
    payload[field('additional_unit').value === 'amount' ? 'additional_amount' : 'additional_quantity'] = field('additional_value').value;
  }
  const current = ++requestId; controller = new AbortController();
  form.querySelector('[type=submit]').disabled = true;
  $('result-caption').textContent = t('calculating');
  try {
    const response = await fetch('/api/calculate', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload), signal: controller.signal});
    const data = await response.json();
    if (checkExpiry() || current !== requestId) return;
    if (!response.ok) throw new Error(t('invalid'));
    renderResult(data.result);
  } catch (error) {
    if (current !== requestId || error.name === 'AbortError') return;
    $('error').textContent = error instanceof TypeError ? t('serverError') : error.message;
    $('error').hidden = false; $('result-caption').textContent = t('checkInput');
  } finally { if (current === requestId) form.querySelector('[type=submit]').disabled = false; }
});
form.addEventListener('input', () => { if (!checkExpiry()) { updateFields(); invalidate(); persist(); } });
form.addEventListener('change', () => { if (!checkExpiry()) { updateFields(); invalidate(); persist(); } });
tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => { if (!checkExpiry()) { capture(); selectMode(tab.dataset.mode); } });
  tab.addEventListener('keydown', event => {
    let next;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = tabs.length - 1;
    if (next !== undefined) { event.preventDefault(); tabs[next].focus(); tabs[next].click(); }
  });
});
$('clear-inputs').addEventListener('click', () => reset());
document.querySelectorAll('[data-lang]').forEach(button => button.addEventListener('click', () => applyLanguage(button.dataset.lang)));
$('currency-select').addEventListener('change', event => applyCurrency(event.target.value));
$('market-refresh').addEventListener('click', () => refreshMarketRates(language, t));
document.addEventListener('visibilitychange', checkExpiry);
window.addEventListener('pageshow', checkExpiry);
window.addEventListener('focus', checkExpiry);
const saved = session.load();
if (saved && ['profit', 'average', 'down', 'up'].includes(saved.mode) && saved.drafts && typeof saved.drafts === 'object') {
  // 이전 물타기·불타기 초안은 새 평균 단가 계산 탭으로 이전한다.
  if (['down', 'up'].includes(saved.mode)) {
    saved.drafts.average = saved.drafts[saved.mode]; saved.mode = 'average';
  }
  drafts = saved.drafts; language = translator(saved.language).lang; t = translator(language).t;
  currency = currencies.includes(saved.currency) ? saved.currency : 'KRW';
  applyLanguage(language, false); applyCurrency(currency, false); selectMode(saved.mode, false);
  timer = setTimeout(() => reset(true), session.remaining());
} else { session.clear(); applyLanguage('ko', false); applyCurrency('KRW', false); selectMode('profit', false); }
startMarketRates(() => ({language, t}));
