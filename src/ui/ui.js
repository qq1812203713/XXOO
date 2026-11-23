// UI：一层很薄的壳。它不做任何“智能”的判断，只显示她内部正在发生什么。
import { clamp, timeOfDay } from '../core/util.js';
import { DRIVE_META } from '../brain/drives.js';

const $ = (id) => document.getElementById(id);

const MOOD_LABEL = {
  calm: '安静',
  happy: '开心',
  shy: '害羞',
  curious: '好奇',
  sleepy: '困了',
  sad: '低落',
  startled: '被吓到',
};

const CLIP_LABEL = {
  idle: '站着',
  walk: '走路',
  turnL: '向左转身',
  turnR: '向右转身',
  lookL: '往左看',
  lookR: '往右看',
  reachL: '伸手',
  reachR: '伸手',
  grip: '握了握手',
  stretch: '伸懒腰',
  freeze: '定格',
};

const FINGER_CN = { Thumb: '拇指', Index: '食指', Middle: '中指', Ring: '无名指', Little: '小指' };

const LAYER_LABEL = {
  brain: '意图',
  cerebellum: '小脑',
  motor: '运动',
  reflex: '反射',
  face: '表情',
  cortex: '皮层',
};

export function createUI({ rig, brain, drives, world, memory, motors, cortex, renderer, log, getBody, onSave, onReset }) {
  const refs = {
    bubble: $('bubble'),
    bubbleText: $('bubble-text'),
    hudState: $('hud-state'),
    drives: $('drives'),
    nerves: $('nerves'),
    nerveGoal: $('nerve-goal'),
    inspector: $('inspector'),
    motorLog: $('motor-log'),
    settings: $('settings'),
    intro: $('intro'),
    toast: $('toast'),
    say: $('say'),
    send: $('send'),
    speed: $('speed'),
    pulse: $('pulse'),
  };

  const ui = {
    pointer: { x: 0, y: 0, active: false },
    petting: false,
    thinking: false,
    speed: 1,
  };

  // ————— 驱力条 —————
  const bars = {};
  for (const [key, meta] of Object.entries(DRIVE_META)) {
    const row = document.createElement('div');
    row.className = 'drive';
    const lbl = document.createElement('div');
    lbl.className = 'lbl';
    const name = document.createElement('span');
    name.textContent = meta.label;
    const val = document.createElement('span');
    val.textContent = '0';
    lbl.append(name, val);
    const bar = document.createElement('div');
    bar.className = 'bar';
    const fill = document.createElement('div');
    fill.className = 'fill';
    fill.style.color = meta.color;
    fill.style.background = meta.color;
    bar.append(fill);
    row.append(lbl, bar);
    refs.drives.append(row);
    bars[key] = { fill, val };
  }

  // ————— toast —————
  let toastTimer = 0;
  function toast(text, ms = 2200) {
    refs.toast.textContent = text;
    refs.toast.hidden = false;
    refs.toast.classList.remove('out');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      refs.toast.classList.add('out');
      setTimeout(() => (refs.toast.hidden = true), 260);
    }, ms);
  }
  ui.toast = toast;

  // ————— 面板开关 —————
  let nerveTab = { side: 'L', part: 'body' };

  // 自检：把神经面板自己截下来回传，这样我能直接看到它长什么样
  const FLAGS = globalThis.__XXOO_FLAGS__ || '';
  const NERVE_SHOT = /nerveshot/.test(FLAGS);
  const tabFlag = /ntab=([LR]):(hand|foot|body)/.exec(FLAGS);
  if (tabFlag) nerveTab = { side: tabFlag[1], part: tabFlag[2] };
  let lastNerveShot = 0;
  let heroTabBound = false;

  function openNerves(open) {
    refs.nerves.hidden = !open;
    if (open) {
      $('open-nerves')?.classList.add('on');
    } else {
      $('open-nerves')?.classList.remove('on');
    }
  }

  function openSettings(open) {
    refs.settings.hidden = !open;
    if (open) fillSettings();
  }

  function fillSettings() {
    $('llm-enabled').checked = Boolean(cortex.cfg.enabled);
    $('llm-base').value = cortex.cfg.baseUrl || '';
    $('llm-model').value = cortex.cfg.model || '';
    $('llm-key').value = cortex.cfg.key || '';
    $('llm-hint').textContent = cortex.lastError
      ? `上次错误：${cortex.lastError}`
      : '留空则只用本地心智。Key 不会离开这台设备。';
    const st = $('llm-status');
    if (st) {
      st.textContent = cortex.cfg.enabled && cortex.cfg.key ? '当前：已启用（会调用远端模型）' : '当前：未启用，只用本地心智';
    }
  }

  $('open-nerves').addEventListener('click', () => openNerves(refs.nerves.hidden));
  if (/nerves(=|&|$)/.test(FLAGS)) openNerves(true);
  $('open-settings').addEventListener('click', () => openSettings(true));
  for (const btn of document.querySelectorAll('[data-close]')) {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-close');
      if (id === 'nerves') openNerves(false);
      if (id === 'settings') openSettings(false);
    });
  }

  // 神经面板 tab
  function markTabs() {
    for (const b of document.querySelectorAll('#nerve-tabs button')) {
      const on = b.dataset.side === nerveTab.side && b.dataset.part === nerveTab.part;
      b.classList.toggle('on', on);
    }
    $('inspector-hint').textContent =
      nerveTab.part === 'body'
        ? '全身 · 线是真的骨头，青色越亮 = 这一下动得越快'
        : nerveTab.part === 'hand'
          ? `第 ${nerveTab.side === 'L' ? '左' : '右'} 手 · 15 节指骨，数字是现在的弯曲角度`
          : `第 ${nerveTab.side === 'L' ? '左' : '右'} 脚 · 脚踝与脚趾的真实朝向`;
  }
  for (const b of document.querySelectorAll('#nerve-tabs button')) {
    b.addEventListener('click', () => {
      nerveTab = { side: b.dataset.side, part: b.dataset.part };
      markTabs();
    });
  }
  markTabs();

  // ————— 设置保存 —————
  $('save-settings').addEventListener('click', () => {
    cortex.configure({
      enabled: $('llm-enabled').checked,
      baseUrl: $('llm-base').value.trim() || 'https://api.openai.com/v1',
      model: $('llm-model').value.trim() || 'gpt-4o-mini',
      key: $('llm-key').value.trim(),
    });
    onSave?.();
    toast(cortex.shouldUseLLM() ? '她可以借用更远的心智了' : '已切回本地心智');
    openSettings(false);
  });

  // 测试连接：把“到底通不通”变成一个按钮，而不是让你猜
  $('llm-test')?.addEventListener('click', async () => {
    const status = $('llm-status');
    const btn = $('llm-test');
    const patch = {
      enabled: true,
      baseUrl: $('llm-base').value.trim() || 'https://api.openai.com/v1',
      model: $('llm-model').value.trim() || 'gpt-4o-mini',
      key: $('llm-key').value.trim(),
    };
    if (!patch.key) {
      status.textContent = '先填 API Key。';
      return;
    }
    cortex.configure(patch);
    btn.disabled = true;
    status.textContent = '正在连接…';
    const res = await cortex.askLLM({ userText: '这是一次连接测试，请正常回一句。' });
    btn.disabled = false;
    if (res) {
      status.textContent = `连通了。她回：「${res.say}」`;
    } else heroFallback();
    function heroFallback() {
      const err = cortex.lastError || '没有任何返回';
      status.textContent =
        `失败：${err}。\n` +
        '「直连 … Failed to fetch」= 浏览器被跨域挡住（或地址写错、http/https 混用）；' +
        '「代理 …」也不行的话，说明这台机器的服务器没法出网。' +
        '地址请写到 /v1 为止，例如 https://api.openai.com/v1。';
    }
  });

  $('reset').addEventListener('click', () => {
    if (!confirm('清空她的一切？身体、记忆、世界都会重新开始。')) return;
    onReset?.();
    openSettings(false);
  });

  // ————— 开场 —————
  let introSeen = false;
  try {
    introSeen = localStorage.getItem('xxoo.intro') === '1';
  } catch {
    /* ignore */
  }
  function enterWorld() {
    refs.intro.hidden = true;
    refs.intro.style.display = 'none';
    try {
      localStorage.setItem('xxoo.intro', '1');
    } catch {
      /* ignore */
    }
  }
  if (introSeen) refs.intro.hidden = true;
  $('enter').addEventListener('click', enterWorld);
  // 点遮罩任何地方都能进（手机上更宽容）
  refs.intro.addEventListener('click', enterWorld);

  // ————— 速度 —————
  const SPEEDS = [1, 2, 0.3];
  let speedIndex = 0;
  $('speed').addEventListener('click', () => {
    speedIndex = (speedIndex + 1) % SPEEDS.length;
    ui.speed = SPEEDS[speedIndex];
    $('speed').textContent = ui.speed === 0.3 ? '慢放' : `${ui.speed}×`;
  });

  // ————— 指针：戳 / 摸 —————
  const canvas = $('stage');
  let down = false;
  let downTime = 0;
  let lastPointerAt = 0;
  let lastPetAt = 0;
  let moved = 0;
  let downPart = null;
  let lastPos = { x: 0, y: 0 };

  function updatePointer(e) {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const w = renderer.unproject(x, y);
    ui.pointer.x = w.x;
    ui.pointer.y = w.y;
    ui.pointer.active = true;
    lastPointerAt = performance.now();
    return { x, y };
  }

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    canvas.setPointerCapture?.(e.pointerId);
    updatePointer(e);
    down = true;
    downTime = performance.now();
    moved = 0;
    lastPos = { x: e.clientX, y: e.clientY };
    downPart = renderer.bodyPartAt(ui.pointer.x, ui.pointer.y, brain.state.pose);
    if (downPart) {
      brain.onTouch(downPart, 'poke', { x: ui.pointer.x, y: ui.pointer.y });
      if (navigator.vibrate) navigator.vibrate(8);
    } else {
      brain.state.ripples.push({ x: ui.pointer.x, y: ui.pointer.y, t: 0, life: 1.1, kind: 'tap' });
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    updatePointer(e);
    if (!down) return;
    const dx = e.clientX - lastPos.x;
    const dy = e.clientY - lastPos.y;
    moved += Math.hypot(dx, dy);
    lastPos = { x: e.clientX, y: e.clientY };

    const now = performance.now();
    if (moved > 16) {
      ui.petting = true;
      const part = renderer.bodyPartAt(ui.pointer.x, ui.pointer.y, brain.state.pose);
      if (part && now - lastPetAt > 260) {
        lastPetAt = now;
        brain.onTouch(part, 'pet', { x: ui.pointer.x, y: ui.pointer.y });
      }
    }
  });

  function endPointer() {
    const held = performance.now() - downTime;
    if (down && !ui.petting && held > 520 && downPart) {
      // 长按：变成抚摸
      brain.onTouch(downPart, 'pet', { x: ui.pointer.x, y: ui.pointer.y });
    }
    down = false;
    ui.petting = false;
    downPart = null;
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('pointerleave', () => {
    ui.pointer.active = false;
  });

  // ————— 输入 —————
  async function send() {
    const text = refs.say.value.trim();
    if (!text || ui.thinking) return;
    refs.say.value = '';
    ui.thinking = true;
    refs.say.disabled = true;
    showThinking();
    try {
      await brain.respond(text);
    } finally {
      ui.thinking = false;
      refs.say.disabled = false;
      onSave?.();
    }
  }
  refs.send.addEventListener('click', send);
  refs.say.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      send();
    }
  });

  function showThinking() {
    refs.bubbleText.textContent = '· · ·';
    refs.bubble.hidden = false;
    ui.thinkingUntil = Date.now() + 20000;
  }

  // ————— 每帧 —————
  let lastSpeechId = -1;
  let lastLogRef = null;

  function positionBubble() {
    const pose = brain.state.pose;
    const head = pose?.get('head');
    if (!head) return;
    const p = renderer.project(head.x, head.y - 22);
    const half = Math.min(160, refs.bubble.offsetWidth / 2);
    refs.bubble.style.left = `${clamp(p.x, half + 12, renderer.width - half - 12)}px`;
    refs.bubble.style.top = `${clamp(p.y, 96, renderer.height - 120)}px`;
  }

  function updateDrives() {
    for (const [key, bar] of Object.entries(bars)) {
      const v = drives.v[key] ?? 0;
      bar.fill.style.width = `${Math.round(v * 100)}%`;
      bar.val.textContent = v.toFixed(2).slice(1);
      bar.fill.style.opacity = 0.45 + v * 0.55;
    }
  }

  function updateHud(now) {
    const mood = MOOD_LABEL[brain.state.mood] || '安静';
    refs.hudState.textContent = `${brain.goalLabel} · ${mood}`;
    refs.pulse.style.background = brain.state.mood === 'sleepy' ? 'rgba(150,180,255,0.8)' : '#ff9fbe';
  }

  function updateBubble(now) {
    const sp = brain.state.speech;
    if (ui.thinking) {
      refs.bubble.hidden = false;
      positionBubble();
      return;
    }
    if (!sp || now > sp.until) {
      refs.bubble.hidden = true;
      lastSpeechId = -1;
      return;
    }
    if (sp.id !== lastSpeechId) {
      lastSpeechId = sp.id;
      refs.bubbleText.textContent = sp.text;
      refs.bubble.hidden = false;
      refs.bubble.style.animation = 'none';
      void refs.bubble.offsetWidth;
      refs.bubble.style.animation = '';
    }
    refs.bubble.hidden = false;
    positionBubble();
  }

  // ————— 神经面板：画的是她身上真实的骨头 —————
  // 数据全部来自 VRM：世界坐标、真实转角。没有 3D 身体时才退回示意图。
  function drawNerve(g2, f, w, h) {
    g2.clearRect(0, 0, w, h);

    const isHand = nerveTab.part === 'hand';
    const isFoot = nerveTab.part === 'foot';
    const side = nerveTab.side === 'L' ? 'left' : 'right';
    const keep = new Set();
    if (!isHand && !isFoot) {
      for (const b of f.bones) keep.add(b.n);
    } else if (isHand) {
      keep.add(`${side}Hand`);
      keep.add(`${side}LowerArm`);
      for (const n of f.bones) if (n.n.startsWith(side) && /Proximal|Intermediate|Distal|Metacarpal/.test(n.n)) keep.add(n.n);
    } else {
      keep.add(`${side}Foot`);
      keep.add(`${side}LowerLeg`);
      keep.add(`${side}Toes`);
    }

    const byName = new Map();
    for (const b of f.bones) if (keep.has(b.n)) byName.set(b.n, b);
    if (!byName.size) return;

    // 正面投影：她在 -Z 面向镜头，所以屏幕 x 就是 -x
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const b of byName.values()) {
      const px = -b.x;
      const py = -b.y;
      minX = Math.min(minX, px);
      maxX = Math.max(maxX, px);
      minY = Math.min(minY, py);
      maxY = Math.max(maxY, py);
    }
    // 留出轮廓（头是圆、鞋有厚度）的余量，否则头顶和脚底会被切掉
    const spanX = Math.max(1e-3, maxX - minX);
    const spanY = Math.max(1e-3, maxY - minY);
    const pad = 14;
    const s = Math.min((w - pad * 2) / (spanX * 1.22), (h - pad * 2) / (spanY * 1.16));
    const ox = w / 2 - ((minX + maxX) / 2) * s;
    const oy = h / 2 - ((minY + maxY) / 2) * s;
    const X = (b) => -b.x * s + ox;
    const Y = (b) => -b.y * s + oy;

    g2.save();
    g2.lineCap = 'round';

    const head = byName.get('head');
    const neck = byName.get('neck');
    const ls = byName.get('leftShoulder');
    const rs = byName.get('rightShoulder');
    const lu = byName.get('leftUpperLeg');
    const ru = byName.get('rightUpperLeg');
    const bodyH = Math.abs((head ? Y(head) : 0) - (lu ? Y(lu) : h));

    // —— 一层很淡的“身体”：光有线条太像示意图，加个轮廓才认得出是她 ——
    if (head) {
      g2.beginPath();
      g2.ellipse(X(head), Y(head) - bodyH * 0.06, bodyH * 0.11, bodyH * 0.13, 0, 0, Math.PI * 2);
      g2.fillStyle = 'rgba(255,214,232,0.10)';
      g2.fill();
      g2.strokeStyle = 'rgba(255,214,232,0.28)';
      g2.lineWidth = 1.2;
      g2.stroke();
    }
    if (ls && rs && lu && ru && neck) {
      g2.beginPath();
      g2.moveTo(X(ls), Y(ls));
      g2.lineTo(X(neck), Y(neck));
      g2.lineTo(X(rs), Y(rs));
      g2.lineTo(X(ru), Y(ru));
      g2.lineTo(X(lu), Y(lu));
      g2.closePath();
      const grd = g2.createLinearGradient(0, Y(head || neck), 0, Y(lu));
      grd.addColorStop(0, 'rgba(255,200,225,0.13)');
      grd.addColorStop(1, 'rgba(150,190,255,0.07)');
      g2.fillStyle = grd;
      g2.fill();
      g2.strokeStyle = 'rgba(255,206,230,0.22)';
      g2.lineWidth = 1;
      g2.stroke();
    }
    // 四肢：先铺一条粗的暗色，再叠亮线，看起来才有体积
    const limbs = [
      ['leftShoulder', 'leftUpperArm'],
      ['leftUpperArm', 'leftLowerArm'],
      ['leftLowerArm', 'leftHand'],
      ['rightShoulder', 'rightUpperArm'],
      ['rightUpperArm', 'rightLowerArm'],
      ['rightLowerArm', 'rightHand'],
      ['leftUpperLeg', 'leftLowerLeg'],
      ['leftLowerLeg', 'leftFoot'],
      ['rightUpperLeg', 'rightLowerLeg'],
      ['rightLowerLeg', 'rightFoot'],
    ];
    for (const [a, b] of limbs) {
      const A = byName.get(a);
      const B = byName.get(b);
      if (!A || !B) continue;
      g2.strokeStyle = 'rgba(60,40,70,0.55)';
      g2.lineWidth = 7;
      g2.beginPath();
      g2.moveTo(X(A), Y(A));
      g2.lineTo(X(B), Y(B));
      g2.stroke();
    }

    // 骨：热度越高越亮
    const link = (a, b) => {
      if (!a || !b) return;
      const heat = Math.max(a.a, b.a);
      g2.strokeStyle = heat > 0.08 ? `rgba(120,240,255,${0.14 + heat * 0.6})` : 'rgba(255,196,224,0.2)';
      g2.lineWidth = 1.6 + heat * 3;
      g2.beginPath();
      g2.moveTo(X(a), Y(a));
      g2.lineTo(X(b), Y(b));
      g2.stroke();
    };
    for (const chain of f.chains) {
      for (let i = 1; i < chain.length; i++) link(byName.get(chain[i - 1]), byName.get(chain[i]));
    }

    // 关节
    for (const b of byName.values()) {
      const r = 2.2 + b.a * 2.6;
      g2.beginPath();
      g2.arc(X(b), Y(b), r, 0, Math.PI * 2);
      g2.fillStyle = b.a > 0.06 ? `rgba(140,245,255,${0.5 + b.a * 0.5})` : 'rgba(255,206,230,0.6)';
      g2.fill();
      if (b.a > 0.25) {
        g2.beginPath();
        g2.arc(X(b), Y(b), r + 3.5, 0, Math.PI * 2);
        g2.strokeStyle = `rgba(140,245,255,${0.25 * b.a})`;
        g2.lineWidth = 1.4;
        g2.stroke();
      }
    }

    // 手：每根手指现在的真实弯曲角度，排成一列，别糊在一起
    if (isHand && f.fingers) {
      const list = f.fingers.filter((x) => x.side === nerveTab.side);
      g2.font = '10.5px ui-sans-serif, system-ui, sans-serif';
      g2.textBaseline = 'middle';
      list.forEach((fg, i) => {
        const y0 = 18 + i * 13;
        const bend = fg.maxBend;
        g2.fillStyle = bend > 45 ? 'rgba(140,245,255,0.95)' : bend > 12 ? 'rgba(190,230,255,0.8)' : 'rgba(255,206,230,0.62)';
        g2.fillText(`${FINGER_CN[fg.finger] || fg.finger}`, 10, y0);
        g2.textAlign = 'right';
        g2.fillText(`${bend.toFixed(0)}°`, 96, y0);
        g2.textAlign = 'left';
        // 一根小横条：长度就是弯曲程度
        g2.fillStyle = 'rgba(255,255,255,0.10)';
        g2.fillRect(104, y0 - 2, 54, 4);
        g2.fillStyle = bend > 45 ? 'rgba(140,245,255,0.9)' : 'rgba(255,180,214,0.7)';
        g2.fillRect(104, y0 - 2, Math.min(54, (bend / 120) * 54), 4);
      });
      g2.fillStyle = 'rgba(255,214,232,0.55)';
      g2.fillText('握力 = 各节指骨相对手掌的转角', 10, 18 + list.length * 13 + 4);
    }
    g2.restore();

    // 右下角：她现在在做什么
    g2.font = '11px ui-sans-serif, system-ui, sans-serif';
    g2.fillStyle = 'rgba(255,214,232,0.8)';
    g2.textAlign = 'right';
    const steps = Math.max(0, Math.round(f.walked / 0.26));
    g2.fillText(`${CLIP_LABEL[f.clip] || f.clip} · ${f.bones.length} 根骨 · ${steps} 步`, w - 8, h - 8);
    g2.textAlign = 'left';
  }

  function updateInspector() {
    if (refs.nerves.hidden) return;
    const c = refs.inspector;
    const rect = c.getBoundingClientRect();
    if (!rect.width) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (c.width !== Math.round(rect.width * dpr)) {
      c.width = Math.round(rect.width * dpr);
      c.height = Math.round(rect.height * dpr);
    }
    const g2 = c.getContext('2d');
    g2.setTransform(dpr, 0, 0, dpr, 0, 0);

    const body = getBody?.();
    const frame = body?.nerveFrame?.();
    if (frame) {
      drawNerve(g2, frame, rect.width, rect.height);
      if (NERVE_SHOT && performance.now() - lastNerveShot > 1200) {
        lastNerveShot = performance.now();
        fetch('./shot', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tag: 'nerve', data: c.toDataURL('image/jpeg', 0.9) }),
        }).catch(() => {});
      }
      return;
    }
    // 没有 3D 身体（Live2D / 2D）时退回骨骼示意图
    renderer.drawInspector(g2, {
      rig,
      pose: brain.state.pose,
      side: nerveTab.side,
      part: nerveTab.part,
      width: rect.width,
      height: rect.height,
    });
  }

  function updateLog() {
    if (refs.nerves.hidden) return;
    const top = log.items[0];
    if (top === lastLogRef) return;
    lastLogRef = top;
    const frag = document.createDocumentFragment();
    for (const item of log.items.slice(0, 22)) {
      const li = document.createElement('li');
      li.className = item.layer || 'motor';
      const b = document.createElement('b');
      b.textContent = LAYER_LABEL[item.layer] || item.layer || '';
      const span = document.createElement('span');
      span.textContent = item.text;
      li.append(b, span);
      frag.append(li);
    }
    refs.motorLog.replaceChildren(frag);
  }

  function frame(dt, now) {
    updateDrives();
    updateHud(now);
    updateBubble(now);
    updateInspector();
    updateLog();

    if (now - lastPointerAt > 2600) ui.pointer.active = false;

    refs.nerveGoal.textContent = `${brain.goalLabel} · ${MOOD_LABEL[brain.state.mood] || '安静'} · ${
      timeOfDay() === 'night' ? '夜' : '日'
    }`;
  }

  return {
    frame,
    pointer: ui.pointer,
    get petting() {
      return ui.petting;
    },
    get speed() {
      return ui.speed;
    },
    toast,
    fillSettings,
    get thinking() {
      return ui.thinking;
    },
  };
}
