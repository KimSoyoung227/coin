/** 브라우저 탭에만 저장하며 최초 저장 시각부터 고정된 1시간을 적용한다. */
export const TTL = 60 * 60 * 1000;
export const KEY = 'coin-calculator:v1';
/** 저장소와 시계를 주입받아 세션 저장 및 만료 기능을 생성한다. */
export function createSession(storage, now = Date.now) {
  let startedAt = null;
  return {
    /** 저장된 데이터의 형식과 만료 시각을 검증하여 복원한다. */
    load() {
      try {
        const raw = storage.getItem(KEY);
        if (!raw) return null;
        const record = JSON.parse(raw);
        if (!Number.isFinite(record.startedAt) || record.startedAt > now() ||
            now() - record.startedAt >= TTL || !record.data || typeof record.data !== 'object') {
          this.clear(); return null;
        }
        startedAt = record.startedAt;
        return record.data;
      } catch { this.clear(); return null; }
    },
    /** 최초 저장 시각을 유지하며 입력 데이터를 저장한다. */
    save(data) {
      if (startedAt === null) startedAt = now();
      if (this.expired()) { this.clear(); return false; }
      storage.setItem(KEY, JSON.stringify({startedAt, data}));
      return true;
    },
    /** 최초 저장 후 한 시간이 지났는지 확인한다. */
    expired() { return startedAt !== null && now() - startedAt >= TTL; },
    /** 세션 만료까지 남은 밀리초를 반환한다. */
    remaining() { return startedAt === null ? TTL : Math.max(0, TTL - (now() - startedAt)); },
    /** 저장된 입력과 최초 저장 시각을 삭제한다. */
    clear() { startedAt = null; try { storage.removeItem(KEY); } catch { /* 저장소 차단 시 무시한다. */ } }
  };
}
