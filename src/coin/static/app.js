/** 입력, 탭 접근성, Python API 호출 및 세션 만료를 연결한다. */
import {createSession} from './session.js';
import {translator} from './i18n.js';
import {localeFor} from './formatting.js';
import {refreshMarketRates, renderMarketRates, startMarketRates} from './rates.js';
/** ID에 해당하는 화면 요소를 찾는다. */
const byId = id => document.getElementById(id);
const form = byId('calculation-form');
/** 이름에 해당하는 계산 입력 컨트롤을 찾는다. */
const field = name => form.elements.namedItem(name);
const tabs = [...document.querySelectorAll('[role=tab]')];
const names = [...form.querySelectorAll('input,select')].map(el => el.name);
const currencies = ['KRW', 'GBP', 'USD', 'EUR', 'CNY', 'JPY'];
const pageLanguage = translator(document.documentElement.lang).lang;
let mode = 'profit';
let drafts = {};
let language = pageLanguage;
let currency = 'KRW';
let t = translator(language).t;
let lastResult = null;
let sessionStatus = 'session';
let timer;
let requestId = 0;
let controller;
let session;
try { session = createSession(window.sessionStorage); }
catch { session = createSession({getItem: () => null, setItem: () => { throw Error(); }, removeItem() {}}); }
const descriptions = {profit: 'descProfit', average: 'descAverage'};
/** 현재 계산 탭의 제목과 설명을 함께 갱신한다. */
function updateModeHeading() {
  const titleKey = mode === 'profit' ? 'tabProfit' : 'tabAverage';
  byId('form-title').textContent = t(titleKey);
  byId('explanation').textContent = t(descriptions[mode]);
}

/** 정적 문구와 현재 화면 상태를 선택한 언어로 갱신한다. */
function applyLanguage(next, save = true) {
  const result = lastResult;
  ({lang: language, t} = translator(next));
  document.documentElement.lang = language === 'en-US' ? 'en' : language;
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-content]').forEach(el => el.setAttribute('content', t(el.dataset.i18nContent)));
  document.querySelectorAll('[data-i18n-aria]').forEach(el => el.setAttribute('aria-label', t(el.dataset.i18nAria)));
  document.querySelectorAll('[data-lang]').forEach(el => {
    if (el.dataset.lang === language) el.setAttribute('aria-current', 'page');
    else el.removeAttribute('aria-current');
  });
  updateFields();
  updateModeHeading();
  byId('session-note').textContent = t(sessionStatus);
  invalidate();
  if (result) renderResult(result);
  renderMarketRates(language, t);
  if (save) persist();
}
/** 선택 통화를 입력 단위와 기존 계산 결과에 즉시 반영한다. */
function applyCurrency(next, save = true) {
  currency = currencies.includes(next) ? next : 'KRW';
  byId('currency-select').value = currency;
  document.querySelectorAll('[data-currency-unit]').forEach(el => { el.textContent = currency; });
  updateFields();
  if (lastResult) renderResult(lastResult);
  if (save) persist();
}
/** 이전 계산을 취소하여 변경 전 입력의 결과가 표시되지 않도록 한다. */
function invalidate() {
  lastResult = null;
  requestId++;
  controller?.abort();
  form.querySelector('[type=submit]').disabled = false;
  byId('error').hidden = true;
  byId('result-caption').textContent = t('prompt');
  byId('result-body').className = 'result-empty';
  byId('result-body').textContent = t(mode === 'profit' ? 'emptyProfit' : 'emptyAverage');
}
/** 수량/금액 선택에 맞게 레이블을 바꾸고 비활성 입력을 제외한다. */
function updateFields() {
  const profit = mode === 'profit';
  for (const name of ['sell', 'fee']) byId(name + '-field').hidden = !profit;
  field('sell_price').disabled = field('fee_percent').disabled = !profit;
  byId('additional-fields').hidden = profit;
  byId('additional-fields').disabled = profit;
  for (const prefix of ['holding', 'additional']) {
    const amount = field(prefix + '_unit').value === 'amount';
    byId(prefix + '-label').textContent = t(prefix + (amount ? 'Amount' : 'Quantity'));
    byId(prefix + '-suffix').textContent = amount ? currency : t('item');
    field(prefix + '_value').placeholder = amount ? '100000' : '0.5';
  }
}
/** 현재 탭의 입력을 복사한다. */
function capture() {
  drafts[mode] = Object.fromEntries(names.map(name => [name, field(name).value]));
}
/** 만료 타이머는 입력할 때에도 최초 저장 시각을 유지한다. */
function persist() {
  capture();
  try {
    if (!session.save({mode, drafts, language, currency})) {
      reset(true);
      return;
    }
    clearTimeout(timer);
    timer = setTimeout(() => reset(true), session.remaining());
  } catch {
    sessionStatus = 'sessionUnavailable';
    byId('session-note').textContent = t(sessionStatus);
  }
}
/** 탭별 초안을 복원하고 키보드 포커스 및 ARIA 상태를 갱신한다. */
function selectMode(next, save = true) {
  mode = next;
  form.reset();
  const draft = drafts[mode];
  if (draft && typeof draft === 'object') {
    for (const name of names) {
      if (typeof draft[name] === 'string') field(name).value = draft[name];
    }
  }
  for (const name of ['holding_unit', 'additional_unit']) {
    if (!['quantity', 'amount'].includes(field(name).value)) field(name).value = 'quantity';
  }
  tabs.forEach(tab => {
    const active = tab.dataset.mode === mode;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
  });
  byId('calculator').setAttribute('aria-labelledby', 'tab-' + mode);
  updateModeHeading();
  updateFields();
  invalidate();
  if (save) persist();
}
/** 저장값과 화면의 입력/결과를 함께 삭제한다. */
function reset(expired = false) {
  clearTimeout(timer);
  session.clear();
  drafts = {};
  selectMode('profit', false);
  sessionStatus = expired ? 'expired' : 'session';
  byId('session-note').textContent = t(sessionStatus);
}
/** 백그라운드에서 타이머가 지연된 경우에도 복귀 시 만료를 확인한다. */
function checkExpiry() {
  if (!session.expired()) return false;
  reset(true);
  return true;
}
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
  const body = byId('result-body'); body.replaceChildren(); body.className = 'result-grid';
  entries.forEach(([label, value, unit], index) => {
    const metric = document.createElement('dl'); metric.className = 'metric' + (index < 2 ? ' featured' : '');
    const title = document.createElement('dt'); title.textContent = label;
    const amount = document.createElement('dd');
    amount.textContent = new Intl.NumberFormat(localeFor(language), {maximumSignificantDigits: 12}).format(value) + ' ' + unit;
    if (mode === 'profit' && index < 2) amount.className = value > 0 ? 'positive' : value < 0 ? 'negative' : '';
    metric.append(title, amount); body.append(metric);
  });
  byId('result-caption').textContent = t(mode === 'profit' ? 'profitCaption' : 'averageCaption');
}
/** 활성 탭과 수량·금액 선택에 맞는 API 요청 본문을 만든다. */
function buildCalculationPayload() {
  const payload = {mode, buy_price: field('buy_price').value};
  payload[field('holding_unit').value] = field('holding_value').value;
  if (mode === 'profit') {
    payload.sell_price = field('sell_price').value;
    payload.fee_percent = field('fee_percent').value;
  } else {
    payload.additional_price = field('additional_price').value;
    payload[field('additional_unit').value === 'amount' ? 'additional_amount' : 'additional_quantity'] = field('additional_value').value;
  }
  return payload;
}

