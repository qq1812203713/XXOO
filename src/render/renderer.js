// 渲染：她不是一张贴图，而是一具会呼吸的骨架。
// 视觉上刻意做成“神经系统 + 半透明身体”——因为这才是这个项目真正在模拟的东西。
import { GROUND_Y } from '../body/skeleton.js';
import { clamp, damp, lerp, rand, TAU } from '../core/util.js';

const HEAD_RX = 7.0;
const HEAD_RY = 8.6;

const SKIN = { light: 'rgba(255,240,242,0.97)', mid: 'rgba(250,205,220,0.95)', dark: 'rgba(210,146,176,0.95)' };
const HAIR = { mid: 'rgba(52,26,46,0.85)', light: 'rgba(150,80,112,0.55)', edge: 'rgba(255,196,226,0.22)' };

const COLORS = {
  torso: [255, 198, 222],
  head: [255, 214, 228],
  arm: [178, 212, 255],
  hand: [160, 240, 226],
  leg: [198, 178, 255],
  foot: [152, 228, 244],
};

// 单位是「世界单位」（她身高约 150）
const BONE_W = { torso: 1.05, head: 0.95, arm: 0.66, leg: 0.84, hand: 0.6, finger: 0.28, toe: 0.3, foot: 0.6 };

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d', { alpha: false });
  let W = 1;
  let H = 1;
  let dpr = 1;
  const cam = { x: 0, scale: 3, ground: 0, targetX: 0 };
  let motes = [];
  let time = 0;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth || window.innerWidth;
    H = canvas.clientHeight || window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cam.scale = Math.min((H * 0.72) / (GROUND_Y + HEAD_RY + 66), (W * 0.9) / 96);
    cam.ground = H * 0.895;
    seedMotes();
  }

  function seedMotes() {
    motes = new Array(46).fill(0).map(() => ({
      x: rand(-260, 260),
      y: rand(-120, 70),
      r: rand(0.5, 1.8) * 0.55,
      s: rand(1, 6) * 0.55,
      a: rand(0.15, 0.6),
      ph: rand(0, TAU),
    }));
  }

  const project = (wx, wy) => ({
    x: W / 2 + (wx - cam.x) * cam.scale,
    y: cam.ground + (wy - GROUND_Y) * cam.scale,
  });

  const unproject = (sx, sy) => ({
    x: (sx - W / 2) / cam.scale + cam.x,
    y: (sy - cam.ground) / cam.scale + GROUND_Y,
  });

  // ——————————————————— 背景 ———————————————————
  function drawBackground(night, arousal) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    if (night) {
      g.addColorStop(0, '#05040b');
      g.addColorStop(0.55, '#0b0713');
      g.addColorStop(1, '#150c19');
    } else {
      g.addColorStop(0, '#0b0710');
      g.addColorStop(0.5, '#150d1b');
      g.addColorStop(1, '#1d1020');
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    const cx = W / 2;
    const cy = cam.ground - H * 0.32;
    const halo = ctx.createRadialGradient(cx, cy, 10, cx, cy, H * 0.6);
    halo.addColorStop(0, `rgba(255,150,190,${0.09 + arousal * 0.07})`);
    halo.addColorStop(0.45, 'rgba(120,90,200,0.055)');
    halo.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, W, H);
  }

  function drawGround() {
    const y = cam.ground;
    const g = ctx.createLinearGradient(0, y - 40, 0, y + 110);
    g.addColorStop(0, 'rgba(255,180,210,0.10)');
    g.addColorStop(0.3, 'rgba(150,120,220,0.05)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, y - 40, W, 150);

    ctx.strokeStyle = 'rgba(255,196,224,0.14)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();

    ctx.save();
    ctx.strokeStyle = 'rgba(190,170,255,0.055)';
    const vpX = W / 2;
    for (let i = -9; i <= 9; i++) {
      const bx = W / 2 + i * cam.scale * 22 - cam.x * cam.scale;
      ctx.beginPath();
      ctx.moveTo(lerp(bx, vpX, 0.93), y + H * 0.018);
      ctx.lineTo(bx, y);
      ctx.stroke();
    }
    for (let i = 1; i <= 5; i++) {
      const yy = y + Math.pow(i, 1.9) * 3 * (H / 700);
      ctx.globalAlpha = 0.5 / i;
      ctx.beginPath();
      ctx.moveTo(0, yy);
      ctx.lineTo(W, yy);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawMotes(dt, t) {
    for (const m of motes) {
      m.y -= m.s * dt * 0.6;
      m.x += Math.sin(t * 0.4 + m.ph) * dt * 2;
      if (m.y < -170) {
        m.y = rand(-20, 80);
        m.x = rand(-280, 280);
      }
      const p = project(m.x, m.y);
      if (p.x < -20 || p.x > W + 20) continue;
      const a = m.a * (0.6 + 0.4 * Math.sin(t * 1.3 + m.ph));
      ctx.fillStyle = `rgba(255,220,240,${a})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, m.r, 0, TAU);
      ctx.fill();
    }
  }

  // ——————————————————— 世界 ———————————————————
  function drawWorld(world, t) {
    const sorted = [...world.state.objects].sort((a, b) => a.x - b.x);
    for (const o of sorted) {
      const g = world.growth(o);
      const p = project(o.x, GROUND_Y);
      if (p.x < -70 || p.x > W + 70) continue;
      const hue = world.KINDS[o.kind]?.hue ?? 320;
      drawObject(o, g, p.x, p.y, hue, t);
    }
  }

  function drawObject(o, g, x, y, hue, t) {
    const seed = o.seed;
    const sway = Math.sin(t * 0.8 + seed * TAU) * (1.4 + g * 2);
    ctx.save();
    ctx.translate(x, y);

    ctx.fillStyle = `hsla(${hue}, 70%, 70%, 0.09)`;
    ctx.beginPath();
    ctx.ellipse(0, 0, 10 + g * 12, 2.4 + g * 2.4, 0, 0, TAU);
    ctx.fill();

    if (o.kind === 'stone') {
      const w = 6.5 * o.size;
      const grad = ctx.createLinearGradient(-w, -w, w, w);
      grad.addColorStop(0, 'rgba(215,225,255,0.55)');
      grad.addColorStop(1, 'rgba(90,100,150,0.12)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(0, -w * 0.55, w, w * 0.78, 0.2, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(230,240,255,0.25)';
      ctx.lineWidth = 0.8;
      ctx.stroke();
    } else if (o.kind === 'lamp') {
      const fy = -20 - Math.sin(t * 1.2 + seed * 6) * 4;
      const rr = 5 + Math.sin(t * 2 + seed * 3) * 1.1;
      const glow = ctx.createRadialGradient(0, fy, 1, 0, fy, rr * 6);
      glow.addColorStop(0, 'rgba(255,232,170,0.85)');
      glow.addColorStop(0.3, 'rgba(255,200,120,0.25)');
      glow.addColorStop(1, 'rgba(255,180,90,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(0, fy, rr * 6, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,248,225,0.95)';
      ctx.beginPath();
      ctx.arc(0, fy, 2.1, 0, TAU);
      ctx.fill();
    } else if (o.kind === 'tree') {
      const h = 26 + g * 50;
      ctx.strokeStyle = 'rgba(190,150,210,0.5)';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(sway * 0.4, -h * 0.5, sway, -h);
      ctx.stroke();
      const r = 7 + g * 20;
      const glow = ctx.createRadialGradient(sway, -h, 1, sway, -h, r * 2);
      glow.addColorStop(0, `hsla(${hue}, 80%, 78%, 0.45)`);
      glow.addColorStop(1, `hsla(${hue}, 80%, 60%, 0)`);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(sway, -h, r * 2, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = `hsla(${hue}, 80%, 84%, 0.5)`;
      ctx.lineWidth = 0.8;
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TAU + seed * 3;
        ctx.beginPath();
        ctx.arc(sway + Math.cos(a) * r * 0.3, -h + Math.sin(a) * r * 0.25, r * 0.45, 0, TAU);
        ctx.stroke();
      }
    } else if (o.kind === 'grass') {
      const h = 5 + g * 14;
      ctx.strokeStyle = `hsla(${hue}, 70%, 78%, 0.55)`;
      ctx.lineWidth = 1;
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(i * 1.6, 0);
        ctx.quadraticCurveTo(i * 2.6 + sway * 0.3, -h * 0.6, i * 3.2 + sway, -h * (0.8 + 0.1 * Math.abs(i)));
        ctx.stroke();
      }
    } else {
      const h = 4 + g * 24;
      ctx.strokeStyle = `hsla(${hue}, 60%, 84%, 0.4)`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(sway * 0.5, -h * 0.55, sway, -h);
      ctx.stroke();
      if (g > 0.5) {
        const petals = 6;
        const rr = 1.8 + g * 3.8;
        ctx.fillStyle = `hsla(${hue}, 90%, 84%, ${0.22 + g * 0.5})`;
        for (let i = 0; i < petals; i++) {
          const a = (i / petals) * TAU + seed * 6;
          ctx.beginPath();
          ctx.ellipse(sway + Math.cos(a) * rr * 0.9, -h + Math.sin(a) * rr * 0.9, rr * 0.6, rr * 0.32, a, 0, TAU);
          ctx.fill();
        }
        ctx.fillStyle = 'rgba(255,250,220,0.9)';
        ctx.beginPath();
        ctx.arc(sway, -h, rr * 0.3, 0, TAU);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  // ——————————————————— 身体 ———————————————————
  const line = (a, b) => {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  };

  const capsule = (a, b, w, style) => {
    ctx.strokeStyle = style;
    ctx.lineWidth = w;
    line(a, b);
  };

  function bonesOf(rig, pose) {
    const list = [];
    for (const id of rig.order) {
      if (id === 'pelvis') continue;
      const j = rig.joints[id];
      const p = pose.get(j.parent);
      const c = pose.get(id);
      if (!p || !c) continue;
      list.push({ id, j, p, c, group: j.group });
      // 末端指/趾骨没有子关节，单独补一小节，指尖才不会被截断
      if (j.tip) {
        list.push({
          id: `${id}_tip`,
          j,
          p: c,
          c: { x: c.x + c.sx * j.tip, y: c.y + c.sy * j.tip, a: c.a, sx: c.sx, sy: c.sy },
          group: j.group,
          tip: true,
        });
      }
    }
    return list;
  }

  // 连续的半透明身体：用“带宽度的折线”一次填充，而不是一节一节的胶囊
  function strip(points, halfWidths, fill, stroke, opts = {}) {
    const left = [];
    const right = [];
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const prev = points[Math.max(0, i - 1)];
      const next = points[Math.min(points.length - 1, i + 1)];
      let dx = next.x - prev.x;
      let dy = next.y - prev.y;
      const d = Math.hypot(dx, dy) || 1;
      dx /= d;
      dy /= d;
      const nx = -dy;
      const ny = dx;
      const w = halfWidths[i];
      left.push({ x: p.x + nx * w, y: p.y + ny * w });
      right.push({ x: p.x - nx * w, y: p.y - ny * w });
    }
    ctx.beginPath();
    ctx.moveTo(left[0].x, left[0].y);
    for (let i = 1; i < left.length; i++) ctx.lineTo(left[i].x, left[i].y);
    for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i].x, right[i].y);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 0.45;
      ctx.stroke();
    }
    // 两端圆头（可关闭，避免关节处出现一颗颗球）
    ctx.fillStyle = fill;
    const capStart = opts.capStart !== false;
    const capEnd = opts.capEnd !== false;
    for (const idx of [0, points.length - 1]) {
      if (idx === 0 && !capStart) continue;
      if (idx === points.length - 1 && !capEnd) continue;
      ctx.beginPath();
      ctx.arc(points[idx].x, points[idx].y, halfWidths[idx] * 0.98, 0, TAU);
      ctx.fill();
    }
  }

  function drawVolume(rig, pose) {
    const pel = pose.get('pelvis');
    const s1 = pose.get('spine1');
    const s2 = pose.get('spine2');
    const ch = pose.get('chest');
    const nk = pose.get('neck');
    const shL = pose.get('arm_L_upper');
    const shR = pose.get('arm_R_upper');
    if (!pel || !ch) return;

    const grad = ctx.createLinearGradient(-34, 0, 34, 0);
    grad.addColorStop(0, 'rgba(255,232,244,0.34)');
    grad.addColorStop(0.4, 'rgba(252,208,232,0.26)');
    grad.addColorStop(1, 'rgba(176,150,235,0.13)');
    const rim = 'rgba(255,240,250,0.18)';

    // 躯干（腰稍微收一点）+ 脖子
    strip([pel, s1, s2, ch, nk, pose.get('head')], [10.8, 9.0, 9.8, 13.2, 3.6, 3.0], grad, rim);
    // 三角肌：把手臂接在肩膀上，而不是浮着
    ctx.fillStyle = 'rgba(255,216,238,0.15)';
    for (const sh of [shL, shR]) {
      ctx.beginPath();
      ctx.arc(sh.x, sh.y + 2, 2.7, 0, TAU);
      ctx.fill();
    }

    for (const side of ['L', 'R']) {
      const sh = pose.get(`arm_${side}_upper`);
      const el = pose.get(`arm_${side}_fore`);
      const wr = pose.get(`hand_${side}`);
      const hip = pose.get(`leg_${side}_thigh`);
      const kn = pose.get(`leg_${side}_shin`);
      const an = pose.get(`foot_${side}`);

      strip([sh, el, wr], [3.2, 2.3, 1.8], grad, 'rgba(255,238,248,0.10)', { capStart: false });
      strip([hip, kn, an], [4.7, 3.4, 2.6], grad, 'rgba(255,238,248,0.10)', { capStart: false });

      // 手掌
      ctx.save();
      ctx.translate(wr.x, wr.y);
      ctx.rotate(wr.a);
      ctx.fillStyle = 'rgba(235,225,255,0.10)';
      ctx.beginPath();
      ctx.ellipse(0, 2.8, 3.4, 4.8, 0, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,240,250,0.12)';
      ctx.lineWidth = 0.4;
      ctx.stroke();
      ctx.restore();

      // 脚
      ctx.save();
      ctx.translate(an.x, an.y + 5.4);
      ctx.rotate(an.a * 0.3);
      ctx.fillStyle = 'rgba(226,222,255,0.12)';
      ctx.beginPath();
      ctx.ellipse(0, 0, 5.2, 3.4, 0, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,240,250,0.12)';
      ctx.lineWidth = 0.4;
      ctx.stroke();
      ctx.restore();
    }

    // 髋：最后画，把两条腿的接缝盖住
    ctx.fillStyle = 'rgba(255,214,236,0.11)';
    ctx.beginPath();
    ctx.ellipse(pel.x, pel.y + 1.5, 11.5, 6.6, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,240,250,0.12)';
    ctx.lineWidth = 0.4;
    ctx.stroke();
  }

  function drawNerves(bones) {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const b of bones) {
      const tiny = b.group === 'finger' || b.group === 'toe';
      ctx.strokeStyle = `rgba(${COLORS[b.group]?.[0] || 255},${COLORS[b.group]?.[1] || 210},${
        COLORS[b.group]?.[2] || 228
      },${tiny ? 0.05 : 0.04})`;
      ctx.lineWidth = (BONE_W[b.group] || 2) * 2.9;
      line(b.p, b.c);
    }
    for (const b of bones) {
      const tiny = b.group === 'finger' || b.group === 'toe';
      const c = COLORS[b.group] || COLORS.torso;
      const dim = b.group === 'head' ? 0.6 : 1;
      ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${(tiny ? 0.5 : 0.42) * dim})`;
      ctx.lineWidth = BONE_W[b.group] || 1;
      line(b.p, b.c);
    }
    for (const b of bones) {
      const tiny = b.group === 'finger' || b.group === 'toe';
      ctx.strokeStyle = `rgba(255,246,251,${tiny ? 0.34 : 0.5})`;
      ctx.lineWidth = (BONE_W[b.group] || 1) * 0.36;
      line(b.p, b.c);
    }
  }

  function drawJoints(bones) {
    for (const b of bones) {
      const tiny = b.group === 'finger' || b.group === 'toe';
      const spd = Math.min(1, Math.abs(b.j.vel) * 2.2);
      if (b.group === 'toe') continue;
      if (b.group === 'finger' && spd < 0.15) continue;
      const r = (tiny ? 0.3 : 0.6) + spd * 0.7;
      ctx.fillStyle = `rgba(255,${Math.round(232 - spd * 30)},${Math.round(242 - spd * 40)},${0.3 + spd * 0.6})`;
      ctx.beginPath();
      ctx.arc(b.c.x, b.c.y, r, 0, TAU);
      ctx.fill();
    }
  }

  // ——————————————————— 头发 ———————————————————
  function headPath() {
    ctx.beginPath();
    ctx.moveTo(-HEAD_RX, -1.4);
    ctx.bezierCurveTo(-HEAD_RX * 1.02, -HEAD_RY * 1.06, HEAD_RX * 1.02, -HEAD_RY * 1.06, HEAD_RX, -1.4);
    ctx.bezierCurveTo(HEAD_RX * 0.98, HEAD_RY * 0.7, HEAD_RX * 0.52, HEAD_RY * 1.02, 0, HEAD_RY * 1.02);
    ctx.bezierCurveTo(-HEAD_RX * 0.52, HEAD_RY * 1.02, -HEAD_RX * 0.98, HEAD_RY * 0.7, -HEAD_RX, -1.4);
    ctx.closePath();
  }

  function hairSway(t) {
    return Math.sin(t * 0.7) * 0.9 + Math.sin(t * 1.9) * 0.3;
  }

  function drawHair(pose, t, layer) {
    const h = pose.get('head');
    if (!h) return;
    const back = layer === 'back';
    const sway = hairSway(t);
    ctx.save();
    ctx.translate(h.x, h.y);
    ctx.rotate(h.a);

    if (back) {
      // 背后长发
      ctx.beginPath();
      ctx.moveTo(-HEAD_RX * 1.26, 4);
      ctx.bezierCurveTo(-HEAD_RX * 1.52, -HEAD_RY * 1.25, HEAD_RX * 1.52, -HEAD_RY * 1.25, HEAD_RX * 1.26, 4);
      ctx.bezierCurveTo(HEAD_RX * 1.35, 12, HEAD_RX * 1.05, 24 + sway * 0.6, HEAD_RX * 0.7, 26 + sway);
      ctx.quadraticCurveTo(0, 23 + sway * 0.7, -HEAD_RX * 0.7, 26 + sway);
      ctx.bezierCurveTo(-HEAD_RX * 1.05, 24 - sway * 0.6, -HEAD_RX * 1.35, 12, -HEAD_RX * 1.26, 4);
      ctx.closePath();
      ctx.fillStyle = HAIR.mid;
      ctx.fill();
      ctx.strokeStyle = HAIR.edge;
      ctx.lineWidth = 0.45;
      ctx.stroke();

      // 发丝高光
      ctx.strokeStyle = HAIR.light;
      ctx.lineWidth = 0.55;
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(i * 3.6, -HEAD_RY * 0.95);
        ctx.quadraticCurveTo(i * 5.2 + sway * 0.6, 6, i * 5.2 + sway, 24);
        ctx.stroke();
      }
    } else {
      // 刘海
      ctx.beginPath();
      ctx.moveTo(-HEAD_RX * 1.04, -4.2);
      ctx.bezierCurveTo(-HEAD_RX * 1.05, -HEAD_RY * 1.18, HEAD_RX * 1.05, -HEAD_RY * 1.18, HEAD_RX * 1.04, -4.2);
      ctx.quadraticCurveTo(HEAD_RX * 0.62, -1.8 + sway * 0.15, HEAD_RX * 0.28, -4.4);
      ctx.quadraticCurveTo(HEAD_RX * 0.02, -1.4 + sway * 0.15, -HEAD_RX * 0.34, -4.2);
      ctx.quadraticCurveTo(-HEAD_RX * 0.7, -1.8 + sway * 0.15, -HEAD_RX * 1.04, -4.2);
      ctx.closePath();
      ctx.fillStyle = HAIR.mid;
      ctx.fill();
      ctx.strokeStyle = HAIR.edge;
      ctx.lineWidth = 0.45;
      ctx.stroke();

      // 侧发
      for (const sx of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(sx * HEAD_RX * 0.98, -6);
        ctx.quadraticCurveTo(sx * (HEAD_RX * 1.25 + sway * 0.3), 0, sx * HEAD_RX * 1.06, 8.5);
        ctx.quadraticCurveTo(sx * HEAD_RX * 0.86, 2, sx * HEAD_RX * 0.8, -5);
        ctx.closePath();
        ctx.fillStyle = HAIR.mid;
        ctx.fill();
      }

      ctx.strokeStyle = 'rgba(255,214,236,0.3)';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(-HEAD_RX * 0.7, -HEAD_RY * 0.8);
      ctx.quadraticCurveTo(-HEAD_RX * 0.2, -HEAD_RY * 0.92, HEAD_RX * 0.35, -HEAD_RY * 0.74);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ——————————————————— 头与脸 ———————————————————
  function drawHead(pose) {
    const h = pose.get('head');
    if (!h) return;
    ctx.save();
    ctx.translate(h.x, h.y);
    ctx.rotate(h.a);

    // 脖子底下的暗部
    ctx.fillStyle = 'rgba(48,22,42,0.5)';
    ctx.beginPath();
    ctx.ellipse(0, HEAD_RY * 0.92, 4.4, 3.6, 0, 0, TAU);
    ctx.fill();

    headPath();
    const g = ctx.createLinearGradient(-HEAD_RX * 0.7, -HEAD_RY, HEAD_RX * 0.6, HEAD_RY);
    g.addColorStop(0, SKIN.light);
    g.addColorStop(0.5, SKIN.mid);
    g.addColorStop(1, SKIN.dark);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,240,246,0.55)';
    ctx.lineWidth = 0.5;
    ctx.stroke();

    // 脸颊的高光
    const rc = ctx.createRadialGradient(-HEAD_RX * 0.3, -HEAD_RY * 0.2, 0.5, -HEAD_RX * 0.2, 0, HEAD_RX);
    rc.addColorStop(0, 'rgba(255,255,255,0.35)');
    rc.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = rc;
    ctx.fill();

    ctx.restore();
  }

  function drawFace(rig, pose, face, mood, t) {
    const h = pose.get('head');
    if (!h) return;
    const f = face.state;
    ctx.save();
    ctx.translate(h.x, h.y);
    ctx.rotate(h.a);

    // 腮红
    if (f.blush > 0.02) {
      for (const sx of [-1, 1]) {
        const bg = ctx.createRadialGradient(sx * 5.8, 3.2, 0.3, sx * 5.8, 3.2, 4.2);
        bg.addColorStop(0, `rgba(255,110,152,${0.42 * f.blush})`);
        bg.addColorStop(1, 'rgba(255,110,152,0)');
        ctx.fillStyle = bg;
        ctx.beginPath();
        ctx.arc(sx * 5.8, 3.2, 4.2, 0, TAU);
        ctx.fill();
      }
    }

    const open = clamp(f.eyeOpen, 0, 1.3) * (1 - f.blink) * (1 - 0.5 * (f.drowsy || 0));

    for (const sx of [-1, 1]) {
      const ex = sx * 3.95;
      const ey = -1.0;
      const w = 2.25;
      const hh = Math.max(0.12, 1.55 * open);
      ctx.save();
      ctx.translate(ex, ey);
      ctx.scale(1, hh / 1.55 + 0.001);
      // 眼形
      ctx.beginPath();
      ctx.moveTo(-w, 0);
      ctx.quadraticCurveTo(0, -1.9, w, 0);
      ctx.quadraticCurveTo(0, 1.35, -w, 0);
      ctx.closePath();
      const eg = ctx.createRadialGradient(0, -0.2, 0.2, 0, 0.2, 2.4);
      eg.addColorStop(0, 'rgba(255,253,250,0.98)');
      eg.addColorStop(1, 'rgba(240,218,228,0.9)');
      ctx.fillStyle = eg;
      ctx.fill();
      ctx.restore();

      if (open > 0.18) {
        const ix = ex + f.gazeX * 0.95;
        const iy = ey + f.gazeY * 0.55;
        const ig = ctx.createRadialGradient(ix, iy - 0.4, 0.15, ix, iy, 1.35);
        ig.addColorStop(0, mood === 'shy' ? 'rgba(255,214,232,1)' : 'rgba(220,250,255,1)');
        ig.addColorStop(0.55, mood === 'shy' ? 'rgba(230,120,164,0.98)' : 'rgba(88,166,220,0.98)');
        ig.addColorStop(1, 'rgba(26,40,80,0.95)');
        ctx.fillStyle = ig;
        ctx.beginPath();
        ctx.ellipse(ix, iy, 1.22, Math.min(1.5, 1.5 * open) * f.pupil, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = 'rgba(18,10,24,0.7)';
        ctx.beginPath();
        ctx.ellipse(ix, iy, 0.55, 0.62 * open * f.pupil, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        ctx.beginPath();
        ctx.arc(ix - 0.45, iy - 0.5, 0.3, 0, TAU);
        ctx.fill();
      }

      // 上眼线
      ctx.strokeStyle = 'rgba(58,24,44,0.85)';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(ex - 2.35, ey + 0.05);
      ctx.quadraticCurveTo(ex, ey - 1.9 * open, ex + 2.35, ey + 0.05);
      ctx.stroke();
      // 眼尾
      ctx.beginPath();
      ctx.moveTo(ex + sx * 2.2, ey - 0.15);
      ctx.lineTo(ex + sx * 3.1, ey - 0.75);
      ctx.stroke();
    }

    // 眉毛
    ctx.strokeStyle = 'rgba(96,48,74,0.6)';
    ctx.lineWidth = 0.55;
    for (const sx of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(sx * 1.9, -4.9 - f.brow * 0.45);
      ctx.quadraticCurveTo(sx * 3.5, -5.4 - f.brow * 0.3, sx * 5.0, -4.6 + f.brow * 0.6);
      ctx.stroke();
    }

    // 鼻子
    ctx.strokeStyle = 'rgba(196,128,152,0.45)';
    ctx.lineWidth = 0.4;
    ctx.beginPath();
    ctx.moveTo(0.1, 2.4);
    ctx.quadraticCurveTo(0.7, 3.0, 0.15, 3.15);
    ctx.stroke();

    // 嘴
    const my = 6.0;
    const curve = f.mouth * 2.4;
    ctx.fillStyle = f.mouth > 0.5 ? 'rgba(238,120,150,0.55)' : 'rgba(214,116,140,0.4)';
    ctx.beginPath();
    ctx.moveTo(-2.2, my);
    ctx.quadraticCurveTo(0, my + curve * 0.55 - 0.7, 2.2, my);
    ctx.quadraticCurveTo(0, my + curve + 1.3, -2.2, my);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(160,70,96,0.55)';
    ctx.lineWidth = 0.35;
    ctx.stroke();

    // 下巴的阴影
    ctx.strokeStyle = 'rgba(196,120,148,0.22)';
    ctx.lineWidth = 0.4;
    ctx.beginPath();
    ctx.ellipse(0, 1, HEAD_RX * 0.66, HEAD_RY * 0.82, 0, Math.PI * 0.3, Math.PI * 0.7);
    ctx.stroke();

    ctx.restore();
  }

  // ——————————————————— 主绘制 ———————————————————
  function drawShadow(pose) {
    const pel = pose.get('pelvis');
    const sx = project(pel.x, GROUND_Y).x;
    const sph = ctx.createRadialGradient(sx, cam.ground, 2, sx, cam.ground, 70 * (cam.scale / 3));
    sph.addColorStop(0, 'rgba(8,3,14,0.62)');
    sph.addColorStop(1, 'rgba(8,3,14,0)');
    ctx.fillStyle = sph;
    ctx.beginPath();
    ctx.ellipse(sx, cam.ground + 4, 44 * (cam.scale / 3), 10 * (cam.scale / 3), 0, 0, TAU);
    ctx.fill();
  }

  function drawBody(rig, pose, face, t, mood) {
    drawVolume(rig, pose);
    const bones = bonesOf(rig, pose);

    // 心跳核心
    const chest = pose.get('chest');
    const pulse = 0.5 + 0.5 * Math.sin(t * (1.1 + face.state.blush * 0.8));
    const coreR = 5.5 + pulse * 1.8;
    const cg = ctx.createRadialGradient(chest.x, chest.y + 8, 1, chest.x, chest.y + 8, coreR * 5);
    cg.addColorStop(0, `rgba(255,190,215,${0.42 + pulse * 0.22})`);
    cg.addColorStop(0.3, 'rgba(255,140,180,0.14)');
    cg.addColorStop(1, 'rgba(255,120,170,0)');
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.arc(chest.x, chest.y + 8, coreR * 5, 0, TAU);
    ctx.fill();

    drawHair(pose, t, 'back');
    drawNerves(bones);
    drawHead(pose);
    drawFace(rig, pose, face, mood, t);
    drawHair(pose, t, 'front');
    drawJoints(bones);
  }

  function drawRipples(brain) {
    for (const r of brain.state.ripples) {
      const k = r.t / r.life;
      const p = project(r.x, r.y);
      const rad = (5 + k * 30) * (cam.scale / 3);
      ctx.strokeStyle = `rgba(255,205,230,${(1 - k) * 0.5})`;
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, rad, 0, TAU);
      ctx.stroke();
      if (r.kind === 'create') {
        ctx.fillStyle = `rgba(255,240,200,${(1 - k) * 0.55})`;
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * TAU + r.t;
          ctx.beginPath();
          ctx.arc(p.x + Math.cos(a) * rad, p.y + Math.sin(a) * rad * 0.6, 1.3, 0, TAU);
          ctx.fill();
        }
      }
    }
  }

  function draw(view, dt) {
    const { rig, brain, face, world, drives } = view;
    time += dt;
    const hour = new Date().getHours();
    const night = hour < 6 || hour > 19;

    cam.targetX = brain.state.root.x;
    cam.x = damp(cam.x, cam.targetX, 2.2, dt);

    drawBackground(night, drives.v.arousal);
    drawGround();
    drawWorld(world, time);
    drawMotes(dt, time);

    if (brain.state.pose) {
      drawShadow(brain.state.pose);
      ctx.save();
      ctx.translate(W / 2 - cam.x * cam.scale, cam.ground - GROUND_Y * cam.scale);
      ctx.scale(cam.scale, cam.scale);
      drawBody(rig, brain.state.pose, face, time, brain.state.mood);
      ctx.restore();
    }
    drawRipples(brain);

    // 地面上的反光
    const feet = project(brain.state.root.x, GROUND_Y);
    const rg = ctx.createRadialGradient(feet.x, cam.ground + 6, 2, feet.x, cam.ground + 6, 90 * (cam.scale / 3));
    rg.addColorStop(0, 'rgba(255,170,210,0.10)');
    rg.addColorStop(1, 'rgba(255,150,200,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(0, cam.ground - 10, W, H - cam.ground + 10);

    const vg = ctx.createRadialGradient(W / 2, H * 0.5, H * 0.26, W / 2, H * 0.5, H * 0.86);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
  }

  // ——————————————————— 局部检视 ———————————————————
  function drawInspector(g2, { rig, pose, side, part, width, height }) {
    g2.clearRect(0, 0, width, height);
    if (!pose) return;
    const isHand = part === 'hand';
    const ids = [];
    const boxIds = [];
    if (isHand) {
      ids.push(`hand_${side}`, `arm_${side}_fore`);
      boxIds.push(`hand_${side}`);
      for (const f of ['thumb', 'index', 'middle', 'ring', 'pinky']) {
        for (let i = 0; i < 3; i++) {
          ids.push(`${side}_${f}_${i}`);
          boxIds.push(`${side}_${f}_${i}`);
        }
      }
    } else {
      ids.push(`foot_${side}`, `leg_${side}_shin`);
      boxIds.push(`foot_${side}`);
      for (const t of ['big', 'second', 'third', 'fourth', 'little']) {
        for (let i = 0; i < 2; i++) {
          ids.push(`${side}_toe_${t}_${i}`);
          boxIds.push(`${side}_toe_${t}_${i}`);
        }
      }
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const pts = [];
    for (const id of ids) {
      const p = pose.get(id);
      if (!p) continue;
      pts.push({ id, p });
      if (!boxIds.includes(id)) continue;
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    if (!pts.length) return;
    const pad = 18;
    const s = Math.min((width - pad * 2) / Math.max(1, maxX - minX), (height - pad * 2) / Math.max(1, maxY - minY));
    const ox = width / 2 - ((minX + maxX) / 2) * s;
    const oy = height / 2 - ((minY + maxY) / 2) * s;

    g2.save();
    g2.lineCap = 'round';
    for (const { id, p } of pts) {
      const j = rig.joints[id];
      const par = pose.get(j.parent);
      if (!par) continue;
      const x1 = par.x * s + ox;
      const y1 = par.y * s + oy;
      const x2 = p.x * s + ox;
      const y2 = p.y * s + oy;
      g2.strokeStyle = 'rgba(255,196,224,0.22)';
      g2.lineWidth = 4;
      g2.beginPath();
      g2.moveTo(x1, y1);
      g2.lineTo(x2, y2);
      g2.stroke();
      g2.strokeStyle = 'rgba(255,240,250,0.8)';
      g2.lineWidth = 1;
      g2.beginPath();
      g2.moveTo(x1, y1);
      g2.lineTo(x2, y2);
      g2.stroke();
    }

    for (const { id, p } of pts) {
      const j = rig.joints[id];
      const err = Math.abs(j.target - j.local);
      const active = clamp(err * 5 + Math.abs(j.vel) * 1.2, 0, 1);
      const x = p.x * s + ox;
      const y = p.y * s + oy;
      if (active > 0.06) {
        const g = g2.createRadialGradient(x, y, 0, x, y, 8);
        g.addColorStop(0, `rgba(120,255,235,${0.42 * active})`);
        g.addColorStop(1, 'rgba(120,255,235,0)');
        g2.fillStyle = g;
        g2.beginPath();
        g2.arc(x, y, 8, 0, TAU);
        g2.fill();
      }
      g2.fillStyle = `rgba(255,255,255,${0.35 + active * 0.65})`;
      g2.beginPath();
      g2.arc(x, y, 1.3 + active * 1.5, 0, TAU);
      g2.fill();
    }
    g2.restore();
  }

  function bodyPartAt(sx, sy, pose) {
    if (!pose) return null;
    const groups = [
      ['head', ['head'], 30],
      ['chest', ['chest'], 30],
      ['pelvis', ['pelvis'], 26],
      ['handL', ['hand_L'], 22],
      ['handR', ['hand_R'], 22],
      ['footL', ['foot_L'], 20],
      ['footR', ['foot_R'], 20],
      ['armL', ['arm_L_fore', 'arm_L_upper'], 16],
      ['armR', ['arm_R_fore', 'arm_R_upper'], 16],
      ['legL', ['leg_L_shin', 'leg_L_thigh'], 18],
      ['legR', ['leg_R_shin', 'leg_R_thigh'], 18],
    ];
    let best = null;
    let bd = Infinity;
    for (const [part, ids, r] of groups) {
      for (const id of ids) {
        const p = pose.get(id);
        if (!p) continue;
        const sp = project(p.x, p.y);
        const d = Math.hypot(sp.x - sx, sp.y - sy);
        if (d < r && d < bd) {
          bd = d;
          best = part;
        }
      }
    }
    return best;
  }

  resize();
  return {
    resize,
    draw,
    drawInspector,
    project,
    unproject,
    bodyPartAt,
    cam,
    get width() {
      return W;
    },
    get height() {
      return H;
    },
  };
}
