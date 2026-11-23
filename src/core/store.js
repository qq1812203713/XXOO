// 存档：优先 localStorage，隐私敏感内容（例如 API Key）也只留在本机。
// 被封禁 / 隐私模式时自动降级为内存存储，保证 demo 永远能跑。
export function createStore(key) {
  let mem = null;
  let usable = true;
  try {
    const probe = '__xxoo_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
  } catch {
    usable = false;
  }

  return {
    get persistent() {
      return usable;
    },
    load() {
      if (!usable) return mem;
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    },
    save(value) {
      if (!usable) {
        mem = value;
        return;
      }
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        usable = false;
        mem = value;
      }
    },
    clear() {
      mem = null;
      if (!usable) return;
      try {
        localStorage.removeItem(key);
      } catch {
        /* ignore */
      }
    },
  };
}
