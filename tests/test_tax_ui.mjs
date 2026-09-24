/** 서버 필드 정의를 사용한 DOM 대역으로 조건부 전송·복원·비동기 취소를 검증한다. */
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createTaxUI} from '../src/coin/static/tax.js';
const schema = spawnSync('python',['-c','import json; from coin.tax_ui import tax_context; print(json.dumps(tax_context()))'],{env:{...process.env,PYTHONPATH:'src'},encoding:'utf8'});
assert.equal(schema.status,0,schema.stderr);
const config=JSON.parse(schema.stdout);

/** 필요한 표준 DOM 연산과 disabled 상속만 구현하는 테스트 노드다. */
class Element {
  constructor(tag='div',name='') { this.tag=tag; this.name=name; this.children=[]; this.dataset={}; this.handlers={}; this.type=''; this.value=''; this.checked=false; this.disabled=false; this.hidden=false; this.className=''; this.textContent=''; }
  append(...nodes) { for(const node of nodes) {node.parent=this;this.children.push(node);} }
  replaceChildren(...nodes) { this.children=[];this.append(...nodes); }
  remove() { this.parent.children=this.parent.children.filter(node=>node!==this); }
  get firstElementChild() {return this.children[0];}
  closest(selector) {for(let node=this;node;node=node.parent) if(node.matches(selector)) return node;return null;}
  matches(selector) {
    if(selector===':disabled') {for(let node=this;node;node=node.parent) if(node.disabled) return true;return false;}
    if(selector.startsWith('.')) return this.className.split(' ').includes(selector.slice(1));
    if(selector==='[data-tax-when]') return !!this.dataset.taxWhen;
    const attr=selector.match(/^\[(name|type)=([^\]]+)\]$/);
    if(attr) return this[attr[1]]===attr[2];
    return this.tag===selector;
  }
  querySelectorAll(selectors) {const list=[]; for(const child of this.children) {if(selectors.split(',').some(s=>child.matches(s))) list.push(child);list.push(...child.querySelectorAll(selectors));}return list;}
  querySelector(selector) {return this.querySelectorAll(selector)[0] || null;}
  addEventListener(name,handler) {this.handlers[name]=handler;}
  cloneNode() {const copy=new Element(this.tag,this.name); for(const key of ['dataset','type','value','checked','disabled','className']) copy[key]=typeof this[key]==='object'?{...this[key]}:this[key];this.children.forEach(child=>copy.append(child.cloneNode()));return copy;}
  reset() {this.querySelectorAll('input,select').forEach(el=>{el.value='';el.checked=false;});}
  reportValidity() {return true;}
}
/** 서버와 같은 필드 정의로 폼 구조를 생성한다. */
function fields(parent,definitions) {
  for(const f of definitions) {const label=new Element('label');label.dataset.taxWhen=JSON.stringify(f.when);const input=new Element(f.kind==='select'?'select':'input',f.name);input.type=f.kind; if(f.kind==='select') input.append(new Element('option')); for(const [value,text] of f.options) {const option=new Element('option');option.value=value;option.textContent=text;input.append(option);} label.append(input);parent.append(label);}
}
const elements=new Map();
const get=id=>{if(!elements.has(id)) elements.set(id,new Element());return elements.get(id);};
const form=get('tax-form');
fields(form,config.tax_basic);
form.append(get('tax-trades'),get('tax-disposal'),get('tax-conditions'));
const lots=get('tax-lots');get('tax-trades').append(lots);fields(get('tax-disposal'),config.tax_sale);fields(get('tax-conditions'),config.tax_conditions);
const row=new Element('fieldset');row.className='tax-lot';fields(row,config.tax_lots);const remove=new Element('button');remove.className='tax-remove';row.append(remove);
get('tax-lot-template').content=new Element();get('tax-lot-template').content.append(row);
const submit=new Element('button');submit.type='submit';form.append(submit);
get('tax-metadata').dataset.rules=JSON.stringify(config.tax_metadata);
globalThis.document={getElementById:get,createElement:tag=>new Element(tag)};
let saved=0,expired=false,reset=0;
const ui=createTaxUI({current:()=>({language:'ko',t:key=>key}),changed:()=>saved++,checkExpiry:()=>expired,resetAll:()=>reset++});
const field=name=>form.querySelectorAll('input,select').find(el=>el.name===name&&!el.closest('.tax-lot'));
assert.equal(field('country').value,'','URL이나 기본 통화로 거주 국가를 추정하지 않는다');
assert.equal(get('tax-rule-note').dataset.changed,undefined,'초기 표시에서는 강조하지 않는다');
// 국가·자산별 실제 선택지와 국가 변경 기본값을 확인한다.
const options=name=>field(name).querySelectorAll('option').map(option=>option.value);
for (const country of ['KR','US','JP','CN','DE','ES']) {
  field('country').value=country;ui.update();
  assert.equal(field('year').value,'2026');
  assert.equal(field('asset').value,'stock');
  assert.equal(field('market').value,'foreign');
  assert.deepEqual(options('year'),['2026']);
  assert.equal(field('year').closest('[data-tax-when]').hidden,true,'주식에서는 과세연도를 숨긴다');
  assert.equal(ui.capture(true).year,'2026','숨긴 기본 연도도 계산 요청에 포함한다');
  assert.deepEqual(options('market'),['domestic','foreign']);
  assert.equal(field('market').closest('[data-tax-when]').hidden,false);
  assert.deepEqual(options('asset'),country==='CN'?['stock']:['stock','crypto']);
  assert.deepEqual(options('event'),['sale']);
  if(country!=='CN') {
    field('asset').value='crypto';ui.update();
    assert.deepEqual(options('year'),country==='KR'?['2026','2027']:['2026']);
    assert.equal(field('year').closest('[data-tax-when]').hidden,country!=='KR','한국 암호자산에서만 과세연도를 표시한다');
    assert.equal(ui.capture(true).year,'2026');
    assert.deepEqual(options('event'),['','sale','swap','payment']);
    assert.equal(field('market').closest('[data-tax-when]').hidden,true);
    assert.equal(ui.capture(true).market,'foreign');
  }
  field('market').value='domestic';ui.update();
}
field('country').value='KR';ui.update();
field('asset').value='crypto';ui.update();
field('year').value='2027';ui.update();
assert.equal(get('tax-rule-note').textContent,'taxScheduled');
assert.equal(ui.capture(true).year,'2027','표시된 과세연도 선택을 요청에 반영한다');
const scheduledHighlight=get('tax-rule-note').dataset.changed;
assert.ok(['odd','even'].includes(scheduledHighlight));
ui.update();
assert.equal(get('tax-rule-note').dataset.changed,scheduledHighlight,'같은 문구는 강조 효과를 재시작하지 않는다');
field('special').checked=true;ui.update();
assert.equal(get('tax-trades').disabled,true);
assert.equal(get('tax-disposal').disabled,true);
assert.equal(ui.capture(true).sell_amount,undefined);
field('special').checked=false;ui.update();
field('country').value='US';ui.update();
assert.equal(field('year').value,'2026');
assert.equal(field('asset').value,'stock');
assert.equal(field('market').value,'foreign');
assert.equal(field('event').value,'sale');
assert.notEqual(get('tax-rule-note').dataset.changed,scheduledHighlight,'다음 문구 변경도 강조한다');
assert.equal(field('other_gains').disabled,true);
assert.equal(field('other_short').disabled,false);
assert.equal(field('event').disabled,true);
field('basis_confirmed').checked=true;
field('country').value='DE';ui.update();
assert.equal(field('basis_confirmed').checked,false);
assert.equal(field('church_rate').disabled,false);
const draft={country:'ES',year:'2026',asset:'crypto',market:'foreign',event:'swap',sell_amount:'200',sell_currency:'EUR',basis_confirmed:true,lots:[{quantity:'10',amount:'100',currency:'USD',fx:'0.9',buy_date:'2025-01-01'},{quantity:'3',amount:'40',currency:'EUR',buy_date:'2026-01-01'}]};
ui.restore(draft);
assert.equal(lots.children.length,2);
assert.equal(ui.capture().lots[0].fx,'0.9');
assert.equal(field('swap_given_value').disabled,false);
assert.equal(lots.children[1].querySelector('[name=fx]').disabled,true);
get('tax-add-lot').handlers.click();
assert.equal(lots.children.length,3);
assert.equal(lots.children[2].querySelector('[name=currency]').value,'EUR');
assert.equal(lots.children[2].querySelector('[name=fees_included]').checked,true);
lots.children[2].querySelector('.tax-remove').handlers.click();
assert.equal(lots.children.length,2);
assert.ok(saved>0);
// 수수료 읽기 전용 전환은 로트별로 독립적이며 해제해도 원래 값이 남는다.
const firstFee=lots.children[0].querySelector('[name=fee]');
const firstIncluded=lots.children[0].querySelector('[name=fees_included]');
firstFee.value='12';firstIncluded.checked=true;
field('sell_fee').value='9';field('sell_fees_included').checked=true;ui.update();
assert.equal(firstFee.type,'text');assert.equal(firstFee.readOnly,true);
assert.equal(field('sell_fee').type,'number');assert.equal(field('sell_fee').readOnly,false);
assert.equal(field('sell_fee').required,true);
assert.equal(lots.children[1].querySelector('[name=fee]').readOnly,true);
const feeDraft=ui.capture();ui.restore(feeDraft);
assert.equal(lots.children[0].querySelector('[name=fee]').readOnly,true);
assert.equal(field('sell_fee').readOnly,false);
assert.equal(ui.capture().sell_fee,'9');
field('event').value='sale';ui.update();
assert.equal(field('sell_fee').readOnly,true);
assert.equal(field('sell_fee').required,false);
field('event').value='swap';ui.update();
lots.children[0].querySelector('[name=fees_included]').checked=false;
field('sell_fees_included').checked=false;ui.update();
assert.equal(lots.children[0].querySelector('[name=fee]').value,'12');
assert.equal(lots.children[0].querySelector('[name=fee]').type,'number');
assert.equal(field('sell_fee').value,'9');assert.equal(field('sell_fee').readOnly,false);
ui.restore({country:'US',year:'2027',asset:'crypto',market:'domestic',event:'swap'});
assert.equal(field('year').value,'2026','미지원 연도의 저장 초안을 보정한다');
ui.restore({country:'KR',year:'2027',asset:'crypto',market:'domestic',event:'payment'});
assert.equal(field('year').value,'2027','유효한 초안은 국가 기본값으로 덮어쓰지 않는다');
field('asset').value='stock';ui.update();
assert.equal(field('year').value,'2026');assert.deepEqual(options('year'),['2026']);
assert.equal(field('event').value,'sale');
assert.equal(field('year').closest('[data-tax-when]').hidden,true);
assert.equal(ui.capture(true).year,'2026','암호자산에서 주식으로 바꾸면 숨긴 연도를 2026으로 보정한다');
ui.restore(draft);

