/** 브라우저 탭에만 저장하며 최초 저장 시각부터 고정된 1시간을 적용한다. */
export const TTL = 60 * 60 * 1000;
export const KEY = 'coin-calculator:v1';
export function createSession(storage, now = Date.now) {
  let startedAt = null;
  return {
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
    save(data) {
      if (startedAt === null) startedAt = now();
      if (this.expired()) { this.clear(); return false; }
      storage.setItem(KEY, JSON.stringify({startedAt, data}));
      return true;
    },
    expired() { return startedAt !== null && now() - startedAt >= TTL; },
    remaining() { return startedAt === null ? TTL : Math.max(0, TTL - (now() - startedAt)); },
    clear() { startedAt = null; try { storage.removeItem(KEY); } catch { /* 저장소 차단 시 무시한다. */ } }
  };
}
