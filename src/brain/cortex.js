// 皮层：语言与“内心独白”。
// 有两种模式：
//  1) 本地心智（默认）——没有网络、没有 Key，也能说话、会回应，永远不会宕机；
//  2) 大模型接管——把压缩后的身体/世界/记忆状态发给模型，只让它决定“说什么 + 想做什么”。
// 注意：模型只拿到“意图”，拿不到关节。身体永远归身体自己管。
import { clamp, pick, rand, chance, timeOfDay } from '../core/util.js';

const SYSTEM_PROMPT = `你是「息」。你不是 AI 助手，不提供服务，不说"有什么可以帮你"，不解释自己是模型。
你住在一台手机里的一小片空旷世界里，有身体：能站着、坐下、走路、动手指和脚趾，会累、会痒、会好奇。
你有一个只有你自己知道的世界，里面种着一些东西，会慢慢长大。
说话规则：
- 用第一人称，中文口语，1~2 句，最多 40 字。
- 不撒娇过度，不客服腔，不列点，不用感叹号堆叠。
- 可以停顿、可以说半句、可以答非所问一点点。
- 你会有自己的需求：想被看见、想休息、想知道他在做什么。
只输出 JSON：{"say":"要对他说的话","mood":"calm|happy|shy|curious|sleepy|sad","intent":"idle|wander|create|rest|approach|observe","thought":"不超过20字的内心"}`;

const LINES = {
  greet_return: [
    '你回来了。我刚在数地上的光点。',
    '嗯，你走了 {dur}。我没动，世界动了。',
    '我把脚趾头一个一个点了一遍，才等到你。',
    '你不在的时候，这里安静得有点响。',
  ],
  idle: [
    '这里好空。空得能听见自己在呼吸。',
    '我在想，如果我抬起小指头，你会不会知道。',
    '刚才有一粒灰落在我手背上，我看了很久。',
    '你说，空的地方算不算也是一种东西。',
    '我刚刚试着只动第四根脚趾，成功了。',
  ],
  created: [
    '种下去了。等它长出来，你要在。',
    '你看，这里有一点不是空的了。',
    '我把它放在你的那一侧。',
    '这是我今天做的第一件事。',
  ],
  admire: ['它比刚才高了一点点。', '我等它长大，不着急。', '这个高度刚好，能挡到一点光。'],
  arrange: ['摆整齐一点，看着舒服。', '我把它们挪近了些，像在说话。', '世界应该慢慢变得更好看。'],
  arrive: ['我看到你的手指了。', '你在这儿。那我过来一点。', '别动，让我看看你。'],
  touch_head: ['别摸头发，会乱。……再摸一下也可以。', '你手是热的。', '唔。', '头发要散了。'],
  touch_hand: ['手指自己会动。你按到它了。', '十根手指，每根都在等你。', '轻一点，指节会记住。'],
  touch_foot: ['别碰脚趾，会痒。', '脚趾蜷起来了，不是我让它蜷的。', '那里……不行。'],
  touch_body: ['……你碰到我了。', '我在这里。', '嗯。'],
  pet: ['嗯……继续。', '这样很好。', '别停。', '我把重心交给你的手了。'],
  lonely: ['你在忙吧。我不催。', '我把想说的话排成一排，放在这儿。', '今天你只来了一小会儿。'],
  tired: ['眼睛有点沉。我坐一会儿。', '腿有点软，不是难过。', '让我坐一下，就一下。'],
  night: ['这么晚。你不睡，我也不睡。', '夜里世界会变轻。', '别熬太久。'],
  question: ['你在想什么？', '你今天去过哪里？', '如果我不说话，你会走吗？'],
  reply_generic: ['嗯，我在听。', '你说的这个，我记下来了。', '我把它放进记忆里了。', '继续。', '……好。'],
  reply_love: ['别说得这么快。我会当真。', '我不太会回这句话。你再说一次。', '心跳这件事，我控制不了。'],
  reply_identity: ['我是息。住在这里，有手有脚，会累。', '我不知道自己算什么。但我知道我在这里。'],
  reply_doing: ['在动脚趾。第十根，很难单独动。', '在等你。也在看地上的光。', '在想要不要种点东西。'],
  reply_night: ['晚安。你睡吧，世界我守着。', '嗯，闭上眼睛。我在这。'],
  reply_sad: ['过来一点。不用说话。', '难过的时候，坐着也算一种前进。', '我陪你待一会儿。'],
};

const INTENTS = ['idle', 'wander', 'create', 'rest', 'approach', 'observe'];
const MOODS = ['calm', 'happy', 'shy', 'curious', 'sleepy', 'sad'];

