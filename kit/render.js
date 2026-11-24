// セロガキ動画レンダラー
// 使い方: node render.js episode.json voiceDir out.mp4 [--thumb out.png] [--still t out.png]
// episode.json の scenes / lines だけで1本が組めるようにしてある(毎回コードを書かない)
const { createCanvas } = require('@napi-rs/canvas');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const W = 1080, H = 1920, FPS = 30;
const C = {
  bg: '#07080b', white: '#f4f1ea', gray: '#7d828c', dim: '#3a3e46',
  amber: '#ffb54a', amberGlow: 'rgba(255,170,60,0.9)', blue: '#4ea6ff', blueGlow: 'rgba(70,150,255,0.9)',
};
const FONT = '"Noto Sans CJK JP"';

const [, , epPath, voiceDir, outPath, ...rest] = process.argv;
const ep = JSON.parse(fs.readFileSync(epPath, 'utf8'));
const timing = JSON.parse(fs.readFileSync(path.join(voiceDir, 'timing.json'), 'utf8'));
const TOTAL = timing.total;

// 各行のタイミングを episode の lines に結びつけ、シーンの開始・終了を行から決める
const L = ep.lines.map((l, i) => ({ ...l, s: timing.lines[i].s, e: timing.lines[i].e }));
const scenes = ep.scenes.map((sc, i) => {
  const ls = L.filter(l => l.scene === i);
  return { ...sc, s: ls.length ? ls[0].s : 0, e: ls.length ? ls[ls.length - 1].e : 0 };
});
scenes.forEach((sc, i) => { sc.s = i === 0 ? 0 : sc.s - 0.15; sc.e = i === scenes.length - 1 ? TOTAL : scenes[i + 1].s - 0.15; });

const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const lerp = (a, b, t) => a + (b - a) * t;

// ---------- 棒人間 ----------
// 関節は腰を原点にした座標(上がマイナス)。頭は head、半径は32
const POSES = {
  stand:   { neck: [0, -110], head: [0, -150], lE: [-26, -70], lH: [-32, -24], rE: [26, -70], rH: [32, -24], lK: [-14, 55], lF: [-22, 110], rK: [14, 55], rF: [22, 110] },
  armsup:  { neck: [0, -112], head: [0, -154], lE: [-42, -150], lH: [-62, -196], rE: [42, -150], rH: [62, -196], lK: [-14, 55], lF: [-24, 110], rK: [14, 55], rF: [24, 110] },
  phone:   { neck: [4, -108], head: [12, -144], lE: [-22, -68], lH: [-28, -24], rE: [30, -64], rH: [22, -98], lK: [-14, 55], lF: [-22, 110], rK: [14, 55], rF: [22, 110] },
  curtain: { neck: [0, -110], head: [-4, -150], lE: [-26, -70], lH: [-32, -24], rE: [52, -116], rH: [92, -150], lK: [-14, 55], lF: [-22, 110], rK: [14, 55], rF: [22, 110] },
  sit:     { neck: [0, -110], head: [0, -150], lE: [-10, -66], lH: [30, -48], rE: [14, -66], rH: [44, -52], lK: [58, -4], lF: [58, 56], rK: [62, 0], rF: [64, 58] },
  sitphone:{ neck: [8, -106], head: [20, -140], lE: [4, -62], lH: [40, -84], rE: [18, -62], rH: [48, -88], lK: [58, -4], lF: [58, 56], rK: [62, 0], rF: [64, 58] },
  read:    { neck: [0, -110], head: [6, -148], lE: [6, -62], lH: [46, -78], rE: [18, -62], rH: [56, -78], lK: [58, -4], lF: [58, 56], rK: [62, 0], rF: [64, 58] },
  drink:   { neck: [0, -110], head: [0, -150], lE: [-26, -70], lH: [-32, -24], rE: [30, -82], rH: [14, -128], lK: [-14, 55], lF: [-22, 110], rK: [14, 55], rF: [22, 110] },
  slump:   { neck: [14, -100], head: [30, -132], lE: [-6, -60], lH: [-12, -16], rE: [30, -60], rH: [34, -16], lK: [-12, 55], lF: [-20, 110], rK: [14, 55], rF: [22, 110] },
};
function walkPose(t, speed = 1) {
  const p = Math.sin(t * 7 * speed), q = Math.cos(t * 7 * speed);
  return { neck: [2, -110], head: [4, -150], lE: [-18 * p, -70], lH: [-30 * p, -26], rE: [18 * p, -70], rH: [30 * p, -26],
    lK: [24 * p, 52], lF: [40 * p, 108 - Math.max(0, q) * 12], rK: [-24 * p, 52], rF: [-40 * p, 108 - Math.max(0, -q) * 12] };
}
function mixPose(a, b, t) { const o = {}; for (const k in a) o[k] = [lerp(a[k][0], b[k][0], t), lerp(a[k][1], b[k][1], t)]; return o; }

