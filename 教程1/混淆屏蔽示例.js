/*
 * ============================================================================
 *  混淆屏蔽示例.js —— 前端「防查看源码 / 防调试」通用借鉴脚本
 * ============================================================================
 *
 *  目的：把这套「混淆 + 屏蔽守卫」的思路固化成一份能反复参考、能直接跑的样板，
 *        以后在任意项目里想让访客「难以获取前端逻辑、难以随手调试」时，照着改即可。
 *
 *  ---------------------------------------------------------------------------
 *  【核心思维：三层防护，各司其职】
 *  ---------------------------------------------------------------------------
 *   第 1 层  混淆内联 JS   —— 用 javascript-obfuscator 把可读脚本变成乱码
 *                             （字符串进 base64 数组、变量名变 _0x1a2b、控制流平坦化）
 *                             收益：别人即使拿到源码，也看不懂逻辑与常量。
 *   第 2 层  注入 __u 守卫  —— 一段拦截脚本，屏蔽 F12 / Ctrl+U / Ctrl+Shift+I·J·C / 右键，
 *                             并用「Alt+Shift+D 连按 5 次」作为临时解锁手势（本会话有效）。
 *                             收益：挡住手滑查看与初级调试；需要调试时按 5 次放行。
 *   第 3 层  剥离 CSS 注释  —— 删掉 style 块内的 CSS 注释（斜杠星号…星号斜杠 那种），避免设计意图随成品泄露。
 *
 *  ---------------------------------------------------------------------------
 *  【两种落地场景，按需选用】
 *  ---------------------------------------------------------------------------
 *   场景 A（纯静态 HTML 整站）：本脚本默认流程 —— 读明文 HTML → 三层处理 → 写安全版 HTML。
 *        典型：单页工具、生成器、离线分发页。维护铁律：只改「明文版」，安全版靠脚本重生成，
 *              切勿手改安全版（混淆态无法逐行编辑）。
 *   场景 B（服务端渲染，如 PHP）：页面 HTML 由服务器拼装，无法整站预混淆；
 *        只能把「守卫」这一层单独混淆后注入模板的 <head>（照片博客即此法）。
 *        做法见文末 obfuscateGuardOnly()，用 node 跑一次拿到乱码串，替换进模板即可。
 *
 *  ---------------------------------------------------------------------------
 *  【必须清醒认识的局限（防君子不防专业）】
 *  ---------------------------------------------------------------------------
 *   - 服务端渲染 / 任何需要在浏览器显示的内容，curl、禁用 JS、另存为、看缓存 都能拿到 HTML；
 *     屏蔽 Ctrl+U 只挡「浏览器里的手滑」。混淆只让逻辑难读，挡不住数据本身。
 *   - 真正的敏感数据必须留在服务端、靠鉴权保护，绝不能只靠前端混淆/守卫。
 *   - 守卫的解锁手势（Alt+Shift+D×5）务必藏进混淆——明文写出来就等于没锁。
 *
 *  ---------------------------------------------------------------------------
 *  【依赖】javascript-obfuscator（无需本目录新装，可复用任意项目已装好的那份）
 *  ---------------------------------------------------------------------------
 *   脚本会在下方 OBFUSCATOR_CANDIDATES 里自动找一个能 require 到的安装位置；
 *   找不到时，把某项目 node_modules/javascript-obfuscator 的绝对路径加进候选，或直接改 OBFUSCATOR_PATH。
 *
 *  【用法】
 *   场景 A： node 混淆屏蔽示例.js  输入明文.html  输出安全版.html
 *   场景 B： node 混淆屏蔽示例.js  --guard-only        （打印混淆后的守卫串，供注入模板）
 *   不带参数：打印本说明。
 * ============================================================================
 */

'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* ------------------------------------------------------------------ *
 * 0) 定位 javascript-obfuscator（跨项目复用最省事的一步）
 * ------------------------------------------------------------------ */
// 候选绝对路径：命中第一个即用。新项目把你自己环境里的路径补进来即可。
const OBFUSCATOR_CANDIDATES = [
  process.env.OBFUSCATOR_PATH,                                   // 允许用环境变量最高优先覆盖
  'D:/记事本/libu.653827.xyz/baoge_libu_t21_safe/node_modules/javascript-obfuscator',
  path.resolve(__dirname, 'node_modules/javascript-obfuscator'), // 本目录若已 npm i 也能用
];
function resolveObfuscator() {
  for (const p of OBFUSCATOR_CANDIDATES) {
    if (!p) continue;
    try { return require(p); } catch (_) { /* 试下一个 */ }
  }
  throw new Error(
    '找不到 javascript-obfuscator。请 npm i javascript-obfuscator，' +
    '或把某项目里 node_modules/javascript-obfuscator 的绝对路径加入 OBFUSCATOR_CANDIDATES。'
  );
}
const Obfuscator = resolveObfuscator();

