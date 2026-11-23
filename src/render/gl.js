// 判断这个环境到底有没有真正可用的 WebGL。
// jsdom、老浏览器、被禁用显卡的环境都会在这里被拦下——这样上层只需要看返回值，
// 不用去 catch 一堆 three / pixi 内部的报错。
export function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl') || c.getContext('experimental-webgl');
    return !!(gl && typeof gl.createTexture === 'function' && typeof gl.createBuffer === 'function');
  } catch {
    return false;
  }
}