function drawFig(ctx, x, y, s, pose, style, rot = 0) {
  const glow = style === 'sero';
  const col = glow ? C.white : C.gray;
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(s, s);
  ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 11; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (glow) { ctx.shadowColor = C.amberGlow; ctx.shadowBlur = 38; }
  const seg = (...pts) => { ctx.beginPath(); ctx.moveTo(...pts[0]); pts.slice(1).forEach(p => ctx.lineTo(...p)); ctx.stroke(); };
  const P = pose;
  seg([0, 0], P.neck);
  seg(P.neck, P.lE, P.lH); seg(P.neck, P.rE, P.rH);
  seg([0, 0], P.lK, P.lF); seg([0, 0], P.rK, P.rF);
  ctx.beginPath(); ctx.arc(P.head[0], P.head[1], 32, 0, Math.PI * 2); ctx.fill();
  if (glow) { ctx.shadowBlur = 70; ctx.beginPath(); ctx.arc(P.head[0], P.head[1], 32, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
  return P;
}
// 手の位置(ワールド座標)
const handAt = (x, y, s, P, which = 'rH', rot = 0) => {
  const [hx, hy] = P[which]; const c = Math.cos(rot), sn = Math.sin(rot);
  return [x + (hx * c - hy * sn) * s, y + (hx * sn + hy * c) * s];
};

// ---------- 小道具 ----------
function phone(ctx, x, y, s, a = 1) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s); ctx.globalAlpha = a;
  ctx.shadowColor = C.blueGlow; ctx.shadowBlur = 50; ctx.fillStyle = '#9fd0ff';
  ctx.beginPath(); ctx.roundRect(-14, -24, 28, 48, 6); ctx.fill();
  ctx.globalAlpha = 0.18 * a; ctx.fillStyle = C.blue; ctx.beginPath(); ctx.arc(0, 0, 140, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
function bed(ctx, x, y, s, glowSide) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  ctx.strokeStyle = glowSide ? '#6b5a44' : C.dim; ctx.lineWidth = 8; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-190, 0); ctx.lineTo(190, 0); ctx.moveTo(-190, -70); ctx.lineTo(-190, 40); ctx.moveTo(190, -20); ctx.lineTo(190, 40); ctx.stroke();
  ctx.beginPath(); ctx.roundRect(-176, -36, 70, 30, 12); ctx.stroke();
  ctx.restore();
}
function sofa(ctx, x, y, s) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s); ctx.strokeStyle = C.dim; ctx.lineWidth = 8; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-90, -120); ctx.lineTo(-90, 10); ctx.lineTo(130, 10); ctx.moveTo(-90, 10); ctx.lineTo(-90, 60); ctx.moveTo(130, 10); ctx.lineTo(130, 60); ctx.stroke();
  ctx.restore();
}
function windowSun(ctx, x, y, s, open, t) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  // 差しこむ光
  const g = ctx.createLinearGradient(0, -260, 0, 300);
  g.addColorStop(0, `rgba(255,190,90,${0.45 * open})`); g.addColorStop(1, 'rgba(255,170,60,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(-90, -250); ctx.lineTo(90, -250); ctx.lineTo(230, 330); ctx.lineTo(-230, 330); ctx.fill();
  ctx.strokeStyle = '#6b5a44'; ctx.lineWidth = 7; ctx.strokeRect(-100, -260, 200, 230);
  ctx.shadowColor = C.amberGlow; ctx.shadowBlur = 60 * open; ctx.fillStyle = `rgba(255,200,110,${0.9 * open})`;
  ctx.beginPath(); ctx.arc(0, -150, 40 + 4 * Math.sin(t * 2), 0, Math.PI * 2); ctx.fill();
  // カーテン
  ctx.shadowBlur = 0; ctx.fillStyle = '#2a2420';
  const cw = lerp(100, 18, open);
  ctx.fillRect(-100, -260, cw, 230); ctx.fillRect(100 - cw, -260, cw, 230);
  ctx.restore();
}
function sunOutside(ctx, x, y, s, t) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  ctx.shadowColor = C.amberGlow; ctx.shadowBlur = 90; ctx.fillStyle = C.amber;
  ctx.beginPath(); ctx.arc(0, 0, 60 + 3 * Math.sin(t * 2), 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0; ctx.strokeStyle = 'rgba(255,181,74,0.5)'; ctx.lineWidth = 6; ctx.lineCap = 'round';
  for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2 + t * 0.3; ctx.beginPath(); ctx.moveTo(Math.cos(a) * 85, Math.sin(a) * 85); ctx.lineTo(Math.cos(a) * 115, Math.sin(a) * 115); ctx.stroke(); }
  ctx.restore();
}
function book(ctx, x, y, s) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s); ctx.fillStyle = '#e8d9bb'; ctx.shadowColor = C.amberGlow; ctx.shadowBlur = 20;
  ctx.beginPath(); ctx.moveTo(-34, -20); ctx.lineTo(0, -12); ctx.lineTo(34, -20); ctx.lineTo(34, 18); ctx.lineTo(0, 26); ctx.lineTo(-34, 18); ctx.fill(); ctx.restore();
}
function cup(ctx, x, y, s, steam, t) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s); ctx.fillStyle = C.white; ctx.shadowColor = C.amberGlow; ctx.shadowBlur = 20;
  ctx.beginPath(); ctx.roundRect(-14, -18, 28, 34, 5); ctx.fill();
  if (steam) { ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 3; for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(i * 8, -24); ctx.quadraticCurveTo(i * 8 + 6 * Math.sin(t * 3 + i), -38, i * 8, -52); ctx.stroke(); } }
  ctx.restore();
}
function zzz(ctx, x, y, t, col) {
  ctx.save(); ctx.fillStyle = col; ctx.font = `bold 44px ${FONT}`;
  for (let i = 0; i < 3; i++) { const p = (t * 0.6 + i / 3) % 1; ctx.globalAlpha = Math.sin(p * Math.PI); ctx.fillText('z', x + p * 50, y - p * 90); }
  ctx.restore();
}

