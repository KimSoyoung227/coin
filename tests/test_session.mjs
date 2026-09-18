/** 실제 저장 모듈에 가상 시계를 주입하여 1시간 경계와 복원을 검증한다. */
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const source = await readFile(new URL('../src/coin/static/session.js', import.meta.url), 'utf8');
const {createSession, TTL, KEY} = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
let time = 1000;
const records = new Map();
const storage = {getItem: key => records.get(key) ?? null, setItem: (key, value) => records.set(key, value), removeItem: key => records.delete(key)};
let session = createSession(storage, () => time);
assert.equal(session.load(), null);
session.save({mode: 'profit', currency: 'GBP', drafts: {profit: {buy_price: '100'}}});
time += TTL - 1;
session.save({mode: 'down', currency: 'GBP', drafts: {}});
assert.equal(session.remaining(), 1);
session = createSession(storage, () => time);
assert.equal(session.load().mode, 'down');
assert.equal(session.load().currency, 'GBP');
time++;
assert.equal(session.expired(), true);
assert.equal(session.load(), null);
assert.equal(records.has(KEY), false);
for (const value of ['broken json', '{}', JSON.stringify({startedAt: time + 1, data: {}})]) {
  storage.setItem(KEY, value);
  assert.equal(session.load(), null);
  assert.equal(records.has(KEY), false);
}
session.save({mode: 'up'});
session.clear();
assert.equal(records.size, 0);
assert.equal(session.expired(), false);
console.log('세션 복원, 고정 만료, 1시간 경계, 손상 데이터, 초기화 검증 통과');
