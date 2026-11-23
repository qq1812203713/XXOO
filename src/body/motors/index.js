// 运动程序注册表：每一块身体都有自己的脚本，彼此不知道对方存在。
// 大脑只跟这张表打交道（手势、姿势、注视），永远不直接写关节。
import { createHand } from './hand.js';
import { createFoot } from './foot.js';
import { createTorso } from './torso.js';
import { createArm } from './arm.js';
import { createLeg } from './leg.js';
import { createFace } from './face.js';

export function createMotors({ rig, servos, log }) {
  const parts = {
    torso: createTorso({ rig, servos }),
    legL: createLeg('L', { rig, servos }),
    legR: createLeg('R', { rig, servos }),
    armL: createArm('L', { rig, servos, log }),
    armR: createArm('R', { rig, servos, log }),
    handL: createHand('L', { rig, servos, log }),
    handR: createHand('R', { rig, servos, log }),
    footL: createFoot('L', { rig, servos, log }),
    footR: createFoot('R', { rig, servos, log }),
    face: createFace({ log }),
  };

  function tick(dt, ctx) {
    // 顺序 = 层级：躯干撑起骨架，四肢挂在上面，手足最后细化
    parts.torso.tick(dt, ctx);
    parts.legL.tick(dt, ctx);
    parts.legR.tick(dt, ctx);
    parts.armL.tick(dt, ctx);
    parts.armR.tick(dt, ctx);
    parts.handL.tick(dt, ctx);
    parts.handR.tick(dt, ctx);
    parts.footL.tick(dt, ctx);
    parts.footR.tick(dt, ctx);
    parts.face.tick(dt, ctx);
  }

  function reflex(part, kind = 'poke') {
    if ((part === 'handL' || part === 'handR') && kind === 'poke') parts[part].poke();
    else if ((part === 'footL' || part === 'footR') && kind === 'tickle') parts[part].tickle();
  }

  return { parts, tick, reflex };
}