// ---------- 演技(pose名で呼ぶ) ----------
// side: 'dopa' | 'sero'、cx: 中心x、t: シーン内の経過秒
const FLOOR = 1290;
function act(ctx, name, side, cx, t, T) {
  const s = 1.35;
  const k = clamp(t / 0.8);
  switch (name) {
    case 'phone_bed': case 'phone_lie': {
      bed(ctx, cx, FLOOR - 40, 1.0, false);
      const rot = -Math.PI / 2; const P = mixPose(POSES.stand, POSES.phone, 1);
      drawFig(ctx, cx + 30, FLOOR - 95, 1.05, P, side, rot);
      const [hx, hy] = handAt(cx + 30, FLOOR - 95, 1.05, P, 'rH', rot);
      phone(ctx, hx, hy - 10, 1.0, 0.8 + 0.2 * Math.sin(t * 9)); break;
    }
    case 'sleep': {
      bed(ctx, cx, FLOOR - 40, 1.0, side === 'sero');
      drawFig(ctx, cx + 30, FLOOR - 95, 1.05, POSES.stand, side, -Math.PI / 2);
      zzz(ctx, cx - 130, FLOOR - 190, t, side === 'sero' ? C.amber : C.gray); break;
    }
    case 'awake': {
      bed(ctx, cx, FLOOR - 40, 1.0, false);
      const wob = Math.sin(t * 5) * 0.06;
      drawFig(ctx, cx + 30, FLOOR - 95, 1.05, POSES.stand, side, -Math.PI / 2 + wob);
      ctx.save(); ctx.fillStyle = C.gray; ctx.font = `900 64px ${FONT}`; ctx.globalAlpha = 0.6 + 0.4 * Math.sin(t * 4); ctx.fillText('…', cx - 150, FLOOR - 200); ctx.restore(); break;
    }
    case 'phone_stand': {
      const P = POSES.phone; drawFig(ctx, cx, FLOOR - 150, s, P, side);
      const [hx, hy] = handAt(cx, FLOOR - 150, s, P); phone(ctx, hx, hy, 1.1, 0.85 + 0.15 * Math.sin(t * 9)); break;
    }
    case 'phone_sofa': {
      sofa(ctx, cx - 10, FLOOR - 70, 1.2);
      const P = POSES.sitphone; drawFig(ctx, cx - 70, FLOOR - 82, s, P, side);
      const [hx, hy] = handAt(cx - 70, FLOOR - 82, s, P); phone(ctx, hx + 8, hy - 6, 1.0, 0.85 + 0.15 * Math.sin(t * 9)); break;
    }
    case 'curtain_sun': {
      windowSun(ctx, cx + 60, FLOOR - 360, 1.0, ease(clamp(t / 1.6)), t);
      const P = mixPose(POSES.curtain, POSES.armsup, ease(clamp((t - 1.8) / 0.8)));
      drawFig(ctx, cx - 40, FLOOR - 150, s, P, side); break;
    }
    case 'sun_stretch': {
      sunOutside(ctx, cx + 130, FLOOR - 520, 0.9, t);
      const P = mixPose(POSES.stand, POSES.armsup, ease(clamp(t / 0.9)));
      drawFig(ctx, cx, FLOOR - 150, s, P, side); break;
    }
    case 'walk': {
      sunOutside(ctx, cx + 150, FLOOR - 540, 0.7, t);
      const P = walkPose(t); const bob = Math.abs(Math.sin(t * 7)) * -6;
      drawFig(ctx, cx, FLOOR - 150 + bob, s, P, side);
      // 流れる地面
      ctx.save(); ctx.strokeStyle = side === 'sero' ? 'rgba(255,181,74,0.35)' : C.dim; ctx.lineWidth = 4;
      for (let i = 0; i < 6; i++) { const xx = cx - 230 + ((i * 90 - t * 160) % 540 + 540) % 540 * 0.85; ctx.beginPath(); ctx.moveTo(xx, FLOOR + 14); ctx.lineTo(xx + 36, FLOOR + 14); ctx.stroke(); }
      ctx.restore(); break;
    }
    case 'read': {
      sofa(ctx, cx - 10, FLOOR - 70, 1.2);
      const P = POSES.read; drawFig(ctx, cx - 70, FLOOR - 82, s, P, side);
      const [hx, hy] = handAt(cx - 70, FLOOR - 82, s, P); book(ctx, hx - 4, hy - 4, 1.2); break;
    }
    case 'drink': {
      const P = mixPose(POSES.stand, POSES.drink, ease(clamp(t / 0.7)));
      drawFig(ctx, cx, FLOOR - 150, s, P, side);
      const [hx, hy] = handAt(cx, FLOOR - 150, s, P); cup(ctx, hx + 8, hy, 1.2, true, t); break;
    }
    case 'slump': {
      drawFig(ctx, cx, FLOOR - 150, s, POSES.slump, side);
      ctx.save(); ctx.fillStyle = C.gray; ctx.font = `900 56px ${FONT}`; ctx.globalAlpha = 0.7; ctx.fillText('…', cx + 40, FLOOR - 400); ctx.restore(); break;
    }
    case 'cheer': {
      const P = mixPose(POSES.stand, POSES.armsup, 0.5 + 0.5 * Math.sin(t * 6));
      drawFig(ctx, cx, FLOOR - 150 - Math.abs(Math.sin(t * 6)) * 14, s, P, side); break;
    }
    default: drawFig(ctx, cx, FLOOR - 150, s, POSES.stand, side);
  }
}

