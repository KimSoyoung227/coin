/** 환율·원자재·비트코인 시세를 표로 표시하고 1분마다 서버 캐시를 확인한다. */
let latest = null;
let loading = false;
const $ = id => document.getElementById(id);
const locale = language => ({ko:'ko-KR','en-US':'en-US',es:'es-ES',zh:'zh-CN'}[language] || 'ko-KR');
const rows = [
  ['currencies','KRW','rateKRW','currency'], ['currencies','USD','rateUSD','currency'],
  ['currencies','CNY','rateCNY','currency'], ['currencies','JPY','rateJPY','currency'],
  ['currencies','EUR','rateEUR','currency'], ['currencies','GBP','rateGBP','currency'],
  ['metals','XAU','rateGold','g'], ['metals','XAG','rateSilver','g'],
  ['metals','HG','rateCopper','g'], ['bitcoin','BTC','rateBitcoin','BTC']
];

/** 마지막 응답을 현재 언어로 다시 그린다. */
export function renderMarketRates(language, t) {
  if (!latest) return;
  const body = $('market-body'); body.replaceChildren();
  const base = $('market-base-currency').value;
  const baseRate = latest.groups?.currencies?.items?.[base];
  const formatter = new Intl.NumberFormat(locale(language), {maximumFractionDigits: 4});
  for (const [group, code, name, kind] of rows) {
    const original = latest.groups?.[group]?.items?.[code];
    const value = original / baseRate;
    const unit = kind === 'currency' ? base : `${base}/${kind}`;
    const tr = document.createElement('tr');
    const label = document.createElement('th'); label.scope = 'row';
    label.textContent = `${t(name)} (${code}/${base})`;
    const price = document.createElement('td');
    price.textContent = Number.isFinite(value) ? `${formatter.format(value)} ${unit}` : '—';
    tr.append(label, price); body.append(tr);
  }
  const times = $('market-times'); times.replaceChildren();
  for (const [group, key] of [['currencies','marketCurrencyTime'],['metals','marketMetalTime'],['bitcoin','marketBitcoinTime']]) {
    const stamp = latest.groups?.[group]?.completed_at;
    if (!stamp) continue;
    const p = document.createElement('p');
    p.textContent = `${t(key)}: ${new Intl.DateTimeFormat(locale(language), {dateStyle:'short',timeStyle:'medium'}).format(new Date(stamp))}${latest.groups[group].stale ? ` · ${t('marketStale')}` : ''}`;
    times.append(p);
  }
  const error = $('market-error');
  error.hidden = !latest.errors?.length;
  error.textContent = latest.errors?.length ? t('marketPartialError') : '';
  $('market-price-heading').textContent = `${t('marketPrice')} (${base})`;
}

/** 서버의 그룹별 캐시 스냅샷을 조회한다. */
export async function refreshMarketRates(language, t) {
  if (loading) return;
  loading = true; $('market-refresh').disabled = true;
  try {
    const response = await fetch('/api/market-rates', {headers:{'Accept':'application/json'}});
    const data = await response.json();
    if (!response.ok && !Object.keys(data.groups || {}).length) throw new Error();
    latest = data; renderMarketRates(language, t);
  } catch {
    const error = $('market-error'); error.textContent = t('marketError'); error.hidden = false;
  } finally { loading = false; $('market-refresh').disabled = false; }
}

/** 최초 조회 후 BTC 캐시 주기에 맞춰 1분마다 새 스냅샷을 요청한다. */
export function startMarketRates(getLocale) {
  const load = () => { const {language, t} = getLocale(); refreshMarketRates(language, t); };
  $('market-base-currency').addEventListener('change', () => {
    const {language, t} = getLocale(); renderMarketRates(language, t);
  });
  load(); setInterval(load, 60_000);
}
