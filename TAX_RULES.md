# 세금 계산 규칙 및 검증 기록

- 개발 버전: 0.11.19
- 규칙 버전: 2026.09.24.1 (구현 정합성 수정; 공식 자료 확인일은 별도 유지)
- 공식 자료 조회일: 2026-09-20
- 지원: 6개국 개인 일반투자자, 2026년 현물 주식·암호자산. 한국 암호자산 2027년은 `scheduled`.
- 파일: `src/coin/data/tax_rules.json`, `src/coin/taxes.py`.
- 새 과세연도는 기존 데이터를 수정하여 재사용하지 않고 새 레코드로 추가한다. 미검증 연도는 자동 계산하지 않는다. 조회일은 법률의 실시간 최신성을 보장하는 표시가 아니다.

## 확인한 공식 자료와 반영 내용

| 국가 | 공식 자료 | 반영 내용 |
|---|---|---|
| 한국 | [국세청 가상자산](https://j.nts.go.kr/nts/cm/cntnts/cntntsView.do?cntntsId=238935&mi=40370), [2026년 주식 안내](https://b.nts.go.kr/nts/na/ntt/selectNttInfo.do?mi=2201&nttSn=1353905), [증권거래세 시행령 제5조](https://www.law.go.kr/LSW/lsSideInfoP.do?docCls=jo&joBrNo=00&joNo=0005&lsiSeq=280901&urlMode=lsScJoRltInfoR), [해외주식 신고 안내](https://taxlaw.nts.go.kr/downloadPDFFile.do?fleId=300000000001047678&fleSn=923559) | 해외주식 공제·본세·지방세, 시장별 거래세, 코인 과세 유예 및 2027년 예정·경과 취득가액. 대주주·비상장·장외는 별도 검토. |
| 미국 | [IRS 2026 세율표](https://www.irs.gov/irb/2025-45_IRB), [자본손익](https://www.irs.gov/taxtopics/tc409), [NIIT](https://www.irs.gov/taxtopics/tc559), [외국세액공제](https://www.irs.gov/instructions/i1116) | 4개 신고 상태, 보유기간별 누진세·손익상계, NIIT 증가분, 순손실 공제·이월 한도. 주·지방세는 제외 사실을 표시. |
| 일본 | [해외주식](https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1937.htm), [누진세율](https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/2260.htm), [암호자산](https://www.nta.go.jp/publication/pamph/shotoku/kakuteishinkokukankei/kasoutuka/), [NISA](https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1535.htm), [도쿄 주민세 안내](https://www.tax.metro.tokyo.lg.jp/shitsumon/life/sonota) | 주식 소득세·부흥특별세·주민세, 적격 NISA, 코인에 따른 종합소득세 증가분. 주민세 10%는 지역·공제 차이를 제외한 추정. |
| 중국 본토 | [개인소득세법](https://www.chinatax.gov.cn/n810219/n810744/n3752930/n3752974/c3970366/content.html), [해외소득](https://www.chinatax.gov.cn/chinatax/n810219/n810744/n3752930/n3752974/c5143076/content.html), [인지세 감면](https://shanxi.chinatax.gov.cn/web/detail/sx-11400-545-1780448), [2026-02-06 규제 공지](https://www.amac.org.cn/xwfb/zjyw/202602/t20260206_27340.html) | 적격 상하이·선전 공개시장 거래와 매도 인지세, 해외주식 단일 처분의 20% 참고치 및 특례 검토. 코인은 `review_required`로 계산 차단. 2026년 공지는 기존 2021년 공지를 대체함을 확인. |
| 독일 | [EStG §20](https://www.gesetze-im-internet.de/estg/__20.html), [§23](https://www.gesetze-im-internet.de/estg/__23.html), [§32a](https://www.gesetze-im-internet.de/estg/__32a.html), [§32d](https://www.gesetze-im-internet.de/estg/__32d.html), [연대부가세](https://www.gesetze-im-internet.de/solzg_1995/BJNR097500993.html), [코인 지침](https://www.bundesfinanzministerium.de/Content/DE/Downloads/BMF_Schreiben/Steuerarten/Einkommensteuer/2025-03-06-einzelfragen-kryptowerte.html) | 주식 공제·교회세 조정 본세·연대부가세, 코인 1년 초과 제외·€1,000 면세한도, 2026년 소득세 다항식·공동과세·연대부가세 완화구간. |
| 스페인 | [저축소득 세율 개정](https://www3.agenciatributaria.gob.es/Sede/irpf/novedades-impuesto/novedades-normativa-2024.html), [손실상계](https://sede.agenciatributaria.gob.es/Sede/ayuda/manuales-videos-folletos/manuales-practicos/irpf-2025/c12-integracion-compensacion-rentas/reglas-integracion-compensacion-rentas/integracion-compensacion-rentas-base-imponible-ahorro.html), [FIFO](https://sede.agenciatributaria.gob.es/Sede/ayuda/manuales-videos-folletos/manuales-practicos/irpf-2024/c11-ganancias-perdidas-patrimoniales/monedas-virtuales/compra-venta-monedas-virtuales-tributacion-inversor.html), [국제 이중과세 공제](https://sede.agenciatributaria.gob.es/Sede/Ayuda/23Presentacion/100/8_7_3.html) | 5단계 누진세율, FIFO, 교환 시 두 시장가치 중 큰 금액, 자본소득 손실 교차상계 25% 한도. 특별지역·미사용 개인최저공제는 검토 분기. |

농어촌특별세 매도액 기준은 [농촌진흥청 안내](https://www.rda.go.kr/young/content/content0518.do)도 확인했다. 출처별 URL은 규칙 데이터와 결과 화면에 포함한다.

## 계산 범위와 필수 확인

- 한 번의 처분에 동일 자산 잔여 취득 로트 최대 50개를 입력한다. FIFO 배분 또는 일본의 확인된 평균원가 풀에 대한 비례배분을 수행한다. 이전 처분 내역·워시세일·재매수 제한·원가조정은 자동 장부 처리하지 않는다. 사용자가 세법상 원가와 허용 손실을 확인해야 계산한다. 단, 한국 암호자산 2026년·일본 적격 NISA는 금액과 원가 확인 없이 비과세 안내를 반환한다. 동일 취득일 FIFO는 사용자가 입력한 행 순서를 따른다.
- 취득 총액은 입력한 잔여 수량에 대응하는 금액이다. 일본의 총평균·신고된 이동평균 선택 및 연중 다른 거래를 반영한 원가 풀은 사용자가 사전 확인한다. 각 로트와 처분은 개별 거래일 환율을 사용한다. 현재 환율 API로 대체하지 않는다.
- 연간 다른 손익은 같은 과세 분류의 허용 이익·손실만 입력한다. 미국은 순단기·순장기를 별도 입력한다. 독일 코인은 다른 단기 사적 양도거래까지 포함해 전체 확인이 필요하다. 중국 해외주식은 다른 거래의 손실을 일괄 통산하지 않는다.
- 미국 MAGI와 기타 순투자소득은 이 계산에 입력한 자본손익을 제외한 금액이며 NIIT의 증가분을 추정한다. 일반소득 공제나 이월손실로 생기는 환급은 계산하지 않는다. 신고 상태·과세소득·NIIT 정보 누락 시 단일 세액 대신 범위를 표시한다.
- 일본·독일 코인은 공제 후 다른 과세소득을 기준으로 증가세액을 계산한다. 일본 소득세 과표 1,000엔 절사, 독일 소득세 유로 절사는 공식 산식에 적용한다. 나머지 결과는 내부 Decimal 계산 후 소수 둘째 자리 참고 금액으로 표시한다. 국가별 신고서 최종 절사·납부단위는 자동 신고 수준으로 재현하지 않는다.
- 외국납부세액은 전액 자동 공제하지 않는다. 6개국 간 모든 조세조약 조합 및 개인별 한도는 정밀 계산 범위 밖이다. 납부액이 있으면 공제 전 세액과 납부액을 표시하고 공제 후 세액·세후 수익을 미확정으로 둔다.
- 한국 2027년 코인의 2027년 이전 취득분은 2026-12-31 시가를 자국통화로 추가 입력해야 경과규정의 큰 취득가액을 적용한다. 예정 규칙임을 표시하며 시행 전 재검증이 필요하다.
- 입력은 서버나 DB에 저장하지 않는다. 기존 sessionStorage의 고정 1시간 수명에 함께 포함한다. 세법 자동 감시·자동 갱신·신고서 제출은 이번 요청 범위에 포함하지 않는다.

## 검증

- Python: 국가·자산·국내외 조합, 공제 경계, 독일 보유기간·면세한도, 미국 누진·NIIT·손실, 일본 NISA·누진, 스페인 €80,000 예제·교환, 중국 차단·인지세, 환율·수수료·부분매도, 타입·숫자·날짜 오류.
- JavaScript: 6개 언어·기존 계산 회귀, 세금 탭 세션 복원·초기화, 조건부 비활성 필드 제외, 로트 추가·삭제·복원, 오래된 응답 취소·만료·결과 렌더링.
- 실제 브라우저는 연결 가능한 브라우저가 없어 확인하지 못했다. DOM 대역 테스트는 실제 모바일·데스크톱 시각 검증을 대체하지 않는다.

## 2026-09-24 — 계산 생략 조건 재검토 (v0.11.13)

- 6개국의 지원 국가·자산·국내/해외 조합을 공식 자료와 대조하여 계산 생략 가능 여부를 재검토했다. 출처와 조합별 판정은 `codex/코인 수익률 계산기 사이트_세금계산_조건별_입력항목_정의서.md` 8절에 기록했다. 모든 세율을 새로 검증한 것은 아니므로 규칙 데이터의 기존 확인일은 변경하지 않았다.
- 한국 암호자산 2026년과 일본의 확인된 적격 NISA 주식은 금액·취득원가 확인 전에 비과세 응답을 반환한다. 화면은 입력·계산 버튼 대신 안내를 제공하며 NISA 확인은 해제할 수 있도록 남긴다. 특수 거래와 미지원 연도는 비과세로 처리하지 않는다.
- 한국·중국 국내주식은 거래세·인지세가 남아 계산을 유지한다. 독일 암호자산의 보유기간·연간 면세한도 및 기타 국가의 공제·손실·0% 세율은 추가 입력이 있어야 판단할 수 있으므로 기본 조합만으로 계산을 생략하지 않는다.
- 중국 암호자산은 비과세가 아니라 규제상 검토 필요 상태로 유지한다. 글로벌 미사용 입력항목은 없으며 이미 삭제된 지갑 이전 선택의 미사용 번역만 제거했다.

## 2026-09-24 — 구현 정합성 수정 (v0.11.19)

- 스페인 교환은 두 차감 전 시가 중 큰 금액에서 직접 처분 수수료를 한 번 차감한다. 포함 체크 시 받은 자산 시가는 처분 총액에 입력 수수료를 더해 복원한다. 수수료는 거래 통화로 필수 입력하며 없으면 0, 원래 자산 시가는 자국통화로 차감 전 금액을 입력한다. [스페인 국세청 교환·직접 비용 안내](https://sede.agenciatributaria.gob.es/Sede/Ayuda/24Presentacion/100/7_6_6_2/ganancias_perdidas_monedas_virtuales.html)를 재확인했다. 다른 국가의 세율·법령 확인일은 갱신하지 않았다.
- 일본 암호자산 소득 누락 범위에도 해외 납부액·공제 검토 안내를 남긴다. 공제 후 세액은 미확정이다.
- 한국 국내주식 공제 메타데이터, 독일 주식 보유기간, 일본 주식 누진구간 메타데이터를 실제 계산 조건에 맞췄다. `surtaxRules`는 국가 공통 계산 파라미터이며 모든 항목이 모든 자산·시장에 적용되는 것은 아니다.
- 국내/해외 레코드와 최상위 누진구간 복제 구조는 호환성을 위해 유지하되, 복제 계산 파라미터·실제 사용 구간의 일치 테스트를 추가했다.
- 화면의 수수료 포함 기본 true와 국내주식 통화 자동 지정은 UI 계약이다. 직접 API는 체크 누락 시 false이며 통화를 명시해야 한다. 스페인 교환 API는 수수료를 명시해야 한다.
