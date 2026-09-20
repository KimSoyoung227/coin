/** 계산 결과와 시세 표시에서 공유하는 국가별 숫자·날짜 로케일. */
const LOCALES = {
  ko: 'ko-KR',
  'en-US': 'en-US',
  es: 'es-ES',
  zh: 'zh-CN',
  ja: 'ja-JP',
  de: 'de-DE'
};

/** 지원 언어의 표시 로케일을 반환하고 기본값은 한국어로 유지한다. */
export function localeFor(language) {
  return LOCALES[language] || 'ko-KR';
}