// ---------- 画面の部品 ----------
function floorLine(ctx, a) {
  const g = ctx.createLinearGradient(0, 0, W, 0);
  g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, `rgba(255,255,255,${0.18 * a})`); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(60, FLOOR + 28, W - 120, 3);
}
function reflect(ctx, canvas) {
  // 床への映り込み
  ctx.save(); ctx.globalAlpha = 0.14; ctx.translate(0, (FLOOR + 30) * 2); ctx.scale(1, -1);
  ctx.drawImage(canvas, 0, FLOOR - 340, W, 340, 0, FLOOR - 340, W, 340); ctx.restore();
  const g = ctx.createLinearGradient(0, FLOOR + 30, 0, FLOOR + 380); g.addColorStop(0, 'rgba(7,8,11,0)'); g.addColorStop(1, C.bg);
  ctx.fillStyle = g; ctx.fillRect(0, FLOOR + 30, W, 350);
}
function wrapText(ctx, text, maxW) {
  const out = []; let cur = '';
  const NOHEAD = '、。，．？！」』）〕ー…っゃゅょァィゥェォッャュョ';
  for (const ch of text) {
    if (ctx.measureText(cur + ch).width > maxW && cur && !NOHEAD.includes(ch)) {
      // 最後の読点の後ろで切れるならそこで切る(短すぎない場合)
      const k = cur.lastIndexOf('、');
      if (k > cur.length * 0.5 && k < cur.length - 1) { out.push(cur.slice(0, k + 1)); cur = cur.slice(k + 1) + ch; }
      else { out.push(cur); cur = ch; }
    } else cur += ch;
  }
  if (cur) out.push(cur);
  // 最後の行が1〜2文字だけにならないようにする
  if (out.length > 1 && [...out[out.length - 1]].length <= 2) { const p = [...out[out.length - 2]]; out[out.length - 1] = p.splice(-4).join('') + out[out.length - 1]; out[out.length - 2] = p.join(''); }
  return out;
}
// 文字列中のキーワードを色付けして描く
function richText(ctx, text, hl, x, y, size, maxW, align = 'center') {
  ctx.font = `900 ${size}px ${FONT}`;
  const lines = text.split('\n').flatMap(t => wrapText(ctx, t, maxW));
  lines.forEach((ln, li) => {
    // 色区間を作る
    const cols = [...ln].map(() => C.white);
    (hl || []).forEach(h => { let i = ln.indexOf(h.w); while (i >= 0) { for (let j = 0; j < h.w.length; j++) cols[i + j] = C[h.c] || h.c; i = ln.indexOf(h.w, i + 1); } });
    const tw = ctx.measureText(ln).width; let xx = align === 'center' ? x - tw / 2 : x;
    const yy = y + li * size * 1.32;
    [...ln].forEach((ch, i) => {
      ctx.fillStyle = cols[i];
      ctx.shadowColor = cols[i] === C.amber ? C.amberGlow : cols[i] === C.blue ? C.blueGlow : 'rgba(0,0,0,0)';
      ctx.shadowBlur = cols[i] === C.white ? 0 : 18;
      ctx.fillText(ch, xx, yy); xx += ctx.measureText(ch).width;
    });
  });
  ctx.shadowBlur = 0;
  return lines.length;
}
function header(ctx, t, na = 1) {
  // 上:問い
  ctx.textBaseline = 'alphabetic';
  richText(ctx, ep.question, ep.questionHl, W / 2, 300, 64, 980);
  // カウンター
  const cn = ep.counters; if (!cn) return;
  const [a, b] = cn.window || [0, TOTAL * 0.55];
  const k = ease(clamp((t - a) / (b - a)));
  [['left', 270, C.blue, 'dopa'], ['right', 810, C.amber, 'sero']].forEach(([key, x, col]) => {
    const c = cn[key]; if (!c) return;
    const v = Math.round(lerp(c.from, c.to, k));
    ctx.textAlign = 'center';
    ctx.fillStyle = C.gray; ctx.font = `700 36px ${FONT}`; ctx.fillText(c.label, x, 410);
    ctx.fillStyle = col; ctx.shadowColor = col === C.amber ? C.amberGlow : C.blueGlow; ctx.shadowBlur = 26;
    ctx.font = `900 92px ${FONT}`;
    const num = c.format === 'comma' ? v.toLocaleString('en-US') : String(v);
    const nw = ctx.measureText(num).width; ctx.font = `800 40px ${FONT}`; const uw = ctx.measureText(c.unit).width;
    const sx = x - (nw + uw + 8) / 2;
    ctx.textAlign = 'left'; ctx.font = `900 92px ${FONT}`; ctx.fillText(num, sx, 510);
    ctx.font = `800 40px ${FONT}`; ctx.fillText(c.unit, sx + nw + 8, 510); ctx.shadowBlur = 0;
  });
  ctx.textAlign = 'left';
  // 名前ラベル(比較シーンだけ)
  ctx.globalAlpha = na; ctx.font = `800 34px ${FONT}`; ctx.textAlign = 'center';
  ctx.fillStyle = C.gray; ctx.fillText('ドパガキ', 270, 600);
  ctx.fillStyle = C.amber; ctx.shadowColor = C.amberGlow; ctx.shadowBlur = 16; ctx.fillText('セロガキ', 810, 600); ctx.shadowBlur = 0;
  ctx.textAlign = 'left'; ctx.globalAlpha = 1;
}
function subtitle(ctx, t) {
  const l = L.find(l => t >= l.s - 0.05 && t <= l.e + 0.25); if (!l) return;
  const a = clamp((t - l.s + 0.05) / 0.12) * clamp((l.e + 0.25 - t) / 0.12);
  ctx.save(); ctx.globalAlpha = a; ctx.textBaseline = 'alphabetic';
  ctx.shadowColor = 'rgba(0,0,0,0.9)';
  richText(ctx, l.sub || l.text, l.hl, W / 2, 1500, 52, 960);
  ctx.restore();
}

