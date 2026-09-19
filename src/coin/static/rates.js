/** 환율·원자재·비트코인 시세를 표로 표시하고 1분마다 서버 캐시를 확인한다. */
import {localeFor} from './formatting.js';

let latest = null;
let loading = false;
/** ID에 해당하는 시세 화면 요소를 찾는다. */
const byId = id => document.getElementById(id);
const MARKET_ROWS = [
  ['currencies','KRW','rateKRW','currency'], ['currencies','USD','rateUSD','currency'],
  ['currencies','CNY','rateCNY','currency'], ['currencies','JPY','rateJPY','currency'],
  ['currencies','EUR','rateEUR','currency'], ['currencies','GBP','rateGBP','currency'],
  ['metals','XAU','rateGold','g'], ['metals','XAG','rateSilver','g'],
  ['metals','HG','rateCopper','g'], ['bitcoin','BTC','rateBitcoin','BTC']
];

/** 선택 기준 통화로 환산한 자산별 가격 행을 그린다. */
function renderPriceRows(language, t, base) {
  const body = byId('market-body');
  body.replaceChildren();
  const baseRate = latest.groups?.currencies?.items?.[base];
  const formatter = new Intl.NumberFormat(localeFor(language), {maximumFractionDigits: 4});
  for (const [group, code, name, kind] of MARKET_ROWS) {
    const original = latest.groups?.[group]?.items?.[code];
    const value = original / baseRate;
    const unit = kind === 'currency' ? base : `${base}/${kind}`;
    const tr = document.createElement('tr');
    const label = document.createElement('th');
    label.scope = 'row';
    label.textContent = `${t(name)} (${code}/${base})`;
    const price = document.createElement('td');
    price.textContent = Number.isFinite(value) ? `${formatter.format(value)} ${unit}` : '—';
    tr.append(label, price);
    body.append(tr);
  }
}

/** 시세 그룹별 조회 완료 시각과 캐시 사용 여부를 그린다. */
function renderCompletionTimes(language, t) {
  const times = byId('market-times');
  times.replaceChildren();
  const groups = [
    ['currencies', 'marketCurrencyTime'],
    ['metals', 'marketMetalTime'],
    ['bitcoin', 'marketBitcoinTime']
  ];
  const formatter = new Intl.DateTimeFormat(localeFor(language), {
    dateStyle: 'short', timeStyle: 'medium'
  });
  for (const [group, key] of groups) {
    const stamp = latest.groups?.[group]?.completed_at;
    if (!stamp) continue;
    const paragraph = document.createElement('p');
    const completedAt = formatter.format(new Date(stamp));
    const staleLabel = latest.groups[group].stale ? ` · ${t('marketStale')}` : '';
    paragraph.textContent = `${t(key)}: ${completedAt}${staleLabel}`;
    times.append(paragraph);
  }
}

/** 마지막 응답을 현재 언어와 기준 통화로 다시 그린다. */
export function renderMarketRates(language, t) {
  if (!latest) return;
  const base = byId('market-base-currency').value;
  renderPriceRows(language, t, base);
  renderCompletionTimes(language, t);
  const error = byId('market-error');
  error.hidden = !latest.errors?.length;
  error.textContent = latest.errors?.length ? t('marketPartialError') : '';
  byId('market-price-heading').textContent = `${t('marketPrice')} (${base})`;
}

/** 서버의 그룹별 캐시 스냅샷을 조회한다. */
export async function refreshMarketRates(language, t) {
  if (loading) return;
  loading = true;
  byId('market-refresh').disabled = true;
  try {
    const response = await fetch('/api/market-rates', {headers:{'Accept':'application/json'}});
    const data = await response.json();
    if (!response.ok && !Object.keys(data.groups || {}).length) throw new Error();
    latest = data;
    renderMarketRates(language, t);
  } catch {
    const error = byId('market-error');
    error.textContent = t('marketError');
    error.hidden = false;
  } finally {
    loading = false;
    byId('market-refresh').disabled = false;
  }
}

/** 최초 조회 후 BTC 캐시 주기에 맞춰 1분마다 새 스냅샷을 요청한다. */
export function startMarketRates(getLocale) {
  const load = () => {
    const {language, t} = getLocale();
    refreshMarketRates(language, t);
  };
  byId('market-base-currency').addEventListener('change', () => {
    const {language, t} = getLocale();
    renderMarketRates(language, t);
  });
  load();
  setInterval(load, 60_000);
}
