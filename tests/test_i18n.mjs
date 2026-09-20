/** 번역 사전의 지원 언어와 키 구성이 동일한지 검증한다. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {localeFor} from '../src/coin/static/formatting.js';
globalThis.document = {getElementById: () => ({dataset: {messages: readFileSync(new URL('../src/coin/translations.json', import.meta.url), 'utf8')}})};
const {messages, translator} = await import('../src/coin/static/i18n.js');
delete globalThis.document;

assert.deepEqual(Object.keys(messages).sort(), ['de', 'en-US', 'es', 'ja', 'ko', 'zh']);
const koreanKeys = Object.keys(messages.ko).sort();
for (const [language, dictionary] of Object.entries(messages)) {
  assert.deepEqual(Object.keys(dictionary).sort(), koreanKeys, `${language} 번역 키 불일치`);
  assert.ok(Object.values(dictionary).every(value => typeof value === 'string' && value.length));
}
assert.equal(translator('en-US').t('results'), 'Results');
assert.equal(translator('en').lang, 'en-US');
assert.equal(translator('ja').t('results'), '計算結果');
// 독일어 번역과 계산·시세에 사용하는 독일식 숫자 및 날짜 형식을 검증한다.
assert.equal(translator('de').t('results'), 'Ergebnisse');
assert.equal(localeFor('de'), 'de-DE');
assert.equal(new Intl.NumberFormat(localeFor('de')).format(1234.56), '1.234,56');
assert.equal(new Intl.DateTimeFormat(localeFor('de'), {timeZone: 'UTC'}).format(new Date('2026-09-20T12:00:00Z')), '20.9.2026');
assert.equal(translator('unsupported').lang, 'ko');
console.log('6개 국가 로케일 번역 키 및 기본 언어 검증 통과');