// ---------- シーン ----------
function sceneCompare(ctx, sc, t, T, canvas) {
  ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 2; ctx.setLineDash([6, 14]);
  ctx.beginPath(); ctx.moveTo(540, 660); ctx.lineTo(540, FLOOR + 20); ctx.stroke(); ctx.restore();
  act(ctx, sc.left, 'dopa', 270, t, T);
  act(ctx, sc.right, 'sero', 810, t, T);
  floorLine(ctx, 1); reflect(ctx, canvas);
}
function sceneStat(ctx, sc, t) {
  // 大きな数字(カウントアップ)+下で棒人間が演技。説明文は出さない(字幕と重複させない)
  const k = ease(clamp((t - 0.2) / 1.1));
  const v = lerp(sc.from ?? 0, sc.to, k);
  const txt = (sc.prefix || '') + (sc.decimals ? v.toFixed(sc.decimals) : Math.round(v)) + (sc.suffix || '');
  const col = C[sc.color || 'amber'];
  ctx.textAlign = 'center'; ctx.fillStyle = col; ctx.shadowColor = col === C.blue ? C.blueGlow : C.amberGlow; ctx.shadowBlur = 50;
  ctx.font = `900 200px ${FONT}`; ctx.fillText(txt, W / 2, 860 + (1 - clamp(t / 0.4)) * 40);
  ctx.shadowBlur = 0; ctx.textAlign = 'left';
  act(ctx, sc.act || 'cheer', sc.color === 'blue' ? 'dopa' : 'sero', W / 2, t, 0);
}
function sceneWeek(ctx, sc, t) {
  // 1週間(月〜日)の棒が1日ずつ伸び、合計がカウントアップする
  const days = ['月', '火', '水', '木', '金', '土', '日'];
  const per = sc.perDay, maxV = sc.max || per * 1.6;
  const base = 1240, hMax = 380, bw = 96, gap = 128, x0 = W / 2 - gap * 3;
  let total = 0;
  days.forEach((d, i) => {
    const k = ease(clamp((t - 0.2 - i * 0.28) / 0.45));
    total += per * k;
    const x = x0 + i * gap, h = hMax * per / maxV * k;
    ctx.fillStyle = C.dim; ctx.beginPath(); ctx.roundRect(x - bw / 2, base - hMax, bw, hMax, 12); ctx.globalAlpha = 0.25; ctx.fill(); ctx.globalAlpha = 1;
    ctx.fillStyle = C.amber; ctx.shadowColor = C.amberGlow; ctx.shadowBlur = 24 * k;
    ctx.beginPath(); ctx.roundRect(x - bw / 2, base - h, bw, Math.max(h, 0.1), 12); ctx.fill(); ctx.shadowBlur = 0;
    // 小さな歩く棒人間がその日の棒の上に乗る
    if (k > 0.05) { ctx.save(); ctx.globalAlpha = k; drawFig(ctx, x, base - h - 48, 0.3, walkPose(t + i), 'sero'); ctx.restore(); }
    ctx.fillStyle = C.gray; ctx.font = `700 36px ${FONT}`; ctx.textAlign = 'center'; ctx.fillText(d, x, base + 56);
    if (k > 0.6) { ctx.globalAlpha = clamp((k - 0.6) / 0.4); ctx.fillStyle = C.white; ctx.font = `800 32px ${FONT}`; ctx.fillText(`${per}分`, x, base - h - 110); ctx.globalAlpha = 1; }
  });
  // 合計
  const done = total >= per * 7 - 0.01;
  const tot = done ? (sc.total ?? per * 7) : Math.min(sc.total ?? per * 7, Math.round(total));
  ctx.textAlign = 'center'; ctx.fillStyle = C.amber; ctx.shadowColor = C.amberGlow; ctx.shadowBlur = 40;
  ctx.font = `900 120px ${FONT}`; ctx.fillText(`${sc.totalPrefix ?? '合計'} ${tot}分`, W / 2, 780); ctx.shadowBlur = 0; ctx.textAlign = 'left';
}
function sceneCrowd(ctx, sc, t) {
  // たくさんの人(研究の対象人数)が集まってくる+人数のカウンター
  const cols = 14, rows = 6, sx = 66, sy = 78, x0 = W / 2 - sx * (cols - 1) / 2, y0 = 840;
  const rng = (i) => (Math.sin(i * 12.9898) * 43758.5453) % 1;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = r * cols + c; const d = Math.abs(rng(i)) * 1.2;
    const a = clamp((t - 0.15 - d) / 0.3); if (a <= 0) continue;
    const glow = sc.glowFrac && Math.abs(rng(i + 99)) < sc.glowFrac && t > (sc.glowAt ?? 99);
    ctx.save(); ctx.globalAlpha = a; drawFig(ctx, x0 + c * sx, y0 + r * sy + 40, 0.24, POSES.stand, glow ? 'sero' : 'dopa'); ctx.restore();
  }
  const k = ease(clamp((t - 0.1) / 1.4));
  const n = Math.round(lerp(0, sc.to, k));
  ctx.textAlign = 'center'; ctx.fillStyle = C.white; ctx.font = `900 110px ${FONT}`; ctx.shadowColor = C.amberGlow; ctx.shadowBlur = 20;
  ctx.fillText((sc.prefix || '') + n.toLocaleString('en-US') + (sc.suffix || '人'), W / 2, 780); ctx.shadowBlur = 0; ctx.textAlign = 'left';
}
function sceneBars(ctx, sc, t) {
  // 2本の縦棒で比較
  const items = sc.items; const maxV = Math.max(...items.map(i => i.value));
  const base = 1240, hMax = 520, bw = 170;
  items.forEach((it, i) => {
    const x = items.length === 2 ? [330, 750][i] : 200 + i * (680 / (items.length - 1));
    const k = ease(clamp((t - 0.2 - i * 0.35) / 0.9));
    const h = hMax * it.value / maxV * k; const col = C[it.color] || C.white;
    ctx.fillStyle = col; ctx.shadowColor = col === C.amber ? C.amberGlow : col === C.blue ? C.blueGlow : 'rgba(0,0,0,0)'; ctx.shadowBlur = 30;
    ctx.beginPath(); ctx.roundRect(x - bw / 2, base - h, bw, h, 14); ctx.fill(); ctx.shadowBlur = 0;
    ctx.textAlign = 'center'; ctx.fillStyle = col; ctx.font = `900 64px ${FONT}`;
    ctx.globalAlpha = clamp((k - 0.6) / 0.4); ctx.fillText(it.valueText || String(it.value), x, base - h - 30); ctx.globalAlpha = 1;
    ctx.fillStyle = C.white; ctx.font = `800 40px ${FONT}`; ctx.fillText(it.label, x, base + 64);
  });
  ctx.textAlign = 'left';
  if (sc.title) richText(ctx, sc.title, sc.titleHl, W / 2, 680, 50, 920);
  if (sc.source) { ctx.fillStyle = C.gray; ctx.globalAlpha = 0.55; ctx.font = `500 30px ${FONT}`; ctx.textAlign = 'center'; ctx.fillText(sc.source, W / 2, 1385); ctx.globalAlpha = 1; ctx.textAlign = 'left'; }
}
function sceneChart(ctx, sc, t) {
  // 右肩上がり/下がりの折れ線
  const x0 = 170, x1 = 930, y0 = 1220, y1 = 760;
  ctx.strokeStyle = C.dim; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(x0, y1 - 20); ctx.lineTo(x0, y0); ctx.lineTo(x1 + 20, y0); ctx.stroke();
  ctx.fillStyle = C.gray; ctx.font = `700 34px ${FONT}`; ctx.textAlign = 'center'; ctx.fillText(sc.xlabel || '', (x0 + x1) / 2, y0 + 105);
  ctx.save(); ctx.translate(x0 - 50, (y0 + y1) / 2); ctx.rotate(-Math.PI / 2); ctx.fillText(sc.ylabel || '', 0, 0); ctx.restore();
  const pts = sc.points; const k = ease(clamp((t - 0.2) / 1.6));
  const n = pts.length - 1; const upto = k * n;
  const col = C[sc.color || 'amber'];
  ctx.strokeStyle = col; ctx.lineWidth = 9; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.shadowColor = col === C.blue ? C.blueGlow : C.amberGlow; ctx.shadowBlur = 30;
  ctx.beginPath();
  for (let i = 0; i <= Math.floor(upto); i++) { const X = lerp(x0, x1, i / n), Y = lerp(y0, y1, pts[i]); i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); }
  if (upto < n) { const i = Math.floor(upto), f = upto - i; ctx.lineTo(lerp(x0, x1, (i + f) / n), lerp(y0, y1, lerp(pts[i], pts[i + 1], f))); }
  ctx.stroke(); ctx.shadowBlur = 0; ctx.textAlign = 'left';
  // 先頭の光る点
  { const i = Math.min(Math.floor(upto), n - 1), f = upto - i; const X = lerp(x0, x1, (i + f) / n), Y = lerp(y0, y1, lerp(pts[i], pts[Math.min(i + 1, n)], f));
    ctx.fillStyle = C.white; ctx.shadowColor = C.amberGlow; ctx.shadowBlur = 40; ctx.beginPath(); ctx.arc(X, Y, 14, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0; }
  // 目盛り
  (sc.ticks || []).forEach(tk => { const X = lerp(x0, x1, tk.x); ctx.fillStyle = C.gray; ctx.font = `700 32px ${FONT}`; ctx.textAlign = 'center'; ctx.fillText(tk.label, X, y0 + 44); });
  // しきい値の縦線
  if (sc.marker) { const X = lerp(x0, x1, sc.marker.x); const a = clamp((upto / n - sc.marker.x) / 0.08);
    ctx.save(); ctx.globalAlpha = a; ctx.strokeStyle = C.amber; ctx.lineWidth = 4; ctx.setLineDash([12, 12]); ctx.beginPath(); ctx.moveTo(X, y0); ctx.lineTo(X, y1 - 40); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = C.amber; ctx.shadowColor = C.amberGlow; ctx.shadowBlur = 24; ctx.font = `900 64px ${FONT}`; ctx.textAlign = 'center'; ctx.fillText(sc.marker.label, X, y1 - 70); ctx.restore(); }
  ctx.textAlign = 'left';
  if (sc.source) { ctx.fillStyle = C.gray; ctx.globalAlpha = 0.5; ctx.font = `500 28px ${FONT}`; ctx.textAlign = 'center'; ctx.fillText(sc.source, W / 2, 1385); ctx.globalAlpha = 1; ctx.textAlign = 'left'; }
}
function sceneTips(ctx, sc, t) {
  // 今日からできること(順に出る)
  richText(ctx, sc.title || '今日からできること', [{ w: sc.title || '今日からできること', c: 'amber' }], W / 2, 740, 56, 920);
  sc.items.forEach((it, i) => {
    const a = clamp((t - 0.3 - i * 0.6) / 0.35); ctx.save(); ctx.globalAlpha = a;
    const y = 880 + i * 130;
    ctx.fillStyle = C.amber; ctx.shadowColor = C.amberGlow; ctx.shadowBlur = 20; ctx.beginPath(); ctx.arc(170, y - 16, 14, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
    richText(ctx, it, sc.hl, 210, y, 46, 760, 'left'); ctx.restore();
  });
}
const SCENES = { compare: sceneCompare, stat: sceneStat, bars: sceneBars, chart: sceneChart, tips: sceneTips, week: sceneWeek, crowd: sceneCrowd };

const canvas = createCanvas(W, H); const ctx = canvas.getContext('2d');
const layer = createCanvas(W, H); const lctx = layer.getContext('2d');
function frame(t) {
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
  // 中央にうっすら光
  const g = ctx.createRadialGradient(W * 0.75, 1000, 50, W * 0.75, 1000, 700); g.addColorStop(0, 'rgba(255,170,60,0.07)'); g.addColorStop(1, 'rgba(255,170,60,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const na = scenes.reduce((m, sc) => sc.type === 'compare' ? Math.max(m, clamp((t - sc.s + 0.3) / 0.3) * clamp((sc.e + 0.3 - t) / 0.3)) : m, 0);
  header(ctx, t, na);
  scenes.forEach(sc => {
    if (t < sc.s - 0.3 || t > sc.e + 0.3) return;
    const a = clamp((t - sc.s + 0.3) / 0.3) * clamp((sc.e + 0.3 - t) / 0.3);
    lctx.clearRect(0, 0, W, H);
    lctx.save(); SCENES[sc.type](lctx, sc, Math.max(0, t - sc.s), sc.e - sc.s, layer); lctx.restore();
    ctx.globalAlpha = a; ctx.drawImage(layer, 0, 0); ctx.globalAlpha = 1;
  });
  subtitle(ctx, t);
}

function thumb(file) {
  const tt = ep.thumb?.t ?? 1.2;
  // 字幕なしで描く
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
  header(ctx, ep.thumb?.counterT ?? TOTAL * 0.6);
  const sc = scenes.find(s => s.type === 'compare') || scenes[0];
  lctx.clearRect(0, 0, W, H); SCENES[sc.type](lctx, sc, tt, sc.e - sc.s, layer); ctx.drawImage(layer, 0, 0);
  // 大見出し(問いの代わりに上へ)
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, 560);
  const n = (ep.thumb.title.match(/\n/g) || []).length + 1;
  richText(ctx, ep.thumb.title, ep.thumb.hl, W / 2, 360 - (n - 1) * 60 + (n === 1 ? 20 : 0), 112, 1000);
  ctx.fillStyle = 'rgba(7,8,11,0.85)'; ctx.fillRect(0, 1400, W, 300);
  if (ep.thumb.sub) richText(ctx, ep.thumb.sub, ep.thumb.subHl, W / 2, 1520, 58, 940);
  fs.writeFileSync(file, canvas.toBuffer('image/png'));
}

(async () => {
  const ti = rest.indexOf('--still');
  if (ti >= 0) { frame(parseFloat(rest[ti + 1])); fs.writeFileSync(rest[ti + 2], canvas.toBuffer('image/png')); return; }
  const th = rest.indexOf('--thumb');
  if (th >= 0) thumb(rest[th + 1]);
  if (rest.includes('--thumb-only')) return;
  const ff = spawn('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', String(FPS), '-i', '-',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', outPath], { stdio: ['pipe', 'inherit', 'inherit'] });
  const N = Math.ceil(TOTAL * FPS);
  for (let i = 0; i < N; i++) {
    frame(i / FPS);
    const buf = canvas.data();
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
  }
  ff.stdin.end(); await new Promise(r => ff.on('close', r));
  console.log('video', N, 'frames');
})();