/* ------------------------------------------------------------------ *
 * 1) 混淆参数（Tier2 稳妥档：够乱、够稳、不反噬调试）
 * ------------------------------------------------------------------ */
const opts = {
  compact: true,                       // 压成一行
  identifierNamesGenerator: 'hexadecimal', // 变量名 → _0x1a2b 这类十六进制，去语义
  renameGlobals: false,                // 不改全局名，避免误伤 document/window 等宿主对象
  stringArray: true,                   // 字符串集中进数组
  stringArrayEncoding: ['base64'],     // 数组内 base64 编码 → 'F12'/'keydown' 等不再明文可见
  stringArrayThreshold: 0.85,          // 多大比例字符串进数组（0.8~1 都行）
  rotateStringArray: true,             // 数组顺序打乱，增加静态阅读难度
  controlFlowFlattening: false,        // 关掉：更乱但体积/性能代价大，一般场景不必
  deadCodeInjection: false,            // 关掉：注入死代码会显著变大，收益有限
  selfDefending: false,                // ★关掉：开了会反调试，和「Alt+Shift+D×5 临时解锁」初衷冲突
  debugProtection: false,              // ★关掉：开了会死命拦 devtools，连作者自己都难调试
  disableConsoleOutput: false,         // 保留 console，方便解锁后调试
  unicodeEscapeSequence: false,        // 不必逐字符 unicode 转义，base64 已足够
  simplify: true,
  seed: 20261017,                      // 固定种子：同样输入产出稳定，便于比对/回归
};

/* ------------------------------------------------------------------ *
 * 2) __u 守卫源码（可维护的明文版；混淆后注入，运行时行为=屏蔽+解锁）
 *    拦截：F12 / Ctrl+U(查看源码) / Ctrl+Shift+I·J·C(devtools) / 右键(智能放行)
 *    解锁：Alt+Shift+D 连按 5 次（3 秒窗口内累计），本会话有效
 * ------------------------------------------------------------------ */
const GUARD_SRC = [
  "(function(){",
  "var unlocked=false,comboCount=0,lastComboTime=0;",
  "document.addEventListener('keydown',function(e){",
  // 解锁手势：Alt+Shift+D，3 秒内累计满 5 次放行
  "if(e.altKey&&e.shiftKey&&(e.key==='D'||e.key==='d'||e.keyCode===68)){",
  "var now=Date.now();if(now-lastComboTime>3000)comboCount=0;",
  "comboCount++;lastComboTime=now;",
  "if(comboCount>=5){unlocked=true;comboCount=0;try{console.log('[devtools unlocked for this session]');}catch(_){}}",
  "e.preventDefault();return false;",
  "}",
  "if(unlocked)return;",                      // 已解锁则不再拦截
  "var k=e.key||'',kc=e.keyCode||0;",
  "if(k==='F12'||kc===123){e.preventDefault();return false;}",
  "if((e.ctrlKey||e.metaKey)&&!e.shiftKey&&(k==='u'||k==='U'||kc===85)){e.preventDefault();return false;}", // Ctrl+U
  "if((e.ctrlKey||e.metaKey)&&e.shiftKey){var kk=(k||'').toLowerCase();if(kk==='i'||kk==='j'||kk==='c'){e.preventDefault();return false;}}", // Ctrl+Shift+I/J/C
  "},true);",
  // 右键：选中文字、或落在 INPUT/TEXTAREA/A/IMG/CANVAS/可编辑区 → 放行；否则屏蔽
  "document.addEventListener('contextmenu',function(e){",
  "if(unlocked)return;",
  "var sel=null;try{sel=window.getSelection&&window.getSelection();}catch(_){}",
  "if(sel&&sel.toString().length>0)return;",
  "var t=e.target;",
  "while(t&&t!==document.body&&t!==document.documentElement){",
  "var tag=(t.tagName||'').toUpperCase();",
  "if(tag==='INPUT'||tag==='TEXTAREA'||tag==='A'||tag==='IMG'||tag==='CANVAS')return;",
  "if(t.isContentEditable)return;",
  "t=t.parentElement;",
  "}",
  "e.preventDefault();return false;",
  "},false);",
  "})();"
].join('');

/* ------------------------------------------------------------------ *
 * 3) 通用小工具
 * ------------------------------------------------------------------ */