/** 활성 입력만 전송하며 변경·만료 이후 도착한 응답은 폐기한다. */
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (checkExpiry()) return;
  invalidate();
  persist();
  const payload = buildCalculationPayload();
  const current = ++requestId;
  controller = new AbortController();
  form.querySelector('[type=submit]').disabled = true;
  byId('result-caption').textContent = t('calculating');
  try {
    const response = await fetch('/api/calculate', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload), signal: controller.signal});
    const data = await response.json();
    if (checkExpiry() || current !== requestId) return;
    if (!response.ok) throw new Error(t('invalid'));
    renderResult(data.result);
  } catch (error) {
    if (current !== requestId || error.name === 'AbortError') return;
    byId('error').textContent = error instanceof TypeError ? t('serverError') : error.message;
    byId('error').hidden = false;
    byId('result-caption').textContent = t('checkInput');
  } finally {
    if (current === requestId) form.querySelector('[type=submit]').disabled = false;
  }
});
/** 입력 변경 시 만료 확인, 화면 갱신 및 저장을 동일한 순서로 수행한다. */
function handleInputChange() {
  if (checkExpiry()) return;
  updateFields();
  invalidate();
  persist();
}
form.addEventListener('input', handleInputChange);
form.addEventListener('change', handleInputChange);
/** 매수 단가에 선택한 상승률을 적용하고 입력 변경 및 세션 저장을 연결한다. */
function applySellPreset(percent) {
  if (checkExpiry() || mode !== 'profit') return;
  const buy = field('buy_price');
  const price = buy.valueAsNumber * (1 + Number(percent) / 100);
  if (!buy.checkValidity() || !(buy.valueAsNumber > 0) || !Number.isFinite(price)) {
    byId('error').textContent = t('invalid');
    byId('error').hidden = false;
    buy.focus();
    return;
  }
  // 부동소수점 연산 잔여 자릿수를 제거하고 소액 코인 단가도 유지한다.
  field('sell_price').value = String(Number(price.toPrecision(15)));
  field('sell_price').dispatchEvent(new Event('input', {bubbles: true}));
}
document.querySelectorAll('[data-sell-percent]').forEach(button => {
  button.addEventListener('click', () => applySellPreset(button.dataset.sellPercent));
});
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
byId('clear-inputs').addEventListener('click', () => reset());
// 언어 링크는 URL로 이동하며 입력값은 기존 세션에서 복원한다.
byId('currency-select').addEventListener('change', event => applyCurrency(event.target.value));
byId('market-refresh').addEventListener('click', () => refreshMarketRates(language, t));
document.addEventListener('visibilitychange', checkExpiry);
window.addEventListener('pageshow', checkExpiry);
window.addEventListener('focus', checkExpiry);
/** 저장된 탭·입력을 복원하되 표시 언어는 현재 URL을 따른다. */
function restoreSession() {
  const saved = session.load();
  if (saved && ['profit', 'average', 'down', 'up'].includes(saved.mode) && saved.drafts && typeof saved.drafts === 'object') {
    // 이전 물타기·불타기 초안은 새 평균 단가 계산 탭으로 이전한다.
    if (['down', 'up'].includes(saved.mode)) {
      saved.drafts.average = saved.drafts[saved.mode];
      saved.mode = 'average';
    }
    drafts = saved.drafts; // 저장된 언어보다 현재 URL의 언어를 우선한다.
    currency = currencies.includes(saved.currency) ? saved.currency : 'KRW';
    applyLanguage(language, false);
    applyCurrency(currency, false);
    selectMode(saved.mode, false);
    timer = setTimeout(() => reset(true), session.remaining());
  } else {
    session.clear();
    applyLanguage(pageLanguage, false);
    applyCurrency('KRW', false);
    selectMode('profit', false);
  }
}

restoreSession();
startMarketRates(() => ({language, t}));
