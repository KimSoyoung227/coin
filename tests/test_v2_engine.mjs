/** V2 엔진의 정확한 소수 연산, 거래단위와 목표 경계값을 검증한다. */
import assert from 'node:assert/strict';
import {ASSETS, calculateAverage, calculateTarget, calculateScenarios} from '../src/coin/static/v2-engine.js';
const base = {asset: 'DOMESTIC_STOCK', buyPrice: '100', quantity: '10', additionalPrice: '50', additionalQuantity: '10'};
assert.equal(ASSETS.length, 6);
assert.deepEqual(calculateAverage(base), {averagePrice: '75', priceChange: '-25', changePercent: '-25', existingInvestment: '1000', additionalInvestment: '500', totalInvestment: '1500', totalQuantity: '20'});
assert.equal(calculateAverage({...base, additionalPrice: '150'}).averagePrice, '125');
assert.equal(calculateAverage({...base, additionalQuantity: '0'}).averagePrice, '100');
// 모든 자산의 단가는 정수이고 가상자산 수량에만 소수점을 허용한다.
for (const asset of ASSETS) {
  assert.equal(asset.pricePrecision, 0);
  for (const name of ['buyPrice', 'additionalPrice']) {
    assert.throws(() => calculateAverage({...base, asset: asset.id, [name]: '100.1'}), /정수/);
  }
  assert.throws(() => calculateTarget({...base, asset: asset.id, targetPrice: '74.5'}), /정수/);
  if (asset.id !== 'CRYPTO') assert.throws(() => calculateAverage({...base, asset: asset.id, quantity: '1.5'}), /정수/);
}
assert.equal(calculateAverage({...base, asset: 'CRYPTO', quantity: '0.00000001', additionalQuantity: '0.00000002'}).averagePrice, '66.666666666666666667');
assert.equal(calculateAverage({...base, buyPrice: '9007199254740993', additionalPrice: '9007199254740995'}).averagePrice, '9007199254740994');
assert.equal(calculateTarget({...base, targetPrice: '75'}).additionalQuantity, '10');
assert.equal(calculateTarget({...base, targetPrice: '74'}).additionalQuantity, '11');
assert.ok(Number(calculateTarget({...base, targetPrice: '74'}).averagePrice) < 74);
assert.equal(calculateTarget({...base, additionalPrice: '150', targetPrice: '126'}).additionalQuantity, '11');
assert.equal(calculateTarget({...base, targetPrice: '100'}).additionalQuantity, '0');
assert.equal(calculateTarget({...base, asset: 'CRYPTO', quantity: '0.00000001', targetPrice: '74'}).additionalQuantity, '0.00000002');
for (const targetPrice of ['50', '49', '101']) assert.throws(() => calculateTarget({...base, targetPrice}), /목표/);
for (const value of ['', '-1', 'NaN', 'Infinity', '1e10', '1,000', '0', '1000000000000000000000000', '0.0000000000000000001']) {
  assert.throws(() => calculateAverage({...base, buyPrice: value}));
}
assert.throws(() => calculateAverage({...base, asset: 'UNKNOWN'}));
assert.throws(() => calculateAverage({...base, quantity: '1.1'}));
assert.throws(() => calculateAverage({...base, asset: 'CRYPTO', quantity: '0.000000001'}));
assert.throws(() => calculateAverage({...base, buyPrice: 100}));
const scenarios = calculateScenarios({...base, quantities: ['0', '10', '20']});
assert.deepEqual(scenarios.map(row => row.averagePrice), ['100', '75', '66.666666666666666667']);
assert.throws(() => calculateScenarios({...base, quantities: []}));
assert.throws(() => calculateScenarios({...base, quantities: Array(21).fill('1')}));
const budget = calculateScenarios({...base, amounts: ['125']})[0];
assert.equal(budget.additionalQuantity, '2');
assert.equal(budget.additionalInvestment, '100');
assert.equal(budget.requestedInvestment, '125');
assert.equal(budget.unspentInvestment, '25');
// 정수 단가라도 가상자산 수량과 가중평균은 중간 정밀도를 유지한다.
const tiny = calculateAverage({...base, asset: 'CRYPTO', buyPrice: '2', additionalPrice: '1', quantity: '0.00000001', additionalQuantity: '0.00000001'});
assert.equal(tiny.averagePrice, '1.5');
assert.equal(tiny.priceChange, '-0.5');
assert.equal(tiny.totalInvestment, '0.00000003');
assert.equal(tiny.changePercent, '-25');
// 정수 거래단위를 살 수 없는 예산은 전액 잔액으로, 코인 예산은 소수 거래단위로 남긴다.
assert.equal(calculateScenarios({...base, amounts: ['49']})[0].unspentInvestment, '49');
const cryptoBudget = calculateScenarios({...base, asset: 'CRYPTO', additionalPrice: '3', amounts: ['1']})[0];
assert.equal(cryptoBudget.additionalQuantity, '0.33333333');
assert.equal(cryptoBudget.unspentInvestment, '0.00000001');
assert.throws(() => calculateScenarios({...base, amounts: ['100.5']}), /정수/);
assert.throws(() => calculateTarget({...base, quantity: '999999999999999999999999', targetPrice: '51'}), /범위/);
console.log('V2 평균·목표·시나리오 정밀도 및 거래단위 검증 통과');