// 内联进 HTML 时把 </script 转义为 <\/script，防止字符串里出现 </script> 提前闭合标签（对 JS 无副作用）
function escapeForInlineHtml(code) {
  return code.replace(/<\/script/gi, '<\\/script');
}
// 混淆一段 JS 并用 vm.Script 做语法自检（抛错即失败，避免产出坏代码）
function obfuscateAndCheck(code, label) {
  const out = Obfuscator.obfuscate(code, opts).getObfuscatedCode();
  new vm.Script(out, { filename: label || 'obf' });
  return out;
}
// 剥离 CSS 注释
function stripCssComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/* ------------------------------------------------------------------ *
 * 场景 A：整站 HTML 三层处理
 * ------------------------------------------------------------------ */
function buildHtml(SRC, DEST) {
  if (!fs.existsSync(SRC)) { console.error('找不到明文源文件: ' + SRC); process.exit(1); }
  let html = fs.readFileSync(SRC, 'utf8');
  const before = html.length;

  // ① 剥 CSS 注释（仅 <style> 块内）
  let cssBlocks = 0;
  html = html.replace(/<style(\s[^>]*)?>([\s\S]*?)<\/style>/gi, function (m, attr, body) {
    cssBlocks++;
    return '<style' + (attr || '') + '>' + stripCssComments(body) + '</style>';
  });

  // ② 混淆内联 <script>（裸标签、无 src、且不是已注入的 __u 守卫）
  let inlineCount = 0;
  html = html.replace(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi, function (m, attr, body) {
    if (body.trim().length === 0) return m;                 // 空标签跳过
    if (/\ssrc\s*=/.test(attr || '')) return m;             // 带 src 的第三方脚本不动
    if (/id\s*=\s*["']?__u["']?/i.test(attr || '')) return m; // 已是守卫，别二次混淆
    let out;
    try {
      out = obfuscateAndCheck(body, 'inline#' + (++inlineCount));
    } catch (e) {
      console.error('  [错误] 内联脚本混淆/自检失败: ' + e.message.split('\n')[0] + ' —— 保留原文');
      inlineCount--;
      return m;
    }
    return '<script' + (attr || '') + '>\n' + escapeForInlineHtml(out) + '\n</script>';
  });

  // ③ 注入 __u 守卫到 <head> 之后（守卫本身也先混淆）
  const guardTag = '  <script id="__u">' + escapeForInlineHtml(obfuscateAndCheck(GUARD_SRC, 'guard')) + '</script>';
  let guardInjected = 0;
  html = html.replace(/([ \t]*<head>[^\n]*\n)/i, function (m) { guardInjected++; return m + guardTag + '\n'; });

  fs.writeFileSync(DEST, html, 'utf8');
  console.log('HTML 安全版构建完成：');
  console.log('  明文 ' + before + ' 字符 → 安全版 ' + html.length + ' 字符');
  console.log('  剥 CSS 注释 ' + cssBlocks + ' 块，混淆内联脚本 ' + inlineCount + ' 段，注入守卫 ' + guardInjected + ' 处（应=1）');
  console.log('  产物: ' + DEST);
}

/* ------------------------------------------------------------------ *
 * 场景 B：服务端渲染（PHP 等）——只混淆守卫，打印出来供你贴进模板 <head>
 *    拿到输出串后，替换模板里 <script id="__u">…</script> 的内容即可（照片博客即此法）。
 * ------------------------------------------------------------------ */
function obfuscateGuardOnly() {
  const out = escapeForInlineHtml(obfuscateAndCheck(GUARD_SRC, 'guard'));
  console.log('—— 复制下面整串，替换进模板的 <script id="__u">HERE</script> ——\n');
  console.log(out);
  console.log('\n—— 明文守卫 ' + GUARD_SRC.length + ' 字符 → 混淆后 ' + out.length + ' 字符 ——');
}

/* ------------------------------------------------------------------ *
 * 入口分发
 * ------------------------------------------------------------------ */
const argv = process.argv.slice(2);
if (argv[0] === '--guard-only') {
  obfuscateGuardOnly();
} else if (argv.length >= 2) {
  buildHtml(path.resolve(argv[0]), path.resolve(argv[1]));
} else {
  console.log(
    '混淆屏蔽示例.js —— 用法：\n' +
    '  场景A 整站HTML：  node 混淆屏蔽示例.js  输入明文.html  输出安全版.html\n' +
    '  场景B 只混淆守卫：node 混淆屏蔽示例.js  --guard-only\n\n' +
    '思路（三层）：① 混淆内联JS  ② 注入 __u 屏蔽守卫(F12/Ctrl+U/Ctrl+Shift+I·J·C/右键，Alt+Shift+D×5 解锁)  ③ 剥 CSS 注释。\n' +
    '局限：服务端渲染/显示内容 curl、禁JS、另存为 仍可获取；混淆只让逻辑难读，敏感数据须靠服务端鉴权。'
  );
}
