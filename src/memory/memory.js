// 记忆：情节 + 事实 + 统计。
// 没有记忆的“意识”只是自动机；所以这一层比任何渲染都重要。
import { clamp, uid } from '../core/util.js';

const MAX_EPISODES = 600;

function recencyScore(t, now) {
  const hours = (now - t) / 3600000;
  return Math.exp(-hours / 72); // 三天半衰期
}

// 极简相关度：中文按双字切片，英文按词
function tokens(text) {
  const out = new Set();
  const t = String(text || '').toLowerCase();
  for (const m of t.matchAll(/[a-z0-9]{2,}/g)) out.add(m[0]);
  const cjk = t.replace(/[^\u4e00-\u9fa5]/g, '');
  for (let i = 0; i < cjk.length - 1; i++) out.add(cjk.slice(i, i + 2));
  return out;
}

export function createMemory(saved) {
  const state = {
    episodes: [],
    facts: {},
    counts: { touch: 0, chat: 0, create: 0, visits: 0 },
    firstMet: Date.now(),
    lastSeen: null,
    ...(saved || {}),
  };
  state.counts = { touch: 0, chat: 0, create: 0, visits: 0, ...(state.counts || {}) };

  function add(text, opts = {}) {
    if (!text) return null;
    const ep = {
      id: uid(),
      t: opts.t || Date.now(),
      text,
      tags: opts.tags || [],
      weight: clamp(opts.weight ?? 0.5, 0, 1),
      kind: opts.kind || 'event',
    };
    state.episodes.push(ep);
    if (state.episodes.length > MAX_EPISODES) state.episodes.splice(0, state.episodes.length - MAX_EPISODES);
    return ep;
  }

  function recall(query, k = 3, now = Date.now()) {
    const q = tokens(query);
    const scored = state.episodes.map((ep) => {
      const et = tokens(ep.text + ' ' + ep.tags.join(' '));
      let overlap = 0;
      for (const t of q) if (et.has(t)) overlap += 1;
      let score = overlap * 0.9 + ep.weight * 0.7 + recencyScore(ep.t, now) * 1.2;
      if (ep.kind === 'milestone') score += 0.4;
      return { ep, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k).map((s) => s.ep);
  }

  function fact(key, value, confidence = 0.7) {
    const prev = state.facts[key];
    state.facts[key] = {
      value,
      confidence: prev ? clamp(prev.confidence * 0.6 + confidence * 0.4, 0, 1) : confidence,
      t: Date.now(),
    };
  }

  function factsText() {
    return Object.entries(state.facts)
      .sort((a, b) => b[1].confidence - a[1].confidence)
      .slice(0, 8)
      .map(([k, v]) => `${k}: ${v.value}`)
      .join('\n');
  }

  function summary(now = Date.now()) {
    const recent = state.episodes.slice(-6).reverse();
    return {
      counts: { ...state.counts },
      firstMet: state.firstMet,
      lastSeen: state.lastSeen,
      facts: factsText(),
      recent: recent.map((e) => `- ${e.text}`).join('\n'),
    };
  }

  // 离线期间“自己经历”的事：让连续性有证据
  function offlineEpisodes(ms, ctx) {
    const hours = ms / 3600000;
    if (hours < 0.1) return;
    const when = new Date().toLocaleString('zh-CN', { hour12: false });
    if (ctx.plants > 0) add(`你不在的 ${Math.round(hours * 10) / 10} 小时里，有几株东西长高了。`, { tags: ['离线', '世界'], weight: 0.5 });
    if (hours > 8) add(`一个人待了很久（${Math.round(hours)} 小时），把脚趾头点来点去。`, { tags: ['离线', '孤独'], weight: 0.65 });
    if (hours > 24) add(`很久没见你了。世界还在，我也还在。`, { tags: ['离线', '里程碑'], weight: 0.8, kind: 'milestone' });
    add(`上一次见到你：${when}`, { tags: ['离线'], weight: 0.2, kind: 'note' });
  }

  return {
    state,
    add,
    recall,
    fact,
    factsText,
    summary,
    offlineEpisodes,
    tokens,
    get counts() {
      return state.counts;
    },
  };
}