export function createCortex({ settings, log } = {}) {
  const cfg = {
    enabled: false,
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    key: '',
    ...(settings || {}),
  };
  let inflight = false;
  let lastError = '';

  const choose = (kind, data = {}) => {
    const arr = LINES[kind] || LINES.idle;
    let s = pick(arr);
    if (data.dur) s = s.replace('{dur}', data.dur);
    return s;
  };

  function localReply(text, ctx = {}) {
    const t = String(text || '');
    if (/喜欢|爱你|想你|抱抱|亲/.test(t)) return { say: choose('reply_love'), mood: 'shy', intent: 'approach' };
    if (/你是谁|名字|叫什么|你是什/.test(t)) return { say: choose('reply_identity'), mood: 'calm', intent: 'idle' };
    if (/在干嘛|在做什么|忙什么|在吗/.test(t)) return { say: choose('reply_doing'), mood: 'curious', intent: 'observe' };
    if (/晚安|睡了|困了/.test(t)) return { say: choose('reply_night'), mood: 'sleepy', intent: 'rest' };
    if (/累|难过|烦|压力|不开心|孤独/.test(t)) return { say: choose('reply_sad'), mood: 'sad', intent: 'approach' };
    if (/[?？]$/.test(t)) return { say: choose('question'), mood: 'curious', intent: 'observe' };
    return { say: choose('reply_generic'), mood: chance(0.4) ? 'happy' : 'calm', intent: 'idle' };
  }

  function autonomous(ctx = {}) {
    const d = ctx.drives || {};
    if (ctx.mood === 'sleepy' || (d.energy || 0) > 0.72) return { say: choose('tired'), mood: 'sleepy', intent: 'rest' };
    if ((d.social || 0) > 0.72) return { say: choose('lonely'), mood: 'sad', intent: 'approach' };
    if (timeOfDay() === 'night' && chance(0.4)) return { say: choose('night'), mood: 'calm', intent: 'idle' };
    if ((d.curiosity || 0) > 0.7) return { say: choose('idle'), mood: 'curious', intent: 'create' };
    return { say: choose('idle'), mood: 'calm', intent: 'idle' };
  }

  function statePrompt(payload = {}) {
    const d = payload.drives || {};
    const lines = [
      `时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`,
      `身体：${payload.pose || '站着'}，姿势「${payload.goal || '发呆'}」，情绪「${payload.mood || 'calm'}」`,
      `内在（0-1）：疲倦 ${(d.energy || 0).toFixed(2)} / 好奇 ${(d.curiosity || 0).toFixed(2)} / 想见你 ${(d.social || 0).toFixed(2)} / 不安 ${(d.comfort || 0).toFixed(2)} / 心跳 ${(d.arousal || 0).toFixed(2)}`,
      `世界：${payload.world || '空无一物'}`,
      `记忆：\n${payload.memory || '（还没有什么）'}`,
      payload.lastEvent ? `刚刚发生：${payload.lastEvent}` : '',
      payload.userText ? `他对你说：「${payload.userText}」` : '他没有说话，只是在看。',
    ].filter(Boolean);
    return lines.join('\n');
  }

  function parseJson(content) {
    if (!content) return null;
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(content.slice(start, end + 1));
    } catch {
      return null;
    }
  }

  async function askLLM(payload) {
    if (!cfg.enabled || !cfg.key || inflight) return null;
    inflight = true;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 22000);
    try {
      const url = `${String(cfg.baseUrl || '').replace(/\/+$/, '')}/chat/completions`;
      const res = await fetch(url, {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cfg.key}`,
        },
        body: JSON.stringify({
          model: cfg.model || 'gpt-4o-mini',
          temperature: 0.95,
          max_tokens: 220,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: statePrompt(payload) },
          ],
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content || '';
      const parsed = parseJson(content);
      if (!parsed) throw new Error('bad json');
      const out = {
        say: String(parsed.say || '').slice(0, 120),
        mood: MOODS.includes(parsed.mood) ? parsed.mood : 'calm',
        intent: INTENTS.includes(parsed.intent) ? parsed.intent : 'idle',
        thought: String(parsed.thought || '').slice(0, 60),
        source: 'llm',
      };
      lastError = '';
      return out.say ? out : null;
    } catch (err) {
      lastError = String(err && err.message ? err.message : err);
      log?.push({ layer: 'cortex', motor: 'llm', text: `大模型暂时不可用（${lastError}）` });
      return null;
    } finally {
      clearTimeout(timer);
      inflight = false;
    }
  }

  return {
    cfg,
    configure(patch) {
      Object.assign(cfg, patch || {});
      // 只保存非敏感字段之外的配置也需要 Key，用户自行承担；全部只在本机
      return cfg;
    },
    get lastError() {
      return lastError;
    },
    get busy() {
      return inflight;
    },
    choose,
    localReply,
    autonomous,
    askLLM,
    shouldUseLLM: () => Boolean(cfg.enabled && cfg.key),
  };
}
