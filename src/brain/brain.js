// 大脑：把「需求 → 目标 → 意图 → 运动程序」串起来。
// 它从不直接碰关节角度。它只会说：看那边、手伸过去、坐下、把手张开。
import { clamp, damp, rand, chance, pick, fmtDuration, timeOfDay, noise1 } from '../core/util.js';
import { solvePose } from '../body/skeleton.js';
import { createGoals, GOAL_META } from './goals.js';

const PART_LABEL = {
  head: '头',
  chest: '胸口',
  pelvis: '腰',
  handL: '左手',
  handR: '右手',
  footL: '左脚',
  footR: '右脚',
  armL: '左臂',
  armR: '右臂',
  legL: '左腿',
  legR: '右腿',
  body: '身体',
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function defaultIntent() {
  return {
    handL: 'idle',
    handR: 'idle',
    footL: 'idle',
    footR: 'idle',
    reach: null,
    reachPoint: null,
    lookAt: null,
    wave: null,
  };
}

// 模型的口令 → 身体能演的动作
// 你随口一句「弯个腰」「挥挥手」，不必等大模型 —— 本地就听得懂。
// 顺序有讲究：越具体的越靠前。
const BODY_WORDS = [
  [/弯腰|鞠躬|鞠个躬|弯下|弯一下|低头/, 'bow'],
  [/点头|点点头|嗯嗯/, 'nod'],
  [/摇头|摇摇头|不干|拒绝/, 'shake'],
  [/挥手|招手|打招呼|拜拜|再见|hello|hi|hey/i, 'wave'],
  [/伸懒腰|伸个懒腰|伸展|举手|把手举/, 'stretch'],
  [/握(拳|手|一下)|抓一下|攥/, 'grip'],
  [/走过来|过来|靠近|走两步|走一下|走/, 'walk'],
  [/伸出?(左|右)?手|伸手/, 'reachR'],
];

const BODY_CLIP = {
  bow: 'bow',
  nod: 'nod',
  shake: 'shake',
  wave: 'wave',
  walk: 'walk',
  look_left: 'lookL',
  look_right: 'lookR',
  reach_left: 'reachL',
  reach_right: 'reachR',
  grip: 'grip',
  stretch: 'stretch',
  rest: 'idle',
};
const BODY_CN = {
  bow: '弯个腰', nod: '点点头', shake: '摇摇头', wave: '挥挥手',
  walk: '走两步',
  look_left: '往左看', look_right: '往右看', reach_left: '伸出左手',
  reach_right: '伸出右手', grip: '握一下手', stretch: '伸个懒腰', rest: '停下来',
};

export function createBrain({ rig, servos, motors, drives, memory, world, spinal, cortex, log, goals }) {
  const g = goals || createGoals({ log });

  const state = {
    t: 0,
    mood: 'calm',
    moodHold: 0,
    goal: null,
    pose: null,
    intent: defaultIntent(),
    sit: 0,
    root: { x: 0, targetX: 0 },
    walking: false,
    walkPhase: 0,
    speech: null,
    thought: '',
    lastEvent: '',
    pointer: null,
    ripples: [],
    fidget: null,
    nextFidget: 4,
    nextThink: 6,
    // 大模型点名的身体动作（只说 clip，关节依旧归身体自己）
    bodyWish: null,
    wishSeq: 0,
    talking: 0,
    lastVoiceAt: 0,
    speechSeq: 0,
    thinkSeq: 0,
    stats: { touches: 0, chats: 0 },
  };

  rig.joints.pelvis.x = 0;
  rig.joints.pelvis.y = 0;

  // ——————————————— 目标 ———————————————
  function startGoal(type, opts = {}) {
    const dur = opts.dur ?? g.durationFor(type);
    const goal = { type, t: 0, dur, phase: 0, phaseT: 0, ...opts };
    const pointer = state.pointer;

    if (type === 'wander') {
      goal.x = clamp(state.root.x + rand(-150, 150), -180, 180);
      if (Math.abs(goal.x - state.root.x) < 40) goal.x = clamp(goal.x + (goal.x > 0 ? -80 : 80), -180, 180);
    } else if (type === 'create') {
      goal.x = world.preferredSpot(clamp(state.root.x + rand(-70, 70), -190, 190));
    } else if (type === 'arrange' && world.state.objects.length) {
      const target = world.state.objects[Math.floor(Math.random() * world.state.objects.length)];
      goal.x = clamp(target.x + rand(-26, 26), -190, 190);
    } else if (type === 'approach') {
      const px = pointer && pointer.active ? pointer.x : 0;
      goal.x = clamp(px + (state.root.x < px ? -36 : 36), -190, 190);
    } else {
      goal.x = state.root.x;
    }

    state.root.targetX = goal.x;
    state.goal = goal;
    log.push({ layer: 'brain', motor: 'goal', text: `想要：${GOAL_META[type]?.label || type}` });

    if (type === 'create' && chance(0.5)) say('我想在这里放点什么。');
    else if (type === 'approach' && chance(0.5)) say(cortex.choose('arrive'));
    else if (type === 'rest' && chance(0.6)) say(cortex.choose('tired'));
  }

  function setPhase(phase) {
    if (!state.goal) return;
    state.goal.phase = phase;
    state.goal.phaseT = state.goal.t;
  }

  function nextGoal(force) {
    const ctx = {
      pointer: state.pointer && state.pointer.active,
      hasWorld: world.state.objects.length > 0,
      canCreate: drives.v.curiosity > 0.3,
    };
    const type = force || g.choose(drives.v, ctx);
    startGoal(type);
  }

  function spawnSomething() {
    const kind = pick(['flower', 'flower', 'flower', 'grass', 'grass', 'stone', 'lamp', 'tree']);
    const obj = world.plant(world.preferredSpot(state.root.x + 24), kind);
    const label = world.KINDS[kind]?.label || '东西';
    memory.counts.create = (memory.counts.create || 0) + 1;
    memory.add(`种下了${label}（世界上第 ${world.state.totalCreated} 个）`, { tags: ['创造', '世界'], weight: 0.65 });
    drives.satisfy('curiosity', 0.34);
    setMood('happy', 5);
    say(cortex.choose('created'));
    state.lastEvent = `种下了一个${label}`;
    state.ripples.push({ x: obj.x, y: 84, t: 0, life: 1.8, kind: 'create' });
  }

  function updateGoal(dt) {
    const goal = state.goal;
    if (!goal) return;
    goal.t += dt;
    const phaseAge = goal.t - goal.phaseT;

    switch (goal.type) {
      case 'idle':
      case 'observe':
        if (goal.t > goal.dur) nextGoal();
        break;

      case 'wander':
        if (Math.abs(state.root.x - goal.x) < 4) {
          if (goal.t > goal.dur) nextGoal();
        } else if (goal.t > 26) {
          nextGoal();
        }
        break;

      case 'approach':
        if (goal.t > goal.dur) {
          nextGoal(chance(0.5) ? 'observe' : 'idle');
        }
        break;

      case 'rest':
        if ((drives.v.energy < 0.16 || goal.t > goal.dur) && !goal.standing) {
          goal.standing = true;
          setMood('calm', 2);
        }
        if (goal.standing && (goal.t > goal.dur + 1.6 || drives.v.energy < 0.06)) nextGoal('idle');
        break;

      case 'create':
        if (goal.phase === 0) {
          if (Math.abs(state.root.x - goal.x) < 5 || goal.t > 9) setPhase(1);
        } else if (goal.phase === 1) {
          if (!goal.spawned && phaseAge > 1.15) {
            goal.spawned = true;
            spawnSomething();
          }
          if (phaseAge > 3.4) setPhase(2);
        } else if (goal.t - goal.phaseT > 3.4) {
          nextGoal(chance(0.6) ? 'idle' : 'wander');
        }
        break;

      case 'arrange':
        if (goal.phase === 0) {
          if (Math.abs(state.root.x - goal.x) < 6 || goal.t > 9) setPhase(1);
        } else if (goal.phase === 1) {
          if (!goal.arranged && phaseAge > 1) {
            goal.arranged = true;
            const res = world.arrange();
            if (res) {
              memory.add('把世界里的东西重新摆了一下。', { tags: ['世界', '秩序'], weight: 0.4 });
              say(cortex.choose('arrange'));
              setMood('calm', 3);
            }
          }
          if (phaseAge > 3) nextGoal('idle');
        }
        break;

      default:
        if (goal.t > goal.dur) nextGoal();
    }
  }

  // ——————————————— 移动 ———————————————
  function updateMovement(dt) {
    const speed = 34;
    const dx = state.root.targetX - state.root.x;
    if (Math.abs(dx) > 1.2 && state.sit < 0.3) {
      state.root.x += clamp(dx, -speed * dt, speed * dt);
      state.walking = true;
      state.walkPhase += dt * (8 * clamp(Math.abs(dx) / 30 + 0.45, 0.45, 1.2));
      state.root.x = clamp(state.root.x, -195, 195);
    } else {
      state.walking = false;
    }
  }

  // ——————————————— 意图 ———————————————
  function composeIntent(dt, input) {
    const it = state.intent;
    const goal = state.goal;
    const pointer = state.pointer;

    it.handL = 'idle';
    it.handR = 'idle';
    it.footL = 'idle';
    it.footR = 'idle';
    it.reach = null;
    it.reachPoint = null;
    it.wave = null;

    // 注视：优先看你的手指；否则自己东看西看
    if (pointer && pointer.active) {
      it.lookAt = { x: pointer.x, y: pointer.y };
    } else {
      const head = state.pose?.get('head') || { x: 0, y: -70 };
      it.lookAt = {
        x: head.x + Math.sin(state.t * 0.33) * 70 + noise1(state.t * 0.17, 5) * 26,
        y: -18 + Math.cos(state.t * 0.23) * 14,
      };
    }

    switch (goal.type) {
      case 'rest':
        it.lookAt = { x: state.root.x, y: 140 };
        break;

      case 'approach': {
        const px = pointer && pointer.active ? pointer.x : 0;
        it.lookAt = { x: px, y: pointer && pointer.active ? pointer.y : -60 };
        if (Math.abs(state.root.x - px) < 70) {
          it.wave = chance(0.55) ? 'R' : null;
          if (it.wave) it.handR = 'wave';
          else it.handR = 'open';
        }
        break;
      }

      case 'observe':
        if (pointer && pointer.active) it.lookAt = { x: pointer.x, y: pointer.y };
        break;

      case 'create':
        if (goal.phase === 1) {
          it.handR = 'press';
          it.reach = 'R';
          it.reachPoint = { x: state.root.x + 26, y: -8 };
          it.lookAt = { x: state.root.x + 26, y: 4 };
        } else if (goal.phase === 2 && goal.spawned) {
          it.handR = 'open';
          it.lookAt = { x: state.root.x + 30, y: 60 };
        }
        break;

      case 'arrange':
        if (goal.phase === 1) {
          it.handR = 'press';
          it.reach = 'R';
          it.reachPoint = { x: state.root.x + 19, y: 10 };
        }
        break;
    }

    // 小动作：发呆的时候，她会自己玩手指、点脚趾
    if (goal.type === 'idle' || goal.type === 'observe' || goal.type === 'rest' || goal.type === 'wander') {
      if (state.t > state.nextFidget) {
        state.nextFidget = state.t + rand(2.5, 8);
        state.fidget = {
          until: state.t + rand(1.0, 2.8),
          part: pick(['handL', 'handR', 'footL', 'footR']),
          gesture: pick(['open', 'fist', 'point', 'curl', 'tap', 'spread', 'tap']),
        };
      }
      if (state.fidget && state.t < state.fidget.until) {
        const isHand = state.fidget.part.startsWith('hand');
        it[state.fidget.part] = isHand
          ? state.fidget.gesture === 'curl' || state.fidget.gesture === 'tap'
            ? 'fist'
            : state.fidget.gesture
          : state.fidget.gesture === 'open' || state.fidget.gesture === 'fist' || state.fidget.gesture === 'point'
            ? 'spread'
            : state.fidget.gesture;
        if (isHand && chance(dt * 0.4)) {
          log.push({
            layer: 'motor',
            motor: `${state.fidget.part === 'handL' ? 'hand.L' : 'hand.R'}`,
            text: `闲着 → 自己动了一下（${state.fidget.gesture}）`,
          });
        }
      } else {
        state.fidget = null;
      }
    }
  }

  // ——————————————— 情绪 ———————————————
  function baseMood() {
    const d = drives.v;
    if (d.energy > 0.78) return 'sleepy';
    if (d.social > 0.72 || d.comfort > 0.66) return 'sad';
    if (d.curiosity > 0.62) return 'curious';
    if (d.arousal > 0.45) return 'shy';
    return 'calm';
  }

  function setMood(mood, hold = 3) {
    state.mood = mood;
    state.moodHold = hold;
  }

  // ——————————————— 说话 ———————————————
  function say(text, ms) {
    if (!text) return;
    const now = Date.now();
    const dur = ms ?? clamp(1900 + text.length * 120, 2400, 12000);
    state.speech = { text, at: now, until: now + dur, id: ++state.speechSeq };
    state.lastVoiceAt = now;
  }

  function buildPayload(extra = {}) {
    const sum = memory.summary();
    const counts = sum.counts;
    return {
      drives: drives.v,
      pose: state.sit > 0.5 ? '坐着' : state.walking ? '走着' : '站着',
      goal: GOAL_META[state.goal?.type]?.label || '发呆',
      mood: state.mood,
      world: `${world.state.objects.length} 个东西（${Object.entries(world.summary().counts)
        .map(([k, n]) => `${world.KINDS[k]?.label || k}×${n}`)
        .join('、') || '空'}）`,
      memory: [sum.facts, sum.recent].filter(Boolean).join('\n'),
      lastEvent: state.lastEvent,
      ...extra,
    };
  }

  async function requestLLM(extra = {}, opts = {}) {
    if (!cortex.shouldUseLLM()) return null;
    const seq = ++state.thinkSeq;
    const res = await cortex.askLLM(buildPayload(extra));
    if (!res || seq !== state.thinkSeq) return null;
    setMood(res.mood || 'calm', 5);
    state.thought = res.thought || '';
    if (!opts.silent) say(res.say);
    if (res.intent && res.intent !== 'idle' && state.goal?.type === 'idle') {
      startGoal(['create', 'wander', 'approach', 'observe', 'rest'].includes(res.intent) ? res.intent : 'idle');
    }
    // 身体：模型说「抬一下手」，身体就真的抬手 —— 但只需照做，不需要知道关节怎么算
    if (res.body && res.body !== 'none' && BODY_CLIP[res.body]) {
      state.bodyWish = { clip: BODY_CLIP[res.body], id: ++state.wishSeq, label: res.body, at: Date.now() };
      log.push({ layer: 'cortex', motor: 'body', text: `大模型：让身体「${BODY_CN[res.body]}」` });
    }
    return res;
  }

  function updateSpeech(dt) {
    state.talking = Math.max(0, state.talking - dt);
    state.nextThink -= dt;
    if (state.nextThink > 0) return;
    state.nextThink = rand(24, 58) * (drives.v.social > 0.65 ? 0.65 : 1);
    const now = Date.now();
    if (state.speech && now < state.speech.until) return;
    if (state.mood === 'sleepy' && state.sit > 0.5) return;
    if (cortex.shouldUseLLM()) {
      requestLLM();
      return;
    }
    const r = cortex.autonomous({ drives: drives.v, mood: state.mood, goal: state.goal?.type });
    setMood(r.mood, 6);
    say(r.say);
  }

  function maybeNoticeGrowth(dt) {
    if (state.t < 6) return;
    for (const o of world.state.objects) {
      if (o.noticed) continue;
      const gr = world.growth(o);
      if (gr > 0.55) {
        o.noticed = true;
        memory.add(`看着一个${world.KINDS[o.kind]?.label || '东西'}长大了。`, { tags: ['世界', '时间'], weight: 0.35 });
        if (chance(0.55) && (!state.speech || Date.now() > state.speech.until)) say(cortex.choose('admire'));
      }
    }
  }

  // ——————————————— 主循环 ———————————————
  function tick(dt, input = {}) {
    state.t += dt;
    state.pointer = input.pointer || null;
    const night = timeOfDay() === 'night';

    if (!state.goal) startGoal('idle', { dur: 12 });

    drives.tick(dt, {
      night,
      resting: state.goal.type === 'rest',
      creating: state.goal.type === 'create',
      talking: state.talking > 0,
      petting: Boolean(input.petting),
    });

    updateGoal(dt);
    updateMovement(dt);

    const wantSit = state.goal.type === 'rest' ? 1 : state.goal.type === 'create' && state.goal.phase === 1 ? 0.16 : 0;
    state.sit = damp(state.sit, wantSit, 1.6, dt);

    spinal.tick(dt, { drives: drives.v, mood: state.mood });
    const posture = spinal.posture;
    posture.sit = state.sit;
    posture.walking = state.walking;
    posture.walkPhase = state.walkPhase;
    if (state.sit > 0.6 && state.mood === 'sleepy') posture.blink = Math.max(posture.blink, 0.7);

    state.moodHold -= dt;
    if (state.moodHold <= 0) state.mood = baseMood();
    motors.parts.face.setMood(state.mood);

    composeIntent(dt, input);

    const bob = state.walking ? -Math.abs(Math.sin(state.walkPhase * 2)) * 1.7 : 0;
    rig.joints.pelvis.x = state.root.x;
    rig.joints.pelvis.y = 34 * state.sit + bob;

    const pose = solvePose(rig);
    state.pose = pose;

    motors.tick(dt, {
      intent: state.intent,
      posture,
      pose,
      gaze: state.intent.lookAt,
      time: state.t,
      speed: state.walking ? 34 : 0,
      walking: state.walking,
    });

    servos.tick(dt);
    solvePose(rig, pose);

    for (const r of state.ripples) r.t += dt;
    state.ripples = state.ripples.filter((r) => r.t < r.life);

    updateSpeech(dt);
    maybeNoticeGrowth(dt);
  }

  // ——————————————— 外部事件 ———————————————
  function onTouch(part, kind = 'poke', worldPoint) {
    const label = PART_LABEL[part] || '身体';
    const now = Date.now();
    state.stats.touches++;
    memory.counts.touch = (memory.counts.touch || 0) + 1;
    if (worldPoint) state.ripples.push({ x: worldPoint.x, y: worldPoint.y, t: 0, life: 1.2, kind });

    if (kind === 'pet') {
      drives.satisfy('comfort', 0.16);
      drives.satisfy('social', 0.1);
      drives.excite('arousal', 0.1);
      setMood('shy', 3);
      state.lastEvent = `他摸了摸我的${label}`;
      memory.add(`他摸了摸我的${label}`, { tags: ['触碰', '温柔'], weight: 0.45 });
      if (now - state.lastVoiceAt > 5000) say(cortex.choose('pet'));
      return;
    }

    drives.excite('arousal', 0.24);
    drives.satisfy('social', 0.1);

    spinal.flinch(part === 'pelvis' ? 0.9 : 0.5);
    state.lastEvent = `他戳了我的${label}`;
    memory.add(`他戳了我的${label}`, { tags: ['触碰'], weight: 0.3 });

    if (part === 'head') {
      motors.parts.face.startle();
      setMood('startled', 1.3);
      say(pick(['唔。', '别戳脸。', '头发要乱了。']));
    } else if (part === 'handL' || part === 'handR') {
      motors.parts[part].poke();
      setMood('shy', 2.4);
      if (now - state.lastVoiceAt > 4000) say(cortex.choose('touch_hand'));
    } else if (part === 'footL' || part === 'footR') {
      motors.parts[part].tickle();
      setMood('shy', 2.4);
      if (now - state.lastVoiceAt > 4000) say(cortex.choose('touch_foot'));
    } else if (part === 'chest' || part === 'pelvis') {
      setMood('shy', 3);
      if (now - state.lastVoiceAt > 4000) say(cortex.choose('touch_body'));
    } else {
      setMood('startled', 1.2);
    }
  }

  async function respond(text) {
    state.stats.chats++;
    state.talking = 2.5;
    memory.counts.chat = (memory.counts.chat || 0) + 1;
    memory.add(`他说：${text}`, { tags: ['对话', '用户'], weight: 0.75 });
    state.lastEvent = `他刚刚对我说：${text}`;
    drives.satisfy('social', 0.34);
    drives.satisfy('comfort', 0.12);

    const nameMatch = String(text).match(/(?:我叫|我是)\s*([\u4e00-\u9fa5A-Za-z]{1,10})/);
    if (nameMatch) memory.fact('他的名字', nameMatch[1], 0.9);
    const likeMatch = String(text).match(/我(喜欢|讨厌|爱|害怕)(.{1,12})/);
    if (likeMatch) memory.fact(likeMatch[1], likeMatch[2], 0.65);

    // 先把「他要我做的动作」接住：这一条不走网络，所以一定会执行
    const cmd = BODY_WORDS.find(([re]) => re.test(String(text)));
    if (cmd) {
      state.bodyWish = { clip: BODY_CLIP[cmd[1]], id: ++state.wishSeq, label: cmd[1], at: Date.now() };
      log.push({ layer: 'cortex', motor: 'body', text: `他说「${text}」→ 身体：${BODY_CN[cmd[1]] || cmd[1]}` });
    }

    const local = cortex.localReply(text, { drives: drives.v });
    setMood('curious', 2);

    if (!cortex.shouldUseLLM()) {
      await wait(rand(420, 1100));
      setMood(local.mood, 5);
      say(local.say);
      return local;
    }

    // 远端模型可能要几十秒才回 —— 不能让她干等着不说话。
    // 1.8 秒内没回，就先用本地心智回一句；模型回来了照样接管情绪和动作。
    const pending = requestLLM({ userText: text }, { silent: true });
    const quick = await Promise.race([pending, wait(1800).then(() => null)]);
    if (quick) {
      setMood(quick.mood || 'calm', 5);
      say(quick.say);
      return quick;
    }
    setMood(local.mood, 5);
    say(local.say);
    pending.catch(() => {});
    return local;
  }

  function greetReturn(offlineMs, note) {
    if (offlineMs < 45 * 1000) return;
    const line = cortex.choose('greet_return', { dur: fmtDuration(offlineMs) });
    say(note ? `${note} ${line}` : line, 7000);
    setMood(offlineMs > 3600000 * 6 ? 'sad' : 'happy', 6);
    memory.lastSeen = Date.now();
  }

  function forceGoal(type, opts) {
    if (GOAL_META[type]) startGoal(type, opts);
  }

  return {
    state,
    tick,
    say,
    setMood,
    onTouch,
    respond,
    greetReturn,
    forceGoal,
    get goalLabel() {
      return GOAL_META[state.goal?.type]?.label || '发呆';
    },
  };
}
