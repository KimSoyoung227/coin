/** 서버와 동일한 JSON 번역 사전을 페이지에서 읽어 동적 UI에 사용한다. */
export const messages = JSON.parse(document.getElementById('translations').dataset.messages);

/** 지원 언어만 허용하고 번역 키를 반환한다. */
export function translator(language) {
  // 기존 영국 영어 세션은 동일 문구의 미국 영어로 이전한다.
  const requested = language === 'en' ? 'en-US' : language;
  const lang = Object.hasOwn(messages, requested) ? requested : 'ko';
  return {lang, t: key => messages[lang][key] ?? messages.ko[key] ?? key};
}