// 삭제된 이전 선택의 저장값을 매도로 자동 변환하지 않는다.
ui.restore({country:'US',asset:'crypto',event:'transfer',market:'domestic',year:'2026'});
assert.equal(field('event').value,'');
assert.ok(!options('event').includes('transfer'));
assert.equal(ui.capture(true).market,'foreign');
ui.update();assert.equal(field('event').value,'');
ui.restore(draft);
// 국내주식의 자동 통화는 모든 국가·취득 행에 적용하고 해외 초안은 보존한다.
for (const [country,currency] of Object.entries({KR:'KRW',US:'USD',JP:'JPY',CN:'CNY',DE:'EUR',ES:'EUR'})) {
  ui.restore({...draft,country,asset:'stock',market:'domestic',event:'sale'});
  for (const lot of lots.children) {
    assert.equal(lot.querySelector('[name=currency]').closest('[data-tax-when]').hidden,true);
    assert.equal(lot.querySelector('[name=fx]').disabled,true);
  }
  assert.equal(field('sell_currency').closest('[data-tax-when]').hidden,true);
  assert.equal(field('sell_fx').disabled,true);
  assert.equal(ui.capture(true).sell_currency,currency);
  assert.ok(ui.capture(true).lots.every(lot=>lot.currency===currency && lot.fx===undefined));
  const savedDomestic=ui.capture();ui.restore(savedDomestic);
  assert.equal(ui.capture(true).sell_currency,currency);
  field('special').checked=true;ui.update();
  assert.equal(ui.capture(true).sell_currency,undefined);
  assert.ok(ui.capture(true).lots.every(lot=>lot.currency===undefined));
  field('special').checked=false;field('market').value='foreign';ui.update();
  assert.equal(ui.capture(true).lots[0].currency,'USD');
  assert.equal(ui.capture().lots[0].fx,'0.9');
  assert.equal(field('sell_currency').disabled,false);
}
// 사용하지 않는 연간 손익·경과가액은 제외하고 조건을 되돌리면 값을 복원한다.
ui.restore({...draft,country:'CN',asset:'stock',market:'foreign',other_gains:'25'});
assert.equal(field('other_gains').disabled,true);
assert.equal(ui.capture(true).other_gains,undefined);
ui.restore({...draft,country:'JP',asset:'stock',market:'domestic',nisa:true,other_gains:'25'});
assert.equal(field('other_gains').disabled,true);
field('nisa').checked=false;ui.update();
assert.equal(ui.capture(true).other_gains,'25');
ui.restore({...draft,country:'KR',year:'2027',asset:'crypto'});
const acquired=lots.children[0].querySelector('[name=buy_date]');
const transition=lots.children[0].querySelector('[name=transition_value]');
assert.equal(transition.required,true);
for(const date of ['', '2027-01-01']) {
  acquired.value=date;ui.update();assert.equal(transition.disabled,true);assert.equal(transition.required,false);
}
acquired.value='2026-12-31';ui.update();assert.equal(transition.required,true);
ui.restore(draft);
// 과세 유예·NISA는 빈 입력으로 안내하고 Enter로도 계산을 요청하지 않는다.
let exemptionRequests=0;
globalThis.fetch=async()=>{exemptionRequests++;throw new Error('unexpected request');};
ui.restore({country:'KR',asset:'crypto',year:'2026'});
assert.equal(get('tax-rule-note').textContent,'taxKoreaDeferred');
for(const id of ['tax-trades','tax-disposal','tax-conditions']) assert.equal(get(id).disabled,true);
assert.equal(submit.hidden,true);
assert.equal(get('tax-input-help').hidden,true);
assert.equal(field('event').disabled,true);
await form.handlers.submit({preventDefault(){}});
assert.equal(exemptionRequests,0);
field('year').value='2027';ui.update();
assert.equal(submit.hidden,false);
assert.equal(get('tax-trades').disabled,false);
assert.equal(field('event').disabled,false);
for(const market of ['domestic','foreign']) {
  ui.restore({...draft,country:'JP',asset:'stock',market,nisa:true});
  assert.equal(get('tax-rule-note').textContent,'taxNisa');
  assert.equal(submit.hidden,true);
  assert.equal(field('nisa').disabled,false);
  assert.equal(field('nisa').closest('[data-tax-when]').hidden,false);
  assert.equal(field('basis_confirmed').disabled,true);
  assert.equal(get('tax-trades').disabled,true);
  assert.equal(ui.capture(true).sell_amount,undefined);
  await form.handlers.submit({preventDefault(){}});
  assert.equal(exemptionRequests,0);
  field('nisa').checked=false;ui.update();
  assert.equal(submit.hidden,false);
  assert.equal(get('tax-trades').disabled,false);
  assert.equal(ui.capture().lots[0].amount,'100');
}
// 기본 조합으로 비과세를 단정하지 않는 나머지 국가·자산은 계산을 유지한다.
for(const country of ['KR','US','JP','CN','DE','ES']) {
  for(const asset of country==='CN'?['stock']:['stock','crypto']) {
    for(const market of ['domestic','foreign']) {
      ui.restore({country,asset,market,year:'2026'});
      assert.equal(submit.hidden,country==='KR'&&asset==='crypto');
    }
  }
}
ui.restore(draft);
let resolveRequest;
globalThis.fetch=()=>new Promise(resolve=>{resolveRequest=resolve;});
const pending=form.handlers.submit({preventDefault(){}});
assert.equal(submit.disabled,true);
form.handlers.input();
resolveRequest({ok:true,json:async()=>({result:{country:'ES',year:2026,total:'42',status:'estimate'}})});
await pending;
assert.equal(get('tax-results').hidden,true,'수정 전 도착한 세액은 표시하지 않는다');
globalThis.fetch=async()=>({ok:true,json:async()=>({result:{country:'ES',year:2026,currency:'EUR',status:'estimate',total:'42',warnings:['taxDisclaimer'],steps:['100 × 0.19 = 19'],sources:['https://sede.agenciatributaria.gob.es/'],verified:'2026-09-20'}})});
await form.handlers.submit({preventDefault(){}});
assert.equal(get('tax-results').hidden,false);
ui.invalidate();expired=true;
await form.handlers.submit({preventDefault(){}});
assert.equal(get('tax-results').hidden,true);
get('tax-reset').handlers.click();assert.equal(reset,1);
// 새 입력·초기화는 기본 체크, 명시적으로 해제한 초안은 해제 상태를 유지한다.
ui.restore({...draft,sell_fees_included:false,lots:[{...draft.lots[0],fees_included:false}]});
assert.equal(field('sell_fees_included').checked,false);
assert.equal(lots.children[0].querySelector('[name=fees_included]').checked,false);
assert.equal(field('sell_fee').readOnly,false);
ui.restore();assert.equal(lots.children.length,1);assert.equal(field('country').value,'');
assert.equal(field('sell_fees_included').checked,true);
assert.equal(lots.children[0].querySelector('[name=fees_included]').checked,true);
assert.equal(field('sell_fee').readOnly,true);
assert.equal(lots.children[0].querySelector('[name=fee]').readOnly,true);
assert.equal(get('tax-rule-note').dataset.changed,undefined,'초기화하면 변경 강조도 지운다');
delete globalThis.document;delete globalThis.fetch;
console.log('세금 조건부 입력·로트·초안 복원·요청 취소·만료·결과 렌더링 검증 통과');
