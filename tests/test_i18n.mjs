/** 번역 사전의 지원 언어와 키 구성이 동일한지 검증한다. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
globalThis.document = {getElementById: () => ({textContent: readFileSync(new URL('../src/coin/translations.json', import.meta.url), 'utf8')})};
const {messages, translator} = await import('../src/coin/static/i18n.js');
delete globalThis.document;

assert.deepEqual(Object.keys(messages).sort(), ['en-US', 'es', 'ja', 'ko', 'zh']);
const koreanKeys = Object.keys(messages.ko).sort();
for (const [language, dictionary] of Object.entries(messages)) {
  assert.deepEqual(Object.keys(dictionary).sort(), koreanKeys, `${language} 번역 키 불일치`);
  assert.ok(Object.values(dictionary).every(value => typeof value === 'string' && value.length));
}
assert.equal(translator('en-US').t('results'), 'Results');
assert.equal(translator('en').lang, 'en-US');
assert.equal(translator('ja').t('results'), '計算結果');
assert.equal(translator('unsupported').lang, 'ko');
console.log('5개 국가 로케일 번역 키 및 기본 언어 검증 통과');
