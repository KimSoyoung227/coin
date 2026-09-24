/** 세금 입력 조건·취득 로트·계산 근거 표시를 연결하며 금액 계산은 Python에 맡긴다. */
import {localeFor} from './formatting.js';

/** 공유 세션의 저장·만료 콜백을 받아 독립 세금 화면을 초기화한다. */
export function createTaxUI({current, changed, checkExpiry, resetAll}) {
  const form = document.getElementById('tax-form');
  const lots = document.getElementById('tax-lots');
  const template = document.getElementById('tax-lot-template');
  const result = document.getElementById('tax-results');
  const error = document.getElementById('tax-error');
  const metadata = JSON.parse(document.getElementById('tax-metadata').dataset.rules);
  const submit = form.querySelector('[type=submit]');
  let requestId = 0;
  let controller;
  let priorContext = '';
  let priorNote = null;
  let noteChanges = 0;
  let priorCountry = null;
  /** 이름 중복이 있는 로트 입력과 일반 입력을 구분한다. */
  const mainFields = () => [...form.querySelectorAll('input,select')].filter(el => !el.closest('.tax-lot'));
  const field = name => mainFields().find(el => el.name === name);
  const value = name => field(name)?.value || '';
  const text = key => current().t(key);
  const defaults = {year:'2026',asset:'stock',market:'foreign',event:'sale'};
  const optionCatalog = Object.fromEntries(Object.keys(defaults).map(name => [name, [...field(name).querySelectorAll('option')].map(option => option.cloneNode(true))]));
  /** 등록된 계산 규칙에 맞는 선택지만 남기고 지원하지 않는 기존 값을 보정한다. */
  function setOptions(name, allowed) {
    const select = field(name);
    const before = select.value;
    const options = optionCatalog[name].filter(option => allowed.includes(option.value));
    const nextValues = options.map(option => option.value);
    if ([...select.querySelectorAll('option')].map(option => option.value).join('|') !== nextValues.join('|')) {
      select.replaceChildren(...options.map(option => option.cloneNode(true)));
    }
    select.value = nextValues.includes(before) ? before : nextValues.includes(defaults[name]) ? defaults[name] : nextValues[0] || '';
  }
  /** 국가 변경은 기본 조건으로 시작하고 자산별 연도·거래·처분 지원 범위를 적용한다. */
  function updateOptions() {
    const country = value('country');
    const reset = priorCountry !== null && priorCountry !== country;
    priorCountry = country;
    if (reset) {
      for (const name of Object.keys(defaults)) {
        field(name).replaceChildren(...optionCatalog[name].map(option => option.cloneNode(true)));
        field(name).value = defaults[name];
      }
    }
    const rules = metadata.rules.filter(rule => (!country || rule.country === country) && ['active','scheduled','suspended'].includes(rule.status));
    setOptions('asset', [...new Set(rules.map(rule => rule.assetType))]);
    const assets = rules.filter(rule => rule.assetType === value('asset'));
    setOptions('year', [...new Set(assets.map(rule => String(rule.taxYear)))]);
    const years = assets.filter(rule => String(rule.taxYear) === value('year'));
    setOptions('market', [...new Set(years.map(rule => rule.domesticForeignType))]);
    // 암호자산의 국내·해외 규칙은 동일하므로 내부 조회값만 기본값으로 고정한다.
    if (value('asset') === 'crypto') field('market').value = defaults.market;
    const events = years.filter(rule => rule.domesticForeignType === value('market')).flatMap(rule => rule.taxableEvents);
    setOptions('event', [...new Set([...(value('asset') === 'crypto' ? [''] : []), ...events])]);
  }
  /** 총액에 반영된 수수료는 값을 보존한 읽기 전용 텍스트로 전환한다. */
  function updateFee(input, included) {
    input.type = included ? 'text' : 'number';
    input.readOnly = included;
  }

  /** 현재 조건에 일치하는 검증된 연도별 규칙을 찾는다. */
  function selectedRule() {
    return metadata.rules.find(r => r.country === value('country') && String(r.taxYear) === value('year') && r.assetType === value('asset') && r.domesticForeignType === value('market'));
  }
  /** 국내 상장주식은 선택 국가의 기준 통화로 입력·전송한다. */
  function domesticCurrency() {
    return value('asset') === 'stock' && value('market') === 'domestic' ? selectedRule()?.currency : null;
  }
  /** 금액 입력 없이 판정 가능한 과세 유예·적격 계좌 비과세만 안내한다. */
  function exemptionNote() {
    if (field('special').checked) return null;
    if (value('country') === 'KR' && value('asset') === 'crypto' && selectedRule()?.status === 'suspended') return 'taxKoreaDeferred';
    if (value('country') === 'JP' && value('asset') === 'stock' && field('nisa').checked) return 'taxNisa';
    return null;
  }
  /** 변경 전 응답을 중단하고 오래된 세액을 즉시 제거한다. */
  function invalidate() {
    requestId++;
    controller?.abort();
    result.replaceChildren();
    result.hidden = true;
    error.hidden = true;
    submit.disabled = false;
  }
  /** 새 로트는 수수료 포함을 기본 체크하고 저장된 선택은 그대로 복원한다. */
  function addLot(saved) {
    if (lots.children.length >= 50) return;
    const row = template.content.firstElementChild.cloneNode(true);
    for (const input of row.querySelectorAll('input,select')) {
      if (saved && Object.hasOwn(saved, input.name)) {
        if (input.type === 'checkbox') input.checked = saved[input.name] === true;
        else if (typeof saved[input.name] === 'string') input.value = saved[input.name];
      } else if (input.name === 'fees_included') input.checked = true;
      else if (input.name === 'currency') input.value = selectedRule()?.currency || '';
    }
    row.querySelector('.tax-remove').addEventListener('click', () => {
      if (checkExpiry() || lots.children.length <= 1) return;
      row.remove(); update(); invalidate(); changed();
    });
    lots.append(row);
    lots.querySelectorAll('.tax-remove').forEach(button => { button.disabled = lots.children.length === 1; });
  }
  /** 실제 안내 변경만 강조하고 동일 문구의 반복 읽기·효과 재생을 방지한다. */
  function updateRuleNote(message) {
    if (message === priorNote) return;
    const note = document.getElementById('tax-rule-note');
    note.textContent = message;
    if (priorNote !== null) {
      noteChanges++;
      note.dataset.changed = noteChanges % 2 ? 'odd' : 'even';
    }
    priorNote = message;
  }
  /** 표시 조건을 만족하지 않는 필드는 전송·검증에서 제외한다. */
  function update() {
    updateOptions();
    const rule = selectedRule();
    const currency = rule?.currency || '';
    const domestic = !!domesticCurrency();
    document.getElementById('tax-unit').textContent = currency;
    const blocked = value('country') === 'CN' && value('asset') === 'crypto';
    const special = field('special').checked;
    const exemption = exemptionNote();
    for (const id of ['tax-trades','tax-disposal','tax-conditions']) {
      const section = document.getElementById(id);
      section.hidden = blocked || special || !!exemption && (id !== 'tax-conditions' || exemption !== 'taxNisa');
      section.disabled = section.hidden;
    }
    submit.hidden = blocked || special || !!exemption;
    document.getElementById('tax-input-help').hidden = blocked || special || !!exemption;
    form.querySelectorAll('[data-tax-when]').forEach(label => {
      const when = JSON.parse(label.dataset.taxWhen);
      let visible = Object.entries(when).every(([key, options]) => options.includes(value(key)));
      const input = label.querySelector('input,select');
      // NISA 확인은 해제할 수 있도록 남기고 비과세 거래의 나머지 조건은 숨긴다.
      if (exemption === 'taxNisa' && [...document.getElementById('tax-conditions').querySelectorAll('[data-tax-when]')].includes(label)) visible = visible && input.name === 'nisa';
      if (input.name === 'event' && exemption) visible = false;
      // 국내주식은 통화를 자동 적용하며 외화 초안은 해외 거래로 돌아갈 때 보존한다.
      if (['currency','sell_currency'].includes(input.name)) visible = visible && !domestic;
      // 거래 통화가 자국통화이면 환율 입력을 숨겨 오입력을 줄인다.
      if (input.name === 'fx') visible = visible && !domestic && label.closest('.tax-lot').querySelector('[name=currency]').value !== currency;
      if (input.name === 'sell_fx') visible = visible && !domestic && value('sell_currency') !== currency;
      if (input.name === 'other_income') visible = visible && (value('country') === 'US' || value('asset') === 'crypto');
      if (input.name === 'deduction_remaining') visible = visible && (value('country') === 'DE' && value('asset') === 'stock' || value('country') === 'KR' && !(value('asset') === 'crypto' && value('year') === '2026') && value('market') === 'foreign');
      // 이번 거래만 사용하는 계산 분기에는 기타 연간 손익 입력을 노출하지 않는다.
      if (['other_gains','other_losses'].includes(input.name)) {
        visible = visible && !(value('country') === 'CN' && value('market') === 'foreign') && !(value('country') === 'JP' && value('asset') === 'stock' && field('nisa').checked);
      }
      // 경과규정 가액은 시행 전 취득분에만 필수이며 숨긴 환율은 검증에서 제외한다.
      if (input.name === 'transition_value') {
        const acquired = label.closest('.tax-lot').querySelector('[name=buy_date]').value;
        visible = visible && !!acquired && acquired < '2027-01-01';
        input.required = visible;
      }
      label.hidden = !visible;
      // 숨긴 연도와 거래구분도 규칙 조회에 필요한 내부 기본값으로 API에 전달한다.
      input.disabled = !visible && !['year','market'].includes(input.name);
    });
    for (const row of lots.children) {
      updateFee(row.querySelector('[name=fee]'), row.querySelector('[name=fees_included]').checked);
    }
    // 스페인 교환은 포함된 수수료도 알아야 차감 전 시가를 복원할 수 있다.
    const swapFee = value('country') === 'ES' && value('asset') === 'crypto' && value('event') === 'swap';
    updateFee(field('sell_fee'), field('sell_fees_included').checked && !swapFee);
    field('sell_fee').required = swapFee && !blocked && !special && !exemption;
    // 국가·연도·자산이 달라지면 기존 확인을 해제해 다른 세법 가정을 재사용하지 않는다.
    const nextContext = [value('country'),value('year'),value('asset')].join(':');
    if (priorContext && priorContext !== nextContext) {
      field('basis_confirmed').checked = false;
      field('annual_complete').checked = false;
    }
    priorContext = nextContext;
    const note = blocked ? 'taxChinaCrypto' : special ? 'taxSpecial' : exemption || (rule?.status === 'scheduled' ? 'taxScheduled' : !rule && value('country') ? 'taxUnsupportedYear' : 'taxScopeNote');
    updateRuleNote(text(note));
    document.getElementById('tax-verified').textContent = rule ? `${text('taxVerified')}: ${rule.lastVerifiedAt} · ${text('taxYear')}: ${rule.taxYear}` : '';
    document.getElementById('tax-add-lot').disabled = lots.children.length >= 50;
    lots.querySelectorAll('.tax-remove').forEach(button => { button.disabled = lots.children.length === 1; });
  }
  /** 세션에는 알려진 필드만 저장하고 비활성 필드는 API 요청에서 제외한다. */
  function readFields(inputs, activeOnly) {
    return Object.fromEntries([...inputs].filter(el => !activeOnly || !el.matches(':disabled')).map(el => [el.name, el.type === 'checkbox' ? el.checked : el.value]));
  }
  /** 초안 원본은 보존하고 활성 계산 요청에만 국내주식의 자동 통화를 채운다. */
  function capture(activeOnly = false) {
    const data = {...readFields(mainFields(), activeOnly), lots: [...lots.children].map(row => readFields(row.querySelectorAll('input,select'), activeOnly))};
    const currency = domesticCurrency();
    if (activeOnly && currency && !document.getElementById('tax-trades').disabled) {
      data.sell_currency = currency;
      data.lots.forEach(lot => { lot.currency = currency; });
    }
    return data;
  }
  /** 새 처분의 수수료 포함은 기본 체크하며 다른 언어에서도 저장된 선택을 복원한다. */
  function restore(saved) {
    invalidate();
    form.reset();
    field('sell_fees_included').checked = true;
    priorContext = '';
    priorCountry = null;
    for (const name of Object.keys(defaults)) field(name).replaceChildren(...optionCatalog[name].map(option => option.cloneNode(true)));
    priorNote = null;
    noteChanges = 0;
    delete document.getElementById('tax-rule-note').dataset.changed;
    lots.replaceChildren();
    for (const input of mainFields()) {
      if (saved && Object.hasOwn(saved, input.name)) {
        if (input.type === 'checkbox') input.checked = saved[input.name] === true;
        else if (typeof saved[input.name] === 'string') input.value = saved[input.name];
      }
    }
    if (!value('year')) field('year').value = '2026';
    if (!value('asset')) field('asset').value = 'stock';
    if (!value('market')) field('market').value = 'foreign';
    if (!value('event')) field('event').value = 'sale';
    // 삭제된 지갑 이전 초안은 매도로 오인하지 않도록 처분유형을 다시 선택하게 한다.
    if (saved?.event === 'transfer') field('event').value = '';
    if (Array.isArray(saved?.lots)) saved.lots.slice(0,50).forEach(lot => { if (lot && typeof lot === 'object') addLot(lot); });
    if (!lots.children.length) addLot();
    update();
  }
  /** API 문자열은 textContent로 표시하여 임의 HTML을 해석하지 않는다. */
  function node(tag, content, className) {
    const element = document.createElement(tag);
    element.textContent = content;
    if (className) element.className = className;
    return element;
  }
  /** 세액·조건·계산식·출처를 동일한 결과 영역에 표시한다. */
  function render(data) {
    result.replaceChildren();
    result.hidden = false;
    const fmt = amount => amount == null ? '—' : new Intl.NumberFormat(localeFor(current().language), {maximumFractionDigits:2}).format(Number(amount)) + ' ' + (data.currency || '');
    result.append(node('h3', `${text('taxResult')} · ${text('taxCountry'+data.country)} ${data.year}`));
    result.append(node('p', text('taxStatus_'+data.status), 'tax-status'));
    const grid = node('div','', 'result-grid');
    const entries = [['taxRealized',data.realized],['taxAnnualNet',data.annual],['taxLossOffset',data.loss_offset],['taxAllowance',data.deduction],['taxThreshold',data.threshold],['taxTaxable',data.taxable],...(data.lines || []).map(line => [line.label,line.amount]),['taxTotal',data.total],['taxAfter',data.after_tax],['taxLossDeduct',data.loss_deduction],['taxLossForward',data.loss_carryforward]];
    if (data.foreign_paid !== undefined) entries.push(['taxForeignTax',data.foreign_paid],['taxCreditAfter',data.total_after_credit]);
    entries.filter(([key,amount]) => amount !== undefined).forEach(([key,amount]) => {
      const item = node('dl','', 'metric'+(key === 'taxTotal' ? ' featured' : ''));
      item.append(node('dt',text(key)),node('dd',fmt(amount)));
      grid.append(item);
    });
    result.append(grid);
    if (data.range) result.append(node('p',`${text('taxRange')}: ${fmt(data.range[0])} – ${fmt(data.range[1])}`,'tax-status'));
    const warnings = node('ul','', 'tax-warnings');
    [...new Set(data.warnings || [])].forEach(key => warnings.append(node('li',text(key))));
    result.append(warnings);
    if (data.steps?.length) {
      const details = node('details','', 'tax-help');
      details.append(node('summary',text('taxFormula')));
      const list = node('ol','');
      data.steps.forEach(step => list.append(node('li',step)));
      details.append(list);
      result.append(details);
    }
    result.append(node('p',`${text('taxVerified')}: ${data.verified || '—'} · ${data.version || ''}`,'tax-muted'));
    const sources = node('ul','', 'tax-sources');
    (data.sources || []).forEach((url,index) => {
      const link = node('a',`${text('taxSources')} ${index+1}: ${new URL(url).hostname}`);
      link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer';
      const item = node('li',''); item.append(link); sources.append(item);
    });
    result.append(sources);
  }
  /** 검토가 필요한 거래는 세부 숫자 입력 없이 경고를 받을 수 있다. */
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (checkExpiry()) return;
    update(); invalidate();
    // 숨긴 버튼의 Enter 제출도 막아 불필요한 계산 요청을 보내지 않는다.
    if (submit.hidden || !form.reportValidity()) return;
    changed();
    const id = ++requestId;
    controller = new AbortController();
    submit.disabled = true;
    try {
      const response = await fetch('/api/tax/calculate', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(capture(true)), signal:controller.signal});
      const data = await response.json();
      if (checkExpiry() || id !== requestId) return;
      if (!response.ok) throw new Error(text(data.error || 'taxInvalid'));
      render(data.result);
    } catch (reason) {
      if (reason.name === 'AbortError' || id !== requestId) return;
      error.textContent = reason instanceof TypeError ? text('serverError') : reason.message;
      error.hidden = false;
    } finally {
      if (id === requestId) submit.disabled = false;
    }
  });
  /** 입력 변경·로트 추가·초기화를 공유 세션 수명주기에 연결한다. */
  function onChange() {
    if (checkExpiry()) return;
    update(); invalidate(); changed();
  }
  form.addEventListener('input',onChange);
  form.addEventListener('change',onChange);
  document.getElementById('tax-add-lot').addEventListener('click', () => { if (!checkExpiry()) { addLot(); onChange(); } });
  document.getElementById('tax-reset').addEventListener('click',resetAll);
  restore();
  return {capture,restore,invalidate,update};
}
