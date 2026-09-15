/** 입력, 탭 접근성, Python API 호출 및 세션 만료를 연결한다. */
import {createSession} from './session.js';
const $ = id => document.getElementById(id);
const form = $('calculation-form');
const field = name => form.elements.namedItem(name);
const tabs = [...document.querySelectorAll('[role=tab]')];
const modes = ['profit', 'down', 'up'];
const names = [...form.querySelectorAll('input,select')].map(el => el.name);
let mode = 'profit', drafts = {}, timer, requestId = 0, controller;
let session;
try { session = createSession(window.sessionStorage); }
catch { session = createSession({getItem: () => null, setItem: () => { throw Error(); }, removeItem() {}}); }
const descriptions = {
  profit: '매수·매도 단가와 보유 수량 또는 투자금액을 입력하세요. 수수료율은 매수와 매도에 각각 적용됩니다.',
  down: '기존 단가보다 낮은 가격에 추가 매수할 때의 평균 단가를 계산합니다. 매수금액과 평균 단가는 수수료를 제외합니다.',
  up: '기존 단가보다 높은 가격에 추가 매수할 때의 평균 단가를 계산합니다. 매수금액과 평균 단가는 수수료를 제외합니다.'
};
/** 이전 계산을 취소하여 변경 전 입력의 결과가 표시되지 않도록 한다. */
function invalidate() {
  requestId++; controller?.abort();
  form.querySelector('[type=submit]').disabled = false;
  $('error').hidden = true;
  $('result-caption').textContent = '입력 후 확인을 눌러주세요';
  $('result-body').className = 'result-empty';
  $('result-body').textContent = mode === 'profit' ? '예상 손익과 수익률이 여기에 표시됩니다.' : '추가 매수 후 평균 단가가 여기에 표시됩니다.';
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
    $(prefix + '-label').textContent = prefix === 'holding' ? (amount ? '투자금액 (수수료 제외)' : '보유 수량') : (amount ? '추가 매수금액 (수수료 제외)' : '추가 수량');
    $(prefix + '-suffix').textContent = amount ? '원' : '개';
    field(prefix + '_value').placeholder = amount ? '예: 100000' : '예: 0.5';
  }
}
/** 현재 탭의 입력을 복사한다. */
function capture() { drafts[mode] = Object.fromEntries(names.map(name => [name, field(name).value])); }
/** 만료 타이머는 입력할 때에도 최초 저장 시각을 유지한다. */
function persist() {
  capture();
  try {
    if (!session.save({mode, drafts})) { reset(true); return; }
    clearTimeout(timer); timer = setTimeout(() => reset(true), session.remaining());
  } catch { $('session-note').textContent = '브라우저 저장소를 사용할 수 없어 새로고침하면 입력값이 사라집니다.'; }
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
  $('form-title').textContent = tabs.find(tab => tab.dataset.mode === mode).textContent;
  $('explanation').textContent = descriptions[mode];
  updateFields(); invalidate();
  if (save) persist();
}
/** 저장값과 화면의 입력/결과를 함께 삭제한다. */
function reset(expired = false) {
  clearTimeout(timer); session.clear(); drafts = {}; selectMode('profit', false);
  $('session-note').textContent = expired ? '1시간이 지나 모든 입력값과 계산 결과를 삭제했습니다.' : '입력값은 이 탭의 브라우저 세션에 보관되며, 최초 저장 후 1시간이 지나면 삭제됩니다.';
}
/** 백그라운드에서 타이머가 지연된 경우에도 복귀 시 만료를 확인한다. */
function checkExpiry() { if (session.expired()) { reset(true); return true; } return false; }
/** API 결과는 HTML 해석 없이 텍스트로 표시한다. */
function renderResult(result) {
  const entries = mode === 'profit' ? [
    ['총 손익', result.profit, '원'], ['수익률', result.return_percent, '%'],
    ['총 투자금액', result.investment, '원'], ['매도금액', result.proceeds, '원'], ['총 거래 수수료', result.fees, '원']
  ] : [
    ['추가 매수 후 평균 단가', result.average_price, '원'], ['기존 대비 단가 변동률', result.price_change_percent, '%'],
    ['총 매수금액', result.total_amount, '원'], ['총 보유 수량', result.total_quantity, '개']
  ];
  const body = $('result-body'); body.replaceChildren(); body.className = 'result-grid';
  entries.forEach(([label, value, unit], index) => {
    const metric = document.createElement('dl'); metric.className = 'metric' + (index < 2 ? ' featured' : '');
    const title = document.createElement('dt'); title.textContent = label;
    const amount = document.createElement('dd');
    amount.textContent = new Intl.NumberFormat('ko-KR', {maximumSignificantDigits: 12}).format(value) + ' ' + unit;
    if (mode === 'profit' && index < 2) amount.className = value > 0 ? 'positive' : value < 0 ? 'negative' : '';
    metric.append(title, amount); body.append(metric);
  });
  $('result-caption').textContent = mode === 'profit' ? '수수료 반영 · 예상 결과' : '수수료 제외 · 수량 가중 평균';
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
  $('result-caption').textContent = '계산 중…';
  try {
    const response = await fetch('/api/calculate', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload), signal: controller.signal});
    const data = await response.json();
    if (checkExpiry() || current !== requestId) return;
    if (!response.ok) throw new Error(data.error || '계산을 처리할 수 없습니다.');
    renderResult(data.result);
  } catch (error) {
    if (current !== requestId || error.name === 'AbortError') return;
    $('error').textContent = error instanceof TypeError ? '서버에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.' : error.message;
    $('error').hidden = false; $('result-caption').textContent = '입력값을 확인해주세요';
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
document.addEventListener('visibilitychange', checkExpiry);
window.addEventListener('pageshow', checkExpiry);
window.addEventListener('focus', checkExpiry);
const saved = session.load();
if (saved && modes.includes(saved.mode) && saved.drafts && typeof saved.drafts === 'object') {
  drafts = saved.drafts; selectMode(saved.mode, false);
  timer = setTimeout(() => reset(true), session.remaining());
} else { session.clear(); selectMode('profit', false); }
<script nonce="{{ g.csp_nonce }}" src="{{ url_for('static', filename='app.js') }}"></script>