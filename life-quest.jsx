const { useState, useEffect, useRef, useCallback } = React;

// ═══════════════════════════════════════════════════════
//  デバイス間同期（Firestore REST API・SDK不使用）
// ═══════════════════════════════════════════════════════
const FIREBASE_PROJECT_ID = "life-quest-14110";
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/synccodes`;

function generateSyncCode() {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789"; // 紛らわしい文字(0,1,i,l,o)は除外
  const part = () => Array.from({length:4}, () => chars[Math.floor(Math.random()*chars.length)]).join("");
  return `${part()}-${part()}`;
}

// Firestoreへ書き込み（ドキュメントIDは同期コードそのもの）
async function syncPush(code, dataObj) {
  const url = `${FIRESTORE_BASE}/${encodeURIComponent(code)}`;
  const body = {
    fields: {
      payload:   { stringValue: JSON.stringify(dataObj) },
      updatedAt: { stringValue: new Date().toISOString() },
    },
  };
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`sync push failed: ${res.status}`);
  return true;
}

// Firestoreから読み込み
async function syncPull(code) {
  const url = `${FIRESTORE_BASE}/${encodeURIComponent(code)}`;
  const res = await fetch(url);
  if (res.status === 404) return null; // まだ存在しないコード
  if (!res.ok) throw new Error(`sync pull failed: ${res.status}`);
  const json = await res.json();
  const payload = json.fields?.payload?.stringValue;
  if (!payload) return null;
  return { data: JSON.parse(payload), updatedAt: json.fields?.updatedAt?.stringValue ?? null };
}

// リモートの更新時刻だけを軽量取得する（プッシュ前の競合検知用）。取得できない場合はnull。
async function syncPeekUpdatedAt(code) {
  try {
    const url = `${FIRESTORE_BASE}/${encodeURIComponent(code)}?mask.fieldPaths=updatedAt`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json();
    return json.fields?.updatedAt?.stringValue ?? null;
  } catch(e) {
    return null;
  }
}

// ═══════════════════════════════════════════════════════
//  ガチャキャラクター（外部ホスティング画像・少量混入方式）
// ═══════════════════════════════════════════════════════
// 画像はJS内に埋め込まず、GitHub Pages上のURLを直接参照する。
// これによりキャラクターを何体追加してもファイルサイズがほぼ増えない。
const CHAR_IMAGE_BASE = "https://nejio.github.io/life-quest/characters/";

const CHARACTER_RARITY_INFO = {
  UR: { label:"UR", color:"#f0c060", glow:"#fbbf24", grad:"linear-gradient(135deg,#fff7e0,#ffe9a8)" },
};

// キャラクター進化の段階しきい値（プレイヤー自身のレベルに連動）
// → 装備キャラを切り替えても、現在のレベルに応じた段階がそのまま表示される
// キャラクター専用レベル（ユーザーレベルとは完全に独立）
// 短期的なモチベーション維持が目的のため、Lv10で頭打ちになる緩やかな曲線にする
const CHAR_MAX_LEVEL = 10;
const CHAR_EVOLUTION_LEVELS = [1, 4, 8]; // このキャラLvで進化（3段階）

function xpForCharLevel(lv) { return Math.floor(200 * Math.pow(1.25, lv - 1)); }
function calcCharLevel(totalXP) {
  let lv = 1, xp = totalXP;
  while (lv < CHAR_MAX_LEVEL && xp >= xpForCharLevel(lv)) { xp -= xpForCharLevel(lv); lv++; }
  const needed = lv >= CHAR_MAX_LEVEL ? 0 : xpForCharLevel(lv);
  return { lv, current: xp, needed, isMax: lv >= CHAR_MAX_LEVEL };
}

// ═══════════════════════════════════════════════════════
//  1日の記録上限（生活スケジュールから逆算・健康管理を兼ねる）
// ═══════════════════════════════════════════════════════
const DEFAULT_SCHEDULE = {
  wake: "07:00", sleep: "23:00",
  hasWork: true, workStart: "09:00", workEnd: "18:00",
  hasCommute: false, commuteMode: "transit", commuteOneWayMin: "30",
};
const LIFE_BUFFER_MIN = 120;  // 食事・身支度などで自動確保する時間（通勤は別枠で扱う）
const DAILY_CAP_MIN_FLOOR = 60;   // 上限の下限（これより下がらない）
const DAILY_CAP_MIN_CEIL  = 360;  // 上限の上限（自由時間が多くてもここで頭打ち）
const EXPLORE_DAILY_LIMIT = 3;    // 探索カテゴリの1日の回数上限
const COMMUTE_ELIGIBLE_CATS = ["study", "reading"]; // 通勤枠で記録できるカテゴリ（座ってできる活動のみ）

function timeToMinutes(t) {
  const [h, m] = (t || "00:00").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}
function calcDailyCapMinutes(schedule) {
  const s = schedule || DEFAULT_SCHEDULE;
  const wake = timeToMinutes(s.wake);
  let sleep = timeToMinutes(s.sleep);
  if (sleep <= wake) sleep += 24 * 60; // 日付をまたぐ場合
  let awake = sleep - wake;
  if (s.hasWork) {
    let ws = timeToMinutes(s.workStart);
    let we = timeToMinutes(s.workEnd);
    if (we <= ws) we += 24 * 60;
    awake -= (we - ws);
  }
  const cap = awake - LIFE_BUFFER_MIN;
  return Math.max(DAILY_CAP_MIN_FLOOR, Math.min(cap, DAILY_CAP_MIN_CEIL));
}
// 通勤時間は「拘束時間」としてメインの上限からは引かない。
// 電車・バス等（座って何かできる手段）の場合のみ、知力・精神カテゴリに限った別枠を追加する。
// 車・自転車等は安全のため対象外（別枠を発生させない）。
function calcCommuteBonusMinutes(schedule) {
  const s = schedule || DEFAULT_SCHEDULE;
  if (!s.hasCommute || s.commuteMode !== "transit") return 0;
  const oneWay = Number(s.commuteOneWayMin) || 0;
  return Math.max(0, oneWay * 2); // 往復分
}

// 新しいキャラクターを追加する際は、この配列にオブジェクトを1つ足すだけでよい。
// stages はキャラLv1→4→8で切り替わる3段階分の画像URL（GitHubの/characters/フォルダに事前アップロード）。
const GACHA_CHARACTERS = [
  {
    id:"c001", name:"エリカ", rarity:"UR",
    stages: [
      CHAR_IMAGE_BASE + "swordgirl_stage1.png", // キャラLv1〜：旅立ちの剣士
      CHAR_IMAGE_BASE + "swordgirl_stage2.png", // キャラLv4〜：翠嵐の剣士
      CHAR_IMAGE_BASE + "swordgirl_stage3.png", // キャラLv8〜：紅蓮の支配者
    ],
    passive: { type:"xp", cat:"exercise", val:0.15 },
    passiveDesc:"筋力EXP +15%",
    flavor:"一介の旅人だった少女は剣を取り、風纏う剣士として鍛錬を重ね、やがて紅蓮の炎を身に纏う支配者へと至った。",
  },
  // 例:
  // {
  //   id:"c002", name:"焔剣士イグニス", rarity:"UR",
  //   stages: [
  //     CHAR_IMAGE_BASE + "c002_1.png", // キャラLv1〜
  //     CHAR_IMAGE_BASE + "c002_2.png", // キャラLv4〜
  //     CHAR_IMAGE_BASE + "c002_3.png", // キャラLv8〜
  //   ],
  //   passive: { type:"xp", cat:"exercise", val:0.15 },
  //   passiveDesc:"筋力EXP +15%",
  //   flavor:"炎を纏う剣士。鍛錬の果てに、己自身が武器となった。",
  // },
];

// 指定キャラLvに応じた画像URLを取得
function getCharacterStageImage(char, charLv) {
  if (!char?.stages?.length) return null;
  let idx = 0;
  for (let i = 0; i < CHAR_EVOLUTION_LEVELS.length; i++) {
    if (charLv >= CHAR_EVOLUTION_LEVELS[i]) idx = i;
  }
  return char.stages[Math.min(idx, char.stages.length - 1)];
}

// ガチャでキャラクターが出る確率（reward/buff 両ガチャ共通）
const CHARACTER_DROP_RATE = 0.01;

function drawCharacterDrop(ownedCharIds) {
  if (GACHA_CHARACTERS.length === 0) return null;
  if (Math.random() >= CHARACTER_DROP_RATE) return null;
  const candidates = GACHA_CHARACTERS.filter(c => !ownedCharIds.includes(c.id));
  if (candidates.length === 0) return null; // 全キャラ所持済み
  return candidates[Math.floor(Math.random() * candidates.length)];
}

// プレイヤーアバター画像（進化段階別）
// bundle.js肥大化の原因だったbase64埋め込みをやめ、外部PNG参照に変更。
// ガチャキャラ（CHAR_IMAGE_BASE）と同じくGitHub Pages上でホスティングする。
// sw.jsのプリキャッシュ対象なので、初回表示後はオフラインでも表示できる。
const AVATAR_IMAGE_BASE = "https://nejio.github.io/life-quest/avatars/";
const CHAR_IMAGES = {
  wanderer:  AVATAR_IMAGE_BASE + "wanderer.png",
  acolyte:   AVATAR_IMAGE_BASE + "acolyte.png",
  knight:    AVATAR_IMAGE_BASE + "knight.png",
  archon:    AVATAR_IMAGE_BASE + "archon.png",
  sovereign: AVATAR_IMAGE_BASE + "sovereign.png",
};


// ═══════════════════════════════════════════════════════
//  DATA
// ═══════════════════════════════════════════════════════
const CATEGORIES = [
  { id:"study",    label:"知力",    en:"INT",       icon:"✦", color:"#3b82f6", glow:"#1d4ed8", xpRate:9,  mode:"time",
    desc:"勉強・資格学習・語学・プログラミング・リサーチ" },
  { id:"exercise", label:"筋力",    en:"STRENGTH",  icon:"◈", color:"#fb923c", glow:"#c2410c", xpRate:9,  mode:"time",
    desc:"運動・トレーニング・スポーツ・ヨガ" },
  { id:"reading",  label:"精神",    en:"MIND",      icon:"❋", color:"#facc15", glow:"#a16207", xpRate:9,  mode:"time",
    desc:"読書・瞑想・ジャーナリング・自己反省" },
  { id:"art",      label:"創造",    en:"CRAFT",     icon:"◎", color:"#a78bfa", glow:"#6d28d9", xpRate:9,  mode:"time",
    desc:"趣味・制作・イラスト・音楽など" },
  { id:"other",    label:"探索",    en:"EXPLORE",   icon:"◇", color:"#4ade80", glow:"#15803d", baseXP:300, mode:"count",
    desc:"新しい場所・体験・人との出会いを記録" },
  { id:"health",   label:"体力",    en:"HEALTH",    icon:"♥", color:"#f87171", glow:"#b91c1c", checkXP:12, mode:"check",
    desc:"良い習慣のチェックリスト（睡眠・食事など）" },
];

// 難易度ごとの獲得EXP
const HEALTH_DIFFICULTY = {
  easy:   { label:"かんたん", xp:15, color:"#4ade80" },
  normal: { label:"ふつう",   xp:25, color:"#facc15" },
  hard:   { label:"きつい",   xp:40, color:"#f87171" },
};

// group が同じ項目は「その日一番厳しい達成レベルだけ」を選ぶ排他形式（重複加算を防ぐ）
const DEFAULT_HEALTH_ITEMS = [
  { id:"h1", label:"23時までに就寝",    icon:"🌙", difficulty:"normal", xp:25, group:"sleep" },
  { id:"h5", label:"22時までに就寝",    icon:"🌑", difficulty:"hard",   xp:40, group:"sleep" },
  { id:"h6", label:"6時までに起きる",   icon:"⏰", difficulty:"normal", xp:25, group:"wake"  },
  { id:"h7", label:"5時までに起きる",   icon:"🌅", difficulty:"hard",   xp:40, group:"wake"  },
  { id:"h2", label:"ジャンクフード回避", icon:"🥗", difficulty:"easy",   xp:15 },
  { id:"h3", label:"水を2L以上飲む",    icon:"💧", difficulty:"easy",   xp:15 },
  { id:"h4", label:"朝食をとる",        icon:"🍳", difficulty:"easy",   xp:15 },
];

// 保存済み体力項目に、最新のデフォルト設定(group/xp/difficulty)を同期し、
// 後から追加されたデフォルト項目（起床時間など）を補完するマイグレーション処理。
// ユーザー独自の追加項目（デフォルトにないid）はそのまま維持する。
// localStorage初回読込・デバイス間同期の両方でこの関数を通すことで、
// 古い端末のキャッシュに新しいバランス調整が反映されない問題を防ぐ。
function migrateHealthItems(saved) {
  if (!saved) return DEFAULT_HEALTH_ITEMS;
  const merged = saved.map(item => {
    const def = DEFAULT_HEALTH_ITEMS.find(d => d.id === item.id);
    return def ? { ...item, ...def } : { ...item, xp: item.xp ?? 12 };
  });
  const mergedIds = new Set(merged.map(i=>i.id));
  const missingDefaults = DEFAULT_HEALTH_ITEMS.filter(d => !mergedIds.has(d.id));
  const combined = [...merged, ...missingDefaults];
  // 重複除去：デフォルト項目と同じラベルを持つ「非正規（idが一致しない・group未設定の重複）」項目を削除。
  // 過去に手動で同名項目を追加していた等で、正規のグループ選択式項目とラベルが被った場合の後始末。
  const defaultLabels = new Set(DEFAULT_HEALTH_ITEMS.map(d => d.label));
  const deduped = combined.filter(item => {
    const isDefault = DEFAULT_HEALTH_ITEMS.some(d => d.id === item.id);
    if (isDefault) return true;
    if (defaultLabels.has(item.label)) return false; // 非正規の重複は除去
    return true;
  });
  // 並び順の統一：デフォルト項目はDEFAULT_HEALTH_ITEMSの定義順（就寝・起床のグループが隣り合う）に固定し、
  // ユーザー独自のカスタム項目はその後ろに、追加された順のまま並べる。
  // これにより、保存データの積み重ね順に左右されず常に「23時までに就寝」と「22時までに就寝」が隣接する。
  const defaultOrder = DEFAULT_HEALTH_ITEMS.map(d => d.id);
  const defaultsInOrder = defaultOrder
    .map(id => deduped.find(i => i.id === id))
    .filter(Boolean);
  const customItems = deduped.filter(i => !defaultOrder.includes(i.id));
  return [...defaultsInOrder, ...customItems];
}

const DEFAULT_ACTIVITIES = {
  study: ["資格学習", "語学学習", "プログラミング", "リサーチ・調べもの", "オンライン講座"],
  exercise: ["筋トレ", "ランニング", "ヨガ・ストレッチ", "ウォーキング", "スポーツ"],
  reading: ["小説", "ビジネス書・教養書", "瞑想・マインドフルネス", "ジャーナリング"],
  art: ["イラスト", "音楽", "writing・文章制作", "DIY・工作"],
};

// キャラクタービジュアル (SVGで描画)
const CHAR_STAGES = [
  { minLv:1,  name:"Wanderer",    title_ja:"放浪者",    rarity:1, primaryColor:"#60a5fa", accentColor:"#1d4ed8" },
  { minLv:5,  name:"Acolyte",     title_ja:"従者",      rarity:2, primaryColor:"#34d399", accentColor:"#065f46" },
  { minLv:12, name:"Knight",      title_ja:"騎士",      rarity:3, primaryColor:"#a78bfa", accentColor:"#5b21b6" },
  { minLv:34, name:"Archon",      title_ja:"執政神",    rarity:4, primaryColor:"#fb923c", accentColor:"#9a3412" },
  { minLv:50, name:"Sovereign",   title_ja:"覇王",      rarity:5, primaryColor:"#f0c060", accentColor:"#92400e" },
];


const SKILL_TREE = {
  study: [
    { id:"s1", label:"知識の灯火",  en:"Ember of Knowledge", req:null,         minLv:1,  type:"xp",     val:0.05, desc:"知力EXP +5%" },
    { id:"s2", label:"鋼の記憶",    en:"Steel Memory",       req:"s1",         minLv:17,  type:"xp",     val:0.10, desc:"知力EXP +10%。記憶は鋼より強く。" },
    { id:"s3", label:"深淵の書",    en:"Tome of Abyss",      req:"s2",         minLv:32,  type:"xp",     val:0.15, desc:"知力EXP +15%。深く読むほど強くなる。" },
    { id:"s4", label:"賢者の石",    en:"Philosopher's Stone", req:"s1",        minLv:23,  type:"gem",    val:1,    desc:"知力記録でルーン石+1。知識が富を生む。" },
    { id:"s5", label:"全知の眼",    en:"Eye of Omniscience", req:["s3","s4"], minLv:36, type:"xp",     val:0.20, desc:"知力EXP +20%。全てを見通す境地。" },
    { id:"s6", label:"時間圧縮",    en:"Time Compression",   req:"s2",         minLv:27,  type:"xp",     val:0.20, desc:"15分以下の短時間学習もEXP +20%。" },
    { id:"s7", label:"不滅の探究",  en:"Undying Inquiry",    req:"s5",         minLv:40, type:"streak", val:1,    desc:"ストリークが1回だけ切れずに済む守護。" },
  ],
  exercise: [
    { id:"e1", label:"鉄の意志",    en:"Iron Will",          req:null,         minLv:1,  type:"xp",     val:0.05, desc:"筋力EXP +5%" },
    { id:"e2", label:"血肉の鎧",    en:"Flesh Armor",        req:"e1",         minLv:17,  type:"xp",     val:0.10, desc:"筋力EXP +10%。限界を超えよ。" },
    { id:"e3", label:"神速",        en:"Godspeed",           req:"e2",         minLv:32,  type:"xp",     val:0.15, desc:"筋力EXP +15%。雷より速く動け。" },
    { id:"e4", label:"戦士の血",    en:"Warrior's Blood",    req:"e1",         minLv:23,  type:"gem",    val:1,    desc:"筋力記録でルーン石+1。汗は宝石だ。" },
    { id:"e5", label:"覇王降臨",    en:"Sovereign's Descent",req:["e3","e4"], minLv:36, type:"xp",     val:0.20, desc:"筋力EXP +20%。誰も止められない。" },
    { id:"e6", label:"不屈の闘志",  en:"Indomitable Spirit", req:"e2",         minLv:27,  type:"streak", val:1,    desc:"ストリーク守護×1。折れない心。" },
    { id:"e7", label:"神域",        en:"Divine Realm",       req:"e5",         minLv:40, type:"gacha",  val:0.05, desc:"ガチャSSR排出率+5%。神の恩寵。" },
  ],
  reading: [
    { id:"r1", label:"静寂の門",    en:"Gate of Silence",    req:null,         minLv:1,  type:"xp",     val:0.05, desc:"精神EXP +5%" },
    { id:"r2", label:"内なる声",    en:"Inner Voice",        req:"r1",         minLv:17,  type:"xp",     val:0.10, desc:"精神EXP +10%。魂の深みへ。" },
    { id:"r3", label:"虚空の鏡",    en:"Mirror of the Void", req:"r2",         minLv:32,  type:"xp",     val:0.15, desc:"精神EXP +15%。己を映す鏡。" },
    { id:"r4", label:"夢想家の刻印",en:"Dreamer's Mark",     req:"r1",         minLv:23,  type:"gem",    val:1,    desc:"精神記録でルーン石+1。夢が現実を変える。" },
    { id:"r5", label:"涅槃",        en:"Nirvana",            req:["r3","r4"], minLv:36, type:"xp",     val:0.20, desc:"精神EXP +20%。完全なる悟り。" },
    { id:"r6", label:"月光の加護",  en:"Moonlight Ward",     req:"r2",         minLv:27,  type:"streak", val:1,    desc:"ストリーク守護×1。月が守護する。" },
    { id:"r7", label:"千の言葉",    en:"Thousand Words",     req:"r5",         minLv:40, type:"gacha",  val:0.05, desc:"ガチャSSR排出率+5%。言葉の力。" },
  ],
  art: [
    { id:"a1", label:"創造の火花",  en:"Creative Spark",     req:null,         minLv:1,  type:"xp",     val:0.05, desc:"創造EXP +5%" },
    { id:"a2", label:"熟練の手",    en:"Master's Hand",      req:"a1",         minLv:17,  type:"xp",     val:0.10, desc:"創造EXP +10%。道具は手の延長。" },
    { id:"a3", label:"霊感の嵐",    en:"Storm of Inspiration",req:"a2",        minLv:32,  type:"xp",     val:0.15, desc:"創造EXP +15%。嵐が傑作を生む。" },
    { id:"a4", label:"錬金の筆",    en:"Alchemist's Brush",  req:"a1",         minLv:23,  type:"gem",    val:2,    desc:"創造記録でルーン石+2。芸術は金なり。" },
    { id:"a5", label:"神域の芸術",  en:"Divine Artistry",    req:["a3","a4"], minLv:36, type:"xp",     val:0.20, desc:"創造EXP +20%。神すら嫉妬する。" },
    { id:"a6", label:"美の結晶",    en:"Crystal of Beauty",  req:"a2",         minLv:27,  type:"gacha",  val:0.05, desc:"ガチャSSR排出率+5%。美しさが運を呼ぶ。" },
    { id:"a7", label:"創世",        en:"Genesis",            req:"a5",         minLv:40, type:"gem",    val:3,    desc:"創造記録でルーン石+3。新世界を創れ。" },
  ],
  other: [
    { id:"o1", label:"放浪者の本能",en:"Wanderer's Instinct",req:null,         minLv:1,  type:"xp",     val:0.05, desc:"探索EXP +5%" },
    { id:"o2", label:"縁の糸",      en:"Thread of Fate",     req:"o1",         minLv:17,  type:"gem",    val:1,    desc:"探索記録でルーン石+1。出会いが財産。" },
    { id:"o3", label:"地平の彼方",  en:"Beyond the Horizon", req:"o2",         minLv:32,  type:"xp",     val:0.15, desc:"探索EXP +15%。限界の先へ。" },
    { id:"o4", label:"星読みの目",  en:"Star Reader's Eye",  req:"o1",         minLv:23,  type:"xp",     val:0.10, desc:"探索EXP +10%。星が道を示す。" },
    { id:"o5", label:"世界の歩き方",en:"Ways of the World",  req:["o3","o4"], minLv:36, type:"xp",     val:0.20, desc:"探索EXP +20%。全ての道を知る者。" },
    { id:"o6", label:"幸運の女神",  en:"Lady of Fortune",    req:"o2",         minLv:27,  type:"gacha",  val:0.05, desc:"ガチャSSR排出率+5%。運命に愛される。" },
    { id:"o7", label:"伝説の放浪",  en:"Legendary Wandering",req:"o5",         minLv:40, type:"gem",    val:2,    desc:"探索記録でルーン石+2。伝説を刻め。" },
  ],
};

// ═══════════════════════════════════════════════════════
//  魔法図鑑 — 累計記録回数で解放されるコレクション要素
// ═══════════════════════════════════════════════════════
// 属性：知力=水／筋力=炎／精神=光／創造=雷／探索=風
const ELEMENT_INFO = {
  study:    { name:"水", color:"#3b82f6", light:"#dbeafe", dark:"#1d4ed8" },
  exercise: { name:"炎", color:"#f97316", light:"#fed7aa", dark:"#c2410c" },
  reading:  { name:"土", color:"#a16207", light:"#fde8c8", dark:"#78350f" },
  art:      { name:"雷", color:"#d946ef", light:"#f5d0fe", dark:"#a21caf" },
  other:    { name:"風", color:"#34d399", light:"#bbf7d0", dark:"#15803d" },
};

// tier: 1=弱(Lv帯小) 2=中 3=強 — 同じtier内では色濃淡・グロー有無で差をつける
const MAGIC_GRIMOIRE = {
  // 水属性（知力）— 制御・妨害系。直接火力より「相手の動きを封じる」魔法が多い
  study: [
    { id:"ms1", label:"水弾",     req:5,   tier:1, power:12, type:"attack",  target:"単体",
      desc:"基本の水属性魔法。最初の一滴。",
      flavor:"小さな水の塊を撃ち出す。威力は低いが、命中率が高い。" },
    { id:"ms2", label:"清流",     req:15,  tier:1, power:10, type:"debuff",  target:"単体",
      desc:"澄んだ流れが思考を研ぎ澄ます。",
      flavor:"敵の動きを鈍らせる清流をまとわせる。命中時、敵の行動速度-15%。" },
    { id:"ms3", label:"霧雨",     req:30,  tier:2, power:8,  type:"dot",     target:"範囲",
      desc:"細やかな知識が降り積もる。",
      flavor:"細かな水滴が辺り一帯に降り注ぎ、3ターンの間じわじわとダメージを与え続ける。" },
    { id:"ms4", label:"激流",     req:50,  tier:2, power:28, type:"attack",  target:"単体",
      desc:"勢いを増した知の奔流。",
      flavor:"圧倒的な水流で敵を押し流す。ノックバック効果あり。" },
    { id:"ms5", label:"氷結界",   req:80,  tier:2, power:6,  type:"debuff",  target:"範囲",
      desc:"思考を凍結させ、本質だけを残す。",
      flavor:"周囲一帯を凍らせ、敵全体の行動を1ターン封じる。低威力だが拘束力は絶大。" },
    { id:"ms6", label:"大渦潮",   req:120, tier:3, power:45, type:"attack",  target:"範囲",
      desc:"全てを飲み込む知識の渦。",
      flavor:"巨大な渦が戦場全体を飲み込む。範囲内の敵すべてに大ダメージ。" },
    { id:"ms7", label:"深淵の海", req:180, tier:3, power:20, type:"special", target:"全体",
      desc:"極めし者だけが辿り着く深淵。",
      flavor:"戦場そのものを深海に変える禁呪。毎ターン継続ダメージを与えつつ、自身の魔力を回復し続ける。" },
  ],

  // 炎属性（筋力）— 高火力・継続ダメージ。シンプルにパワフルな殴り合い向き
  exercise: [
    { id:"me1", label:"火種",     req:5,   tier:1, power:14, type:"attack",  target:"単体",
      desc:"基本の炎属性魔法。最初の一灯。",
      flavor:"小さな炎弾を放つ。素朴だが手堅い一撃。" },
    { id:"me2", label:"灼熱",     req:15,  tier:1, power:18, type:"attack",  target:"単体",
      desc:"内に秘めた闘志が燃え上がる。",
      flavor:"闘志がそのまま炎となって敵を焼く。会心率がやや高い。" },
    { id:"me3", label:"火炎弾",   req:30,  tier:2, power:24, type:"dot",     target:"単体",
      desc:"鍛えた力を放つ一撃。",
      flavor:"着弾後も燃え広がり、2ターンにわたって炎上ダメージを与える。" },
    { id:"me4", label:"業火",     req:50,  tier:2, power:38, type:"attack",  target:"単体",
      desc:"限界を超えた闘志の業火。",
      flavor:"己の限界を燃料に変える一撃必殺。威力は高いが反動で自身も消耗する。" },
    { id:"me5", label:"爆炎波",   req:80,  tier:2, power:30, type:"attack",  target:"範囲",
      desc:"鍛錬の成果が爆発的に開花する。",
      flavor:"爆発的な熱波が周囲をなぎ払う。範囲内の敵全員に均等ダメージ。" },
    { id:"me6", label:"不死鳥の翼",req:120, tier:3, power:0,  type:"heal",    target:"自身",
      desc:"何度倒れても立ち上がる不屈の証。",
      flavor:"力尽きても炎の翼で蘇る。戦闘不能になった瞬間、一度だけHPを50%回復して復活。" },
    { id:"me7", label:"覇王の咆哮",req:180, tier:3, power:60, type:"attack",  target:"全体",
      desc:"頂点に立つ者だけが纏う炎。",
      flavor:"咆哮一つで戦場を焼き尽くす。全体に大ダメージ、さらに敵全体を3ターン怯ませる。" },
  ],

  // 土属性（精神）— 防御・回復・耐久。攻撃面では地味だが長期戦に強い
  reading: [
    { id:"mr1", label:"小石弾",   req:5,   tier:1, power:10, type:"attack",  target:"単体",
      desc:"基本の土属性魔法。最初の一投。",
      flavor:"小さな石を投げつける。地味だが外れにくい。" },
    { id:"mr2", label:"安らぎ",   req:15,  tier:1, power:0,  type:"heal",    target:"自身",
      desc:"心を落ち着ける静かな安息。",
      flavor:"深呼吸とともに精神を整え、HPを少量回復する。" },
    { id:"mr3", label:"土壁",     req:30,  tier:2, power:0,  type:"buff",    target:"自身",
      desc:"揺るがぬ意志が壁となる。",
      flavor:"頑強な土の壁を展開し、3ターンの間受けるダメージを30%軽減する。" },
    { id:"mr4", label:"根の縛り", req:50,  tier:2, power:14, type:"debuff",  target:"単体",
      desc:"内側から満ちる確かな力。",
      flavor:"地中から根を伸ばし敵の足を絡め取る。1ターン行動不能＋継続ダメージ。" },
    { id:"mr5", label:"地鳴り",   req:80,  tier:2, power:32, type:"attack",  target:"範囲",
      desc:"静謐な大地が轟きをあげる。",
      flavor:"大地そのものを揺らし、立っている敵全員によろめきダメージを与える。" },
    { id:"mr6", label:"聖域結界", req:120, tier:3, power:0,  type:"heal",    target:"全体",
      desc:"穢れなき聖域を作り出す力。",
      flavor:"清浄な結界の中、毎ターン自身のHPを継続回復する不滅の聖域を張る。" },
    { id:"mr7", label:"涅槃の山", req:180, tier:3, power:50, type:"special", target:"全体",
      desc:"悟りに至った者だけが辿り着く境地。",
      flavor:"動かざること山の如し。被ダメージを大幅軽減しつつ、反射ダメージで敵全体を攻撃する。" },
  ],

  // 雷属性（創造）— 速攻・連撃・クリティカル。ハイリスクハイリターン
  art: [
    { id:"ma1", label:"火花",     req:5,   tier:1, power:11, type:"attack",  target:"単体",
      desc:"基本の雷属性魔法。最初の閃き。",
      flavor:"指先に小さな火花を散らす。素早く繰り出せる先制攻撃。" },
    { id:"ma2", label:"閃光",     req:15,  tier:1, power:13, type:"attack",  target:"単体",
      desc:"突然のひらめきが走る。",
      flavor:"閃きと共に放つ一撃。会心率+10%。" },
    { id:"ma3", label:"電光石火", req:30,  tier:2, power:9,  type:"attack",  target:"単体",
      desc:"瞬く間に形になるアイデア。",
      flavor:"低威力ながら必ず2回連続でヒットする連撃魔法。" },
    { id:"ma4", label:"紫電",     req:50,  tier:2, power:34, type:"attack",  target:"単体",
      desc:"鋭く美しい創造の閃光。",
      flavor:"鋭く美しい一撃。会心時のダメージ倍率が通常より高い。" },
    { id:"ma5", label:"雷鳴",     req:80,  tier:2, power:22, type:"debuff",  target:"範囲",
      desc:"世界に響き渡る創造の轟き。",
      flavor:"轟音で敵全体を怯ませ、1ターンの間命中率を下げる。" },
    { id:"ma6", label:"裂空雷",   req:120, tier:3, power:48, type:"attack",  target:"単体",
      desc:"常識を切り裂く独創性。",
      flavor:"常識を切り裂く一撃必殺の雷撃。防御無視で大ダメージ。" },
    { id:"ma7", label:"創世の雷霆",req:180, tier:3, power:55, type:"attack",  target:"全体",
      desc:"新たな世界を生み出す力。",
      flavor:"天地創造の雷が戦場に降り注ぐ。全体に高ダメージ、必ず会心となる。" },
  ],

  // 風属性（探索）— 回避・移動・範囲。直接火力は控えめだが立ち回りで優位を取る
  other: [
    { id:"mo1", label:"そよ風",   req:5,   tier:1, power:9,  type:"attack",  target:"単体",
      desc:"基本の風属性魔法。最初の一歩。",
      flavor:"軽やかな風の刃を放つ。消費が少なく連発が利く。" },
    { id:"mo2", label:"追い風",   req:15,  tier:1, power:0,  type:"buff",    target:"自身",
      desc:"背中を押してくれる優しい風。",
      flavor:"追い風を受け、2ターンの間行動速度+25%。" },
    { id:"mo3", label:"旋風",     req:30,  tier:2, power:16, type:"attack",  target:"範囲",
      desc:"行く先々で巻き起こる小さな渦。",
      flavor:"小さな竜巻が周囲を巻き込む。複数の敵に同時ダメージ。" },
    { id:"mo4", label:"疾風",     req:50,  tier:2, power:0,  type:"buff",    target:"自身",
      desc:"誰よりも速く世界を巡る力。",
      flavor:"圧倒的な速さで敵の攻撃を見切る。3ターンの間回避率+40%。" },
    { id:"mo5", label:"風読み",   req:80,  tier:2, power:20, type:"debuff",  target:"単体",
      desc:"見えない流れを読み解く力。",
      flavor:"敵の弱点を風が教えてくれる。命中時、対象の防御力を2ターン下げる。" },
    { id:"mo6", label:"暴風域",   req:120, tier:3, power:36, type:"attack",  target:"範囲",
      desc:"あらゆる場所を踏破する者の証。",
      flavor:"暴風が戦場全体を吹き荒れる。範囲内の敵にダメージ＋ノックバック。" },
    { id:"mo7", label:"天翔ける風",req:180, tier:3, power:0,  type:"special", target:"自身",
      desc:"世界の果てまで自由に駆ける力。",
      flavor:"風そのものと一体化し、1ターンの間あらゆる攻撃を完全回避する。" },
  ],
};

// 効果タイプの表示情報（アイコン・色・日本語名）
const EFFECT_TYPE_INFO = {
  attack:  { label:"攻撃", icon:"⚔️", color:"#dc2626" },
  dot:     { label:"継続ダメージ", icon:"🔥", color:"#ea580c" },
  debuff:  { label:"弱体化", icon:"🌀", color:"#7c3aed" },
  buff:    { label:"強化", icon:"✨", color:"#16a34a" },
  heal:    { label:"回復", icon:"💚", color:"#16a34a" },
  special: { label:"特殊", icon:"⭐", color:"#d97706" },
};

function calcMagicCount(catId, logs) {
  return logs.filter(l => l.cat === catId).length;
}
function getUnlockedMagic(catId, count) {
  return (MAGIC_GRIMOIRE[catId] || []).filter(m => count >= m.req);
}


const TREE_LAYOUT = {
  study:    [{id:"s1",x:100,y:40},{id:"s2",x:55,y:120},{id:"s3",x:55,y:210},{id:"s4",x:145,y:120},{id:"s5",x:100,y:300},{id:"s6",x:55,y:300},{id:"s7",x:100,y:390}],
  exercise: [{id:"e1",x:100,y:40},{id:"e2",x:55,y:120},{id:"e3",x:55,y:210},{id:"e4",x:145,y:120},{id:"e5",x:100,y:300},{id:"e6",x:145,y:210},{id:"e7",x:100,y:390}],
  reading:  [{id:"r1",x:100,y:40},{id:"r2",x:55,y:120},{id:"r3",x:55,y:210},{id:"r4",x:145,y:120},{id:"r5",x:100,y:300},{id:"r6",x:145,y:210},{id:"r7",x:100,y:390}],
  art:      [{id:"a1",x:100,y:40},{id:"a2",x:55,y:120},{id:"a3",x:55,y:210},{id:"a4",x:145,y:120},{id:"a5",x:100,y:300},{id:"a6",x:145,y:210},{id:"a7",x:100,y:390}],
  other:    [{id:"o1",x:100,y:40},{id:"o2",x:55,y:120},{id:"o3",x:55,y:210},{id:"o4",x:145,y:120},{id:"o5",x:100,y:300},{id:"o6",x:145,y:210},{id:"o7",x:100,y:390}],
};

// ログインボーナス定義
const LOGIN_BONUS_TABLE = [
  { day:1,  gems:3,  xp:0,   label:"初回ログイン",      icon:"🌟" },
  { day:2,  gems:3,  xp:50,  label:"2日連続",           icon:"✨" },
  { day:3,  gems:5,  xp:50,  label:"3日連続",           icon:"🔥" },
  { day:4,  gems:5,  xp:100, label:"4日連続",           icon:"💎" },
  { day:5,  gems:5,  xp:100, label:"5日連続",           icon:"⚡" },
  { day:6,  gems:8,  xp:150, label:"6日連続",           icon:"🌙" },
  { day:7,  gems:15, xp:200, label:"7日連続ボーナス！", icon:"👑" },
  { day:14, gems:30, xp:500, label:"14日連続！",        icon:"🏆" },
  { day:30, gems:60, xp:1000,label:"30日連続！！",      icon:"🌈" },
];
function getLoginBonus(streak) {
  const exact = LOGIN_BONUS_TABLE.find(b => b.day === streak);
  if (exact) return exact;
  if (streak >= 30) return { gems:10, xp:200, label:`${streak}日連続`, icon:"🔥" };
  if (streak >= 14) return { gems:8,  xp:100, label:`${streak}日連続`, icon:"⚡" };
  if (streak >= 7)  return { gems:5,  xp:50,  label:`${streak}日連続`, icon:"💎" };
  return { gems:3, xp:30, label:`${streak}日連続`, icon:"✨" };
}

// ガチャ定義
const GACHA_POOLS = {
  reward: {
    name:"ご褒美ガチャ",
    cost: 10,
    icon:"🎁",
    desc:"現実のご褒美を引こう！",
    items: [
      { id:"rw1", rarity:"SSR", label:"外食上限なし券",      desc:"今週末、好きなものを上限なしで外食してよい！",  icon:"🍽️",  color:"#f0c060", prob:0.01 },
      { id:"rw2", rarity:"SSR", label:"好きなもの購入券",    desc:"欲しかったものを1つ買ってよい！（予算3000円）", icon:"🛍️",  color:"#f0c060", prob:0.02 },
      { id:"rw3", rarity:"SR",  label:"コンビニスイーツ券",  desc:"新作コンビニスイーツを買ってよい！",            icon:"🍰",  color:"#a78bfa", prob:0.07 },
      { id:"rw4", rarity:"SR",  label:"カフェ贅沢券",        desc:"好きなカフェでドリンク＋スイーツを頼んでよい！", icon:"☕",  color:"#a78bfa", prob:0.10 },
      { id:"rw5", rarity:"R",   label:"ゲーム30分券",        desc:"スマホゲームを30分遊んでよい！",                icon:"🎮",  color:"#60a5fa", prob:0.30 },
      { id:"rw6", rarity:"R",   label:"動画1時間券",         desc:"動画配信サービスを1時間楽しんでよい！",          icon:"📺",  color:"#60a5fa", prob:0.25 },
      { id:"rw7", rarity:"R",   label:"ダラダラ30分券",      desc:"何もせず休息してよい！罪悪感なし！",            icon:"🛋️",  color:"#60a5fa", prob:0.25 },
    ],
  },
  buff: {
    name:"バフアイテムガチャ",
    cost: 8,
    icon:"⚗️",
    desc:"記録を有利にするアイテムを入手！",
    items: [
      { id:"bf1", rarity:"SSR", label:"賢者の結晶",      desc:"次の知力記録のEXP×2倍",                     icon:"💎",  color:"#f0c060", prob:0.02, effect:{type:"xp_mult",cat:"study",val:2,uses:1} },
      { id:"bf2", rarity:"SSR", label:"神速の翼",        desc:"次の筋力記録のEXP×2倍",                     icon:"🦋",  color:"#f0c060", prob:0.02, effect:{type:"xp_mult",cat:"exercise",val:2,uses:1} },
      { id:"bf3", rarity:"SR",  label:"知力の結晶",      desc:"次の知力記録のEXP×1.5倍",                   icon:"🔮",  color:"#a78bfa", prob:0.08, effect:{type:"xp_mult",cat:"study",val:1.5,uses:1} },
      { id:"bf4", rarity:"SR",  label:"スタミナドリンク",desc:"ストリークが1回途切れても守護してくれる",    icon:"⚡",  color:"#a78bfa", prob:0.08, effect:{type:"streak_shield",val:1,uses:1} },
      { id:"bf5", rarity:"SR",  label:"創造の焔",        desc:"次の創造記録のEXP×1.5倍",                   icon:"🔥",  color:"#a78bfa", prob:0.08, effect:{type:"xp_mult",cat:"art",val:1.5,uses:1} },
      { id:"bf6", rarity:"R",   label:"ルーン石の欠片",  desc:"ルーン石+5獲得",                             icon:"💠",  color:"#60a5fa", prob:0.24, effect:{type:"gems",val:5} },
      { id:"bf7", rarity:"R",   label:"EXPの露",        desc:"EXP+100獲得",                                icon:"✨",  color:"#60a5fa", prob:0.24, effect:{type:"bonus_xp",val:100} },
      { id:"bf8", rarity:"R",   label:"探索者の地図",    desc:"次の探索記録のEXP×1.5倍",                   icon:"🗺️",  color:"#60a5fa", prob:0.24, effect:{type:"xp_mult",cat:"other",val:1.5,uses:1} },
    ],
  },
};

// ガチャを1回引く
function drawGacha(poolId, bonusSSRRate, unlockedSkills, ownedCharIds=[]) {
  // キャラクター排出判定（低確率・未所持のみ）
  const charDrop = drawCharacterDrop(ownedCharIds);
  if (charDrop) return { type:"character", ...charDrop };

  const pool = GACHA_POOLS[poolId];
  const totalBonus = bonusSSRRate;
  const items = pool.items.map(item => ({
    ...item,
    prob: item.rarity === "SSR" ? item.prob + totalBonus / pool.items.filter(i=>i.rarity==="SSR").length : item.prob,
  }));
  const r = Math.random();
  let cum = 0;
  for (const item of items) {
    cum += item.prob;
    if (r < cum) return item;
  }
  return items[items.length - 1];
}



const TITLES_MAP = [
  { lv:1,  title:"放浪者" }, { lv:5,  title:"従者" }, { lv:12, title:"騎士" },
  { lv:34, title:"執政神" }, { lv:50, title:"覇王" },
];

function xpForLevel(lv) { return Math.floor(200 * Math.pow(1.16, lv - 1)); }
function calcLevel(totalXP) {
  let lv = 1, xp = totalXP;
  while (xp >= xpForLevel(lv)) { xp -= xpForLevel(lv); lv++; }
  return { lv, current: xp, needed: xpForLevel(lv) };
}
function getTitle(lv) { return [...TITLES_MAP].reverse().find(t => lv >= t.lv)?.title ?? "放浪者"; }
function getCharStage(lv) { return [...CHAR_STAGES].reverse().find(s => lv >= s.minLv) ?? CHAR_STAGES[0]; }

// 「今日」の判定を端末のローカル時刻（日本時間）基準にする。
// toISOString()はUTC基準に変換されるため、そのまま使うと日本時間の朝9時に日付が
// 切り替わってしまう不具合があった（UTC+9時間のズレ）。必ずこの関数を使うこと。
function getLocalDateString(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function calcStreak(logs, healthChecks, shieldDates=[]) {
  const healthDates = Object.keys(healthChecks||{}).filter(d => (healthChecks[d]||[]).length > 0);
  const allDates = [...logs.map(l => l.date), ...healthDates, ...(shieldDates||[])];
  if (!allDates.length) return 0;
  const days = [...new Set(allDates)].sort().reverse();
  const today = getLocalDateString();
  if (days[0] !== today && days[0] !== getLocalDateString(new Date(Date.now()-86400000))) return 0;
  let streak = 1;
  for (let i = 1; i < days.length; i++) {
    if ((new Date(days[i-1]) - new Date(days[i])) / 86400000 === 1) streak++; else break;
  }
  return streak;
}
// ストリーク守護：最後の活動日の翌日〜昨日までの「空白日」を列挙する。
// （今日はまだ記録のチャンスがあるため対象外）
// 空白をチャージで埋め切れる場合のみ守護を発動する（埋め切れない長期空白なら温存する）。
function getStreakGapDates(logs, healthChecks, shieldDates) {
  const healthDates = Object.keys(healthChecks||{}).filter(d => (healthChecks[d]||[]).length > 0);
  const active = new Set([...logs.map(l=>l.date), ...healthDates, ...(shieldDates||[])]);
  if (active.size === 0) return [];
  const last = [...active].sort().reverse()[0];
  const today = getLocalDateString();
  if (last >= today) return [];
  const gaps = [];
  const d = new Date(last + "T00:00:00"); // ローカルタイムとして解釈
  for (let i = 0; i < 366; i++) { // 安全上限
    d.setDate(d.getDate() + 1);
    const ds = getLocalDateString(d);
    if (ds >= today) break;
    gaps.push(ds);
  }
  return gaps;
}
// excludeDate を指定すると、その日付分を除いた「確定済み」の体力EXPだけを合計する。
// スキルポイント算出専用（当日分のチェック付け外しでSPを先取りされるのを防ぐため）。
function calcHealthXP(healthChecks, healthItems, excludeDate=null) {
  const xpMap = Object.fromEntries(healthItems.map(i=>[i.id, i.xp ?? 12]));
  return Object.entries(healthChecks||{}).reduce((sum, [date, ids]) => {
    if (date === excludeDate) return sum;
    return sum + (ids||[]).reduce((s,id)=>s+(xpMap[id] ?? 12), 0);
  }, 0);
}
function isNodeUnlocked(node, unlockedIds, lv) {
  if (lv < node.minLv) return false;
  if (!node.req) return true;
  if (Array.isArray(node.req)) return node.req.every(r => unlockedIds.includes(r));
  return unlockedIds.includes(node.req);
}
function getEquippedCharData(equippedChar) {
  return GACHA_CHARACTERS.find(c => c.id === equippedChar) || null;
}
// スキルツリー由来のXPボーナスのみを返す（キャラ・サブスクは含まない）
function calcXPBonus(catId, unlockedSkills, sessionMin=null) {
  const tree = SKILL_TREE[catId] ?? [];
  let bonus = tree.filter(n => unlockedSkills.includes(n.id) && n.type === "xp" && n.id !== "s6")
             .reduce((s,n) => s + n.val, 0);
  // 時間圧縮ノード：15分以下の短時間記録の時だけ発動する条件付きボーナス
  const timeCompress = tree.find(n => n.id === "s6" && unlockedSkills.includes(n.id));
  if (timeCompress && sessionMin !== null && sessionMin <= 15) bonus += timeCompress.val;
  return bonus;
}
// キャラ・サブスクなど「外部由来」のXPボーナス（スキルツリーとは掛け算で合成する）
// 将来のサブスク実装時、isSubscribed引数にフラグを渡すことでSUBSCRIPTION_XP_BOOSTが乗る
const SUBSCRIPTION_XP_BOOST = 0.30;
function calcExternalXPBonus(catId, equippedChar, isSubscribed=false) {
  let bonus = 0;
  const char = getEquippedCharData(equippedChar);
  if (char?.passive?.type === "xp" && char.passive.cat === catId) bonus += char.passive.val;
  if (isSubscribed) bonus += SUBSCRIPTION_XP_BOOST;
  return bonus;
}
function calcGemBonus(catId, unlockedSkills, equippedChar) {
  const tree = SKILL_TREE[catId] ?? [];
  let bonus = tree.filter(n => unlockedSkills.includes(n.id) && n.type === "gem")
             .reduce((s,n) => s + n.val, 0);
  const char = getEquippedCharData(equippedChar);
  if (char?.passive?.type === "gem" && char.passive.cat === catId) bonus += char.passive.val;
  return bonus;
}
function calcSSRBonus(unlockedSkills, equippedChar) {
  let bonus = Object.values(SKILL_TREE).flat()
    .filter(n => unlockedSkills.includes(n.id) && n.type === "gacha")
    .reduce((s,n) => s + n.val, 0);
  const char = getEquippedCharData(equippedChar);
  if (char?.passive?.type === "gacha") bonus += char.passive.val;
  return bonus;
}
function calcStreakShields(unlockedSkills) {
  return Object.values(SKILL_TREE).flat()
    .filter(n => unlockedSkills.includes(n.id) && n.type === "streak")
    .reduce((s,n) => s + n.val, 0);
}

// ═══════════════════════════════════════════════════════
//  CHARACTER IMAGE COMPONENT
// ═══════════════════════════════════════════════════════
function CharacterSVG({ stage, lv, animated }) {
  const imgSrc = CHAR_IMAGES[stage.name.toLowerCase()];
  return (
    <div style={{
      width:"100%", height:"100%",
      display:"flex", alignItems:"center", justifyContent:"center",
      position:"relative",
    }}>
      {/* glow aura behind image */}
      <div style={{
        position:"absolute", inset:0,
        background:`radial-gradient(ellipse at 50% 70%, ${stage.primaryColor}28 0%, transparent 70%)`,
        borderRadius:16,
      }}/>
      <img src={imgSrc} alt={stage.title_ja}
        style={{
          width:"100%", height:"100%",
          objectFit:"contain",
          filter: animated ? `drop-shadow(0 0 14px ${stage.primaryColor}99)` : "none",
          transition:"filter .3s ease",
        }}
      />
    </div>
  );
}


// ═══════════════════════════════════════════════════════
//  魔法グリフ（属性×tier別SVGモチーフ）
// ═══════════════════════════════════════════════════════
function MagicGlyph({ catId, tier, color, locked }) {
  const stroke = locked ? "#a8a29e" : color;
  const fill = locked ? "#a8a29e" : color;

  const glyphs = {
    study: {
      1: <path d="M27 8 C20 22 14 30 14 38 A13 13 0 0 0 40 38 C40 30 34 22 27 8 Z" fill={fill} opacity={locked?0.5:0.85}/>,
      2: <g stroke={stroke} strokeWidth="3" fill="none" strokeLinecap="round" opacity={locked?0.5:1}>
           <path d="M5 20 Q14 10 23 20 T41 20 T59 20"/>
           <path d="M5 32 Q14 22 23 32 T41 32 T59 32" opacity="0.7"/>
           <path d="M5 44 Q14 34 23 44 T41 44 T59 44" opacity="0.5"/>
         </g>,
      3: <g opacity={locked?0.5:1}>
           <path d="M27 27 m-18 0 a18 18 0 1 1 36 0 a13 13 0 1 1 -26 0 a8 8 0 1 1 16 0 a3 3 0 1 1 -6 0"
                 stroke={stroke} strokeWidth="2.5" fill="none" strokeLinecap="round"/>
           <circle cx="27" cy="27" r="3" fill={fill}/>
         </g>,
    },
    exercise: {
      1: <path d="M27 10 C21 19 17 25 17 32 A10 10 0 0 0 37 32 C37 25 33 19 27 10 Z" fill={fill} opacity={locked?0.5:0.9}/>,
      2: <path d="M27 6 C19 17 14 25 14 34 A13 13 0 0 0 40 34 C40 25 35 17 27 6 Z M27 20 C23 26 21 30 21 34 A6 6 0 0 0 33 34 C33 30 31 26 27 20 Z"
              fill={fill} opacity={locked?0.5:1}/>,
      3: <g opacity={locked?0.5:1}>
           <path d="M27 4 C16 18 10 28 10 38 A17 17 0 0 0 44 38 C44 28 38 18 27 4 Z" fill={fill} opacity="0.85"/>
           <path d="M27 18 C20 27 17 32 17 38 A10 10 0 0 0 37 38 C37 32 34 27 27 18 Z" fill={locked?"#d6d3d1":"#fff7ed"} opacity="0.9"/>
         </g>,
    },
    reading: {
      // tier1: 小さな石（ゴツゴツした不規則な多角形）
      1: <polygon points="27,12 34,17 38,26 34,38 22,40 14,33 15,20 22,13"
              fill={fill} opacity={locked?0.5:0.9}/>,
      // tier2: 岩が積み重なった様子（大小2つの多角形）
      2: <g opacity={locked?0.5:1}>
           <polygon points="27,10 36,16 40,27 35,38 20,40 13,32 15,20 22,12" fill={fill}/>
           <polygon points="27,18 32,22 31,30 23,31 20,24 23,18" fill={locked?"#d6d3d1":"#fde8c8"} opacity="0.7"/>
         </g>,
      // tier3: 山＋結晶。複数の鋭角三角形が重なり、土属性の「大地の守護」を表現
      3: <g opacity={locked?0.5:1}>
           <polygon points="27,7 40,28 34,42 20,42 14,28" fill={fill}/>
           <polygon points="27,7 40,28 34,42 20,42 14,28" fill={locked?"#d6d3d1":"#fde8c8"} opacity="0.0"/>
           <polygon points="27,16 34,30 20,30" fill={locked?"#d6d3d1":"#fde8c8"} opacity="0.65"/>
           <polygon points="19,32 27,42 11,42" fill={fill} opacity="0.7"/>
           <polygon points="35,32 43,42 27,42" fill={fill} opacity="0.7"/>
         </g>,
    },
    art: {
      1: <polygon points="29,8 20,30 27,30 23,46 38,24 30,24" fill={fill} opacity={locked?0.5:0.9}/>,
      2: <polygon points="30,5 18,28 26,28 21,49 41,22 31,22" fill={fill} opacity={locked?0.5:1}/>,
      3: <g opacity={locked?0.5:1}>
           <polygon points="30,4 16,28 25,28 19,50 42,21 30,21" fill={fill}/>
           <polygon points="30,4 16,28 25,28" fill={locked?"#d6d3d1":"#fdf4ff"} opacity="0.6"/>
         </g>,
    },
    other: {
      1: <path d="M8 22 Q20 14 30 22 T50 22" stroke={stroke} strokeWidth="3" fill="none" strokeLinecap="round" opacity={locked?0.5:1}/>,
      2: <g stroke={stroke} strokeWidth="3" fill="none" strokeLinecap="round" opacity={locked?0.5:1}>
           <path d="M6 18 Q18 8 28 18 T50 18"/>
           <path d="M6 30 Q18 20 28 30 T50 30" opacity="0.7"/>
           <path d="M10 42 Q20 36 28 42 T46 42" opacity="0.5"/>
         </g>,
      3: <g opacity={locked?0.5:1}>
           <path d="M27 27 m-16 0 a16 16 0 1 1 32 0 a11 11 0 1 1 -22 0 a6 6 0 1 1 12 0"
                 stroke={stroke} strokeWidth="2.5" fill="none" strokeLinecap="round"/>
           <circle cx="27" cy="27" r="2.5" fill={fill}/>
         </g>,
    },
  };

  return (
    <svg viewBox="0 0 54 54" width="48" height="48">
      {glyphs[catId]?.[tier] || <circle cx="27" cy="27" r="10" fill={fill}/>}
    </svg>
  );
}

function SkillTreeView({ catId, lv, unlocked, onUnlock, skillPoints }) {
  const cat = CATEGORIES.find(c=>c.id===catId);
  const nodes = SKILL_TREE[catId];
  const layout = TREE_LAYOUT[catId];
  const [tooltip, setTooltip] = useState(null);

  const getPos = (id) => layout.find(l=>l.id===id);

  const edges = nodes.flatMap(n => {
    if (!n.req) return [];
    const reqs = Array.isArray(n.req) ? n.req : [n.req];
    return reqs.map(r => ({ from: r, to: n.id }));
  });

  return (
    <div style={{position:"relative"}}>
      <svg viewBox="0 0 200 440" width="200" height="440"
        style={{display:"block",margin:"0 auto",overflow:"visible"}}>
        <defs>
          <filter id="nglow">
            <feGaussianBlur stdDeviation="3" result="b"/>
            <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
        </defs>

        {/* edges */}
        {edges.map(({from,to},i) => {
          const f = getPos(from), t = getPos(to);
          const active = unlocked.includes(from) && unlocked.includes(to);
          const ready  = unlocked.includes(from) && !unlocked.includes(to);
          return (
            <line key={i} x1={f.x} y1={f.y} x2={t.x} y2={t.y}
              stroke={active ? cat.color : ready ? cat.color+"55" : "#e8e4de"}
              strokeWidth={active ? 2 : 1}
              strokeDasharray={active ? "none" : "4 3"}
              style={active ? {filter:`drop-shadow(0 0 4px ${cat.color})`} : {}}/>
          );
        })}

        {/* nodes */}
        {nodes.map(n => {
          const pos = getPos(n.id);
          const isUnlocked = unlocked.includes(n.id);
          const canUnlock  = !isUnlocked && isNodeUnlocked(n, unlocked, lv) && skillPoints > 0;
          const locked     = !isUnlocked && !canUnlock;
          return (
            <g key={n.id} style={{cursor: canUnlock ? "pointer" : "default"}}
              onClick={() => canUnlock && onUnlock(n.id)}
              onMouseEnter={() => setTooltip(n.id)}
              onMouseLeave={() => setTooltip(null)}>
              {isUnlocked && (
                <circle cx={pos.x} cy={pos.y} r="22"
                  fill={cat.color+"22"} stroke={cat.color} strokeWidth="0"
                  style={{filter:`drop-shadow(0 0 8px ${cat.color})`}}/>
              )}
              <circle cx={pos.x} cy={pos.y} r="18"
                fill={isUnlocked ? cat.color+"33" : canUnlock ? "#e8e4de" : "#ede9e3"}
                stroke={isUnlocked ? cat.color : canUnlock ? cat.color+"88" : "#e8e4de"}
                strokeWidth={isUnlocked ? 2 : 1.5}/>
              <text x={pos.x} y={pos.y+5} textAnchor="middle" fontSize="14"
                fill={isUnlocked ? cat.color : locked ? "#78716c" : cat.color+"88"}
                style={isUnlocked ? {filter:`drop-shadow(0 0 6px ${cat.color})`} : {}}>
                {isUnlocked ? "◆" : canUnlock ? "◇" : "○"}
              </text>
            </g>
          );
        })}
      </svg>

      {/* tooltip */}
      {tooltip && (() => {
        const n = nodes.find(x=>x.id===tooltip);
        const pos = getPos(tooltip);
        const isUnlocked = unlocked.includes(n.id);
        const canUnlock  = !isUnlocked && isNodeUnlocked(n, unlocked, lv) && skillPoints > 0;
        return (
          <div style={{
            position:"absolute",
            left: pos.x > 100 ? "auto" : "60%",
            right: pos.x > 100 ? "60%" : "auto",
            top: pos.y * (390/390) * 0.75,
            background:"#f5f2ee",border:`1px solid ${cat.color}55`,
            borderRadius:10,padding:"10px 12px",minWidth:140,
            pointerEvents:"none",zIndex:10,
          }}>
            <div style={{fontSize:11,color:cat.color,letterSpacing:2,marginBottom:4}}>{n.en}</div>
            <div style={{fontSize:13,fontWeight:700,marginBottom:4}}>{n.label}</div>
            <div style={{fontSize:11,color:"#44403c",marginBottom:6}}>{n.desc}</div>
            <div style={{fontSize:10,color:"#78716c"}}>必要Lv {n.minLv}</div>
            {canUnlock && <div style={{fontSize:11,color:cat.color,marginTop:4}}>タップして解放</div>}
            {isUnlocked && <div style={{fontSize:11,color:"#4ade80",marginTop:4}}>✓ 習得済み</div>}
          </div>
        );
      })()}
    </div>
  );
}

// ═══════════════════════════════════════════════════════
//  LEVEL-UP MODAL
// ═══════════════════════════════════════════════════════
function LevelUpModal({ oldLv, newLv, stage, onClose }) {
  return (
    <div style={{
      position:"fixed",inset:0,background:"rgba(200,195,188,0.75)",backdropFilter:"blur(8px)",
      display:"flex",alignItems:"center",justifyContent:"center",zIndex:200,
    }}>
      <div style={{
        position:"relative",width:320,
        background:"linear-gradient(160deg,#faf8f5 0%,#f5f2ee 100%)",
        border:`1px solid ${stage.primaryColor}88`,borderRadius:20,
        padding:"40px 32px",textAlign:"center",
        animation:"lvup .5s cubic-bezier(.34,1.56,.64,1)",
        boxShadow:`0 0 80px ${stage.primaryColor}40`,
      }}>
        {/* corner accents */}
        {["tl","tr","bl","br"].map(pos=>(
          <div key={pos} style={{
            position:"absolute",
            top: pos.includes("t") ? 12 : "auto",
            bottom: pos.includes("b") ? 12 : "auto",
            left: pos.includes("l") ? 12 : "auto",
            right: pos.includes("r") ? 12 : "auto",
            width:16,height:16,
            borderTop: pos.includes("t") ? `1.5px solid ${stage.primaryColor}` : "none",
            borderBottom: pos.includes("b") ? `1.5px solid ${stage.primaryColor}` : "none",
            borderLeft: pos.includes("l") ? `1.5px solid ${stage.primaryColor}` : "none",
            borderRight: pos.includes("r") ? `1.5px solid ${stage.primaryColor}` : "none",
          }}/>
        ))}

        <div style={{fontSize:10,letterSpacing:5,color:stage.primaryColor,marginBottom:16}}>
          ASCENSION COMPLETE
        </div>
        <div style={{height:140,marginBottom:16}}>
          <CharacterSVG stage={stage} lv={newLv} animated={true}/>
        </div>
        <div style={{
          fontSize:56,fontWeight:900,lineHeight:1,
          color:stage.primaryColor,
          textShadow:`0 0 30px ${stage.primaryColor}`,
          marginBottom:4,
        }}>Lv.{newLv}</div>
        <div style={{fontSize:18,color:"#1e1b2e",marginBottom:6}}>{getTitle(newLv)}</div>
        <div style={{fontSize:12,color:"#78716c",marginBottom:24}}>
          スキルポイント +1 獲得
        </div>
        <button onClick={onClose} style={{
          padding:"12px 48px",borderRadius:999,border:"none",cursor:"pointer",
          background:`linear-gradient(90deg,${stage.accentColor},${stage.primaryColor})`,
          color:"#fff",fontWeight:700,fontSize:14,letterSpacing:2,
          boxShadow:`0 4px 24px ${stage.primaryColor}50`,
        }}>CONTINUE</button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
//  MAIN APP
// ═══════════════════════════════════════════════════════
const TABS = [
  { id:"home",      label:"HOME",    icon:"⬡" },
  { id:"character", label:"CHAR",    icon:"◈" },
  { id:"record",    label:"LOG",     icon:"✦" },
  { id:"skills",    label:"SKILLS",  icon:"❋" },
  { id:"gacha",     label:"GACHA",   icon:"🎲" },
  { id:"stats",     label:"STATUS",  icon:"◎" },
];

function LifeQuest() {
  const [logs,         setLogs]         = useState(() => JSON.parse(localStorage.getItem("lq2_logs")||"[]"));
  const [unlocked,     setUnlocked]     = useState(() => JSON.parse(localStorage.getItem("lq2_skills")||"[]"));
  const [spUsed,       setSpUsed]       = useState(() => JSON.parse(localStorage.getItem("lq2_spused")||"0"));
  const [healthChecks, setHealthChecks] = useState(() => JSON.parse(localStorage.getItem("lq2_health")||"{}"));
  const [healthItems,  setHealthItems]  = useState(() => {
    const saved = JSON.parse(localStorage.getItem("lq2_hitems")||"null");
    return migrateHealthItems(saved);
  });
  const [newHabit,     setNewHabit]     = useState("");
  const [newHabitDiff, setNewHabitDiff] = useState("normal");
  const [schedule,     setSchedule]     = useState(() => {
    const saved = localStorage.getItem("lq2_schedule");
    return saved ? JSON.parse(saved) : DEFAULT_SCHEDULE;
  });
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [activities,   setActivities]   = useState(() => {
    const saved = JSON.parse(localStorage.getItem("lq2_activities")||"null") ?? DEFAULT_ACTIVITIES;
    return { ...DEFAULT_ACTIVITIES, ...saved };
  });
  const [newActivity,  setNewActivity]  = useState("");
  const [showAddActivity, setShowAddActivity] = useState(false);
  const [gems,         setGems]         = useState(() => JSON.parse(localStorage.getItem("lq2_gems")||"0"));
  const [inventory,    setInventory]    = useState(() => JSON.parse(localStorage.getItem("lq2_inv")||"[]"));
  const [lastLogin,    setLastLogin]    = useState(() => localStorage.getItem("lq2_lastlogin")||"");
  const [loginBonus,   setLoginBonus]   = useState(null); // {bonus, streak} to show modal
  const [gachaModal,   setGachaModal]   = useState(null); // "reward"|"buff"|null
  const [gachaResult,  setGachaResult]  = useState(null); // drawn item
  const [ownedChars,   setOwnedChars]   = useState(() => JSON.parse(localStorage.getItem("lq2_chars")||"[]"));
  // ストリーク守護チャージ数。初回は移行措置として、
  // ①解放済みストリーク系スキル分 ②旧バージョンで効果なく消費されたスタミナドリンク分 を還元する
  const [shieldCharges, setShieldCharges] = useState(() => {
    const saved = localStorage.getItem("lq2_shieldcharges");
    if (saved !== null) return JSON.parse(saved);
    const fromSkills = calcStreakShields(JSON.parse(localStorage.getItem("lq2_skills")||"[]"));
    const fromItems  = JSON.parse(localStorage.getItem("lq2_inv")||"[]")
      .filter(i => i.effect?.type === "streak_shield" && i.used).length;
    return fromSkills + fromItems;
  });
  // 守護が実際に発動して「活動日扱い」になった日付のリスト
  const [shieldDates, setShieldDates] = useState(() => JSON.parse(localStorage.getItem("lq2_shielddates")||"[]"));
  const [equippedChar, setEquippedChar] = useState(() => localStorage.getItem("lq2_equip") || "");
  const [charXP,       setCharXP]       = useState(() => JSON.parse(localStorage.getItem("lq2_charxp")||"{}"));
  const [charDetail,   setCharDetail]   = useState(null); // 図鑑詳細モーダル用
  const [gachaAnim,    setGachaAnim]    = useState(false);
  const [magicDetail,  setMagicDetail]  = useState(null); // {magic, elem, isUnlocked}
  const [tab,      setTab]      = useState("home");
  const [skillCat, setSkillCat] = useState("study");
  const [form,     setForm]     = useState({ cat:"study", min:30, note:"", activity:"" });
  const [levelUp,  setLevelUp]  = useState(null);
  const [toast,    setToast]    = useState(null);
  const prevLv = useRef(null);

  // ── 同期関連 state ──
  const [syncCode,   setSyncCode]   = useState(() => localStorage.getItem("lq2_synccode") || "");
  const [syncStatus, setSyncStatus] = useState("idle"); // idle|syncing|synced|error
  const [syncLastAt, setSyncLastAt] = useState(() => localStorage.getItem("lq2_syncat") || "");
  const [syncInput,  setSyncInput]  = useState("");
  const [syncBusy,   setSyncBusy]   = useState(false); // 発行/読込中のボタンロック
  const syncPushTimer = useRef(null);
  const syncFirstRun  = useRef(true);

  useEffect(() => { localStorage.setItem("lq2_logs",   JSON.stringify(logs));     }, [logs]);
  useEffect(() => { localStorage.setItem("lq2_skills", JSON.stringify(unlocked)); }, [unlocked]);
  useEffect(() => { localStorage.setItem("lq2_spused", JSON.stringify(spUsed));   }, [spUsed]);
  useEffect(() => { localStorage.setItem("lq2_health", JSON.stringify(healthChecks)); }, [healthChecks]);
  useEffect(() => { localStorage.setItem("lq2_hitems", JSON.stringify(healthItems));  }, [healthItems]);
  useEffect(() => { localStorage.setItem("lq2_activities", JSON.stringify(activities)); }, [activities]);
  useEffect(() => { localStorage.setItem("lq2_gems",  JSON.stringify(gems));      }, [gems]);
  useEffect(() => { localStorage.setItem("lq2_inv",   JSON.stringify(inventory)); }, [inventory]);
  useEffect(() => { localStorage.setItem("lq2_lastlogin", lastLogin);             }, [lastLogin]);
  useEffect(() => { localStorage.setItem("lq2_chars", JSON.stringify(ownedChars)); }, [ownedChars]);
  useEffect(() => { localStorage.setItem("lq2_shieldcharges", JSON.stringify(shieldCharges)); }, [shieldCharges]);
  useEffect(() => { localStorage.setItem("lq2_shielddates", JSON.stringify(shieldDates)); }, [shieldDates]);
  useEffect(() => { localStorage.setItem("lq2_equip", equippedChar);              }, [equippedChar]);
  useEffect(() => { localStorage.setItem("lq2_charxp", JSON.stringify(charXP));   }, [charXP]);
  useEffect(() => { localStorage.setItem("lq2_schedule", JSON.stringify(schedule)); }, [schedule]);

  // 同期コードの永続化
  useEffect(() => { localStorage.setItem("lq2_synccode", syncCode); }, [syncCode]);
  useEffect(() => { localStorage.setItem("lq2_syncat", syncLastAt); }, [syncLastAt]);

  // データ変更時の自動同期（2秒デバウンス）
  useEffect(() => {
    if (syncFirstRun.current) { syncFirstRun.current = false; return; }
    if (!syncCode) return;
    if (syncPushTimer.current) clearTimeout(syncPushTimer.current);
    syncPushTimer.current = setTimeout(() => {
      doSyncPush();
    }, 2000);
    return () => clearTimeout(syncPushTimer.current);
    // eslint-disable-next-line
  }, [logs, unlocked, spUsed, healthChecks, healthItems, activities, gems, inventory, lastLogin, ownedChars, equippedChar, charXP, schedule, shieldCharges, shieldDates, syncCode]);

  function collectSyncData() {
    return { logs, unlocked, spUsed, healthChecks, healthItems, activities, gems, inventory, lastLogin, ownedChars, equippedChar, charXP, schedule, shieldCharges, shieldDates };
  }

  function applySyncData(data) {
    if (!data) return;
    if (data.logs)         setLogs(data.logs);
    if (data.unlocked)     setUnlocked(data.unlocked);
    if (data.spUsed !== undefined) setSpUsed(data.spUsed);
    if (data.healthChecks) setHealthChecks(data.healthChecks);
    if (data.healthItems)  setHealthItems(migrateHealthItems(data.healthItems));
    if (data.activities)   setActivities(data.activities);
    if (data.gems !== undefined)   setGems(data.gems);
    if (data.inventory)    setInventory(data.inventory);
    if (data.lastLogin !== undefined) setLastLogin(data.lastLogin);
    if (data.ownedChars)   setOwnedChars(data.ownedChars);
    if (data.equippedChar !== undefined) setEquippedChar(data.equippedChar);
    if (data.charXP)       setCharXP(data.charXP);
    if (data.schedule)     setSchedule(data.schedule);
    if (data.shieldCharges !== undefined) setShieldCharges(data.shieldCharges);
    if (data.shieldDates)  setShieldDates(data.shieldDates);
  }

  async function doSyncPush() {
    if (!syncCode) return;
    setSyncStatus("syncing");
    try {
      // 競合ガード：自分の最終同期後に他デバイスが更新していたら、
      // 古いローカル状態で上書きせず、リモートの内容を取り込む側に切り替える。
      const remoteAt = await syncPeekUpdatedAt(syncCode);
      if (remoteAt && syncLastAt && remoteAt > syncLastAt) {
        const remote = await syncPull(syncCode);
        if (remote?.data) {
          applySyncData(remote.data);
          setSyncLastAt(remote.updatedAt || new Date().toISOString());
          setSyncStatus("synced");
          showToast("他のデバイスの更新を取り込みました🔄", "#60a5fa");
          return;
        }
      }
      await syncPush(syncCode, collectSyncData());
      setSyncStatus("synced");
      setSyncLastAt(new Date().toISOString());
    } catch(e) {
      setSyncStatus("error");
    }
  }

  async function handleIssueSyncCode() {
    setSyncBusy(true);
    try {
      const code = generateSyncCode();
      await syncPush(code, collectSyncData());
      setSyncCode(code);
      setSyncStatus("synced");
      setSyncLastAt(new Date().toISOString());
      showToast(`同期コードを発行しました：${code}`, "#4ade80");
    } catch(e) {
      showToast("同期コードの発行に失敗しました", "#ef4444");
    }
    setSyncBusy(false);
  }

  async function handlePullSyncCode() {
    const code = syncInput.trim().toLowerCase();
    if (!code) return;
    setSyncBusy(true);
    try {
      const remote = await syncPull(code);
      if (!remote?.data) {
        showToast("そのコードのデータが見つかりません", "#ef4444");
        setSyncBusy(false);
        return;
      }
      applySyncData(remote.data);
      setSyncCode(code);
      setSyncStatus("synced");
      setSyncLastAt(remote.updatedAt || new Date().toISOString());
      setSyncInput("");
      showToast("データを読み込みました🔄", "#60a5fa");
    } catch(e) {
      showToast("読み込みに失敗しました", "#ef4444");
    }
    setSyncBusy(false);
  }

  function handleUnlinkSync() {
    setSyncCode("");
    setSyncStatus("idle");
    setSyncLastAt("");
    showToast("同期を解除しました", "#a8a29e");
  }

  const today    = getLocalDateString();
  const healthCat = CATEGORIES.find(c=>c.id==="health");
  const logXP    = logs.reduce((s,l)=>s+l.xp,0);
  const healthXP = calcHealthXP(healthChecks, healthItems); // 表示用（当日分も含むライブ値）
  const totalXP  = logXP + healthXP;

  const lvInfo   = calcLevel(totalXP);
  const stage    = getCharStage(lvInfo.lv);
  const streak   = calcStreak(logs, healthChecks, shieldDates);
  const ssrBonus = calcSSRBonus(unlocked, equippedChar);

  // ── スキルポイントは「確定済みXP」から算出する ──
  // 体力チェックは当日中は何度でも付け外しできる仕様のため、当日分をそのままSP計算に使うと
  // 「チェックしてSP獲得→ノード解放→チェックを外す」で実際の記録量以上にSPを先取りできてしまう。
  // これを防ぐため、当日分の体力EXPだけを除いた「前日までに確定した総XP」でSPを計算する。
  // ログ（知力・筋力等）は記録した時点で不変のため、この除外は体力カテゴリにのみ影響する。
  const confirmedHealthXP = calcHealthXP(healthChecks, healthItems, today);
  const confirmedTotalXP  = logXP + confirmedHealthXP;
  const confirmedLvInfo   = calcLevel(confirmedTotalXP);
  const totalSP  = Math.floor(confirmedLvInfo.lv / 3) + 1;
  const skillPoints = totalSP - spUsed;

  // 起動時処理：同期プル → ストリーク守護 → ログインボーナス の順で実行する。
  // 先にリモートの最新データを取り込むことで、
  // ①他デバイスで本日分のボーナス受取済みなら二重付与しない
  // ②古いローカル状態が自動プッシュでリモートを上書きする事故を防ぐ
  useEffect(() => {
    (async () => {
      // マウント時点のローカル状態をベースにする（プル成功時はリモートで上書き）
      let base = { logs, healthChecks, shieldCharges, shieldDates, lastLogin };

      if (syncCode) {
        setSyncStatus("syncing");
        try {
          const remote = await syncPull(syncCode);
          if (remote?.data) {
            applySyncData(remote.data);
            setSyncLastAt(remote.updatedAt || new Date().toISOString());
            const d = remote.data;
            base = {
              logs:          d.logs          ?? base.logs,
              healthChecks:  d.healthChecks  ?? base.healthChecks,
              shieldCharges: d.shieldCharges ?? base.shieldCharges,
              shieldDates:   d.shieldDates   ?? base.shieldDates,
              lastLogin:     d.lastLogin !== undefined ? d.lastLogin : base.lastLogin,
            };
          }
          setSyncStatus("synced");
        } catch(e) {
          setSyncStatus("error");
        }
      }

      // 本日分のログインボーナスは受取済み（このデバイス or 他デバイス）
      if (base.lastLogin === today) return;

      // ① ストリーク守護の自動発動判定
      //    最後の活動日〜昨日の空白をチャージで埋め切れる場合のみ発動する。
      //    埋め切れない長期空白の場合はチャージを温存する（無駄撃ち防止）。
      let effectiveShieldDates = base.shieldDates;
      const gaps = getStreakGapDates(base.logs, base.healthChecks, base.shieldDates);
      if (gaps.length > 0 && gaps.length <= base.shieldCharges) {
        effectiveShieldDates = [...base.shieldDates, ...gaps];
        setShieldDates(effectiveShieldDates);
        setShieldCharges(c => Math.max(0, c - gaps.length));
        showToast(`🛡️ ストリーク守護が発動！（${gaps.length}日分をカバー）`, "#a78bfa");
      }

      // ② ログインボーナス（守護発動後のストリークで判定）
      const bridgedStreak = calcStreak(base.logs, base.healthChecks, effectiveShieldDates);
      const newStreak = bridgedStreak > 0 ? bridgedStreak : 1;
      const bonus = getLoginBonus(newStreak);
      setLastLogin(today);
      setGems(g => g + bonus.gems);
      setLoginBonus({ bonus, streak: newStreak });
    })();
  }, []);

  useEffect(() => {
    if (prevLv.current !== null && lvInfo.lv > prevLv.current) {
      setLevelUp({ oldLv: prevLv.current, newLv: lvInfo.lv });
    }
    prevLv.current = lvInfo.lv;
  }, [lvInfo.lv]);

  // ── エクスポート機能 ──
  function exportCSV() {
    const catLabel = id => CATEGORIES.find(c=>c.id===id)?.label ?? id;
    const header = ["日付","カテゴリ","活動内容","時間(分)","EXP"];
    const rows = [...logs]
      .sort((a,b)=>a.date.localeCompare(b.date))
      .map(l => [
        l.date,
        catLabel(l.cat),
        `"${(l.note||"").replace(/"/g,'""')}"`,
        l.min ?? "",
        l.xp,
      ]);
    const bom = "\uFEFF"; // Excel文字化け防止
    const csv = bom + [header, ...rows].map(r=>r.join(",")).join("\n");
    const blob = new Blob([csv], {type:"text/csv;charset=utf-8;"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `life-quest-log-${today}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("CSVをエクスポートしました📄", "#4ade80");
  }

  function exportJSON() {
    const data = {
      exportedAt: new Date().toISOString(),
      logs,
      healthChecks,
      healthItems,
      gems,
      inventory,
      unlocked,
      skillPoints: spUsed,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], {type:"application/json"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `life-quest-backup-${today}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("バックアップをエクスポートしました💾", "#60a5fa");
  }

  function showToast(msg, color="#4f6ef7") {
    setToast({ msg, color });
    setTimeout(() => setToast(null), 2500);
  }

  function grantCharXP(xp) {
    if (!equippedChar || xp <= 0) return;
    setCharXP(prev => ({ ...prev, [equippedChar]: (prev[equippedChar] || 0) + xp }));
  }

  function addLog() {
    const cat   = CATEGORIES.find(c=>c.id===form.cat);
    const xpBonus = calcXPBonus(form.cat, unlocked, Number(form.min)); // スキルツリー由来（加算）
    const gemBonus = calcGemBonus(form.cat, unlocked, equippedChar);

    // ユーザーが「使用」してアクティブ化したxp_multバフのみ適用
    const activeBuff = inventory.find(i=>i.effect?.type==="xp_mult" && i.effect.cat===form.cat && i.active && !i.used);
    const buffBonus = activeBuff ? activeBuff.effect.val - 1 : 0;
    if (activeBuff) {
      setInventory(prev => prev.map(i=>i.uid===activeBuff.uid ? {...i,used:true,active:false}:i));
      showToast(`${activeBuff.label}発動！EXP×${activeBuff.effect.val}倍！`, "#f0c060");
    }
    // 外部ボーナス（装備キャラのパッシブ＋アクティブバフ＋将来のサブスク）はスキルツリーと掛け算で合成する
    const externalBonus = calcExternalXPBonus(form.cat, equippedChar) + buffBonus;
    const totalMult = (1 + xpBonus) * (1 + externalBonus);

    if (cat.mode === "count") {
      // 探索カテゴリ：1日の回数上限チェック
      const todayExploreCount = logs.filter(l=>l.cat===form.cat && l.date===today).length;
      if (todayExploreCount >= EXPLORE_DAILY_LIMIT) {
        const entry = { id:Date.now(), cat:form.cat, min:null, note:form.note, xp:0, date:today, capped:true };
        setLogs(prev => [entry,...prev]);
        setForm(f => ({...f, note:""}));
        showToast(`本日の探索は上限（${EXPLORE_DAILY_LIMIT}回）に達しました。記録のみ保存されます`, "#a8a29e");
        return;
      }
      const xp = Math.floor(cat.baseXP * totalMult);
      const gemsEarned = 2 + gemBonus;
      const entry = { id:Date.now(), cat:form.cat, min:null, note:form.note, xp, date:today };
      setLogs(prev => [entry,...prev]);
      setGems(g => g + gemsEarned);
      grantCharXP(xp);
      setForm(f => ({...f, note:""}));
      showToast(`+${xp} EXP / +${gemsEarned}💎`, cat.color);
      return;
    }

    // 時間ベースカテゴリ：メイン上限＋通勤枠（知力・精神のみ）の二段構え
    const dailyCap = calcDailyCapMinutes(schedule);
    const commuteCap = calcCommuteBonusMinutes(schedule);
    const isCommuteEligible = commuteCap > 0 && COMMUTE_ELIGIBLE_CATS.includes(form.cat);

    const todayTimeLogs = logs.filter(l=>l.date===today && CATEGORIES.find(c=>c.id===l.cat)?.mode==="time");
    const todayMainUsed = todayTimeLogs.reduce((s,l)=>s+(l.creditMainMin ?? l.min ?? 0), 0);
    const todayCommuteUsed = todayTimeLogs
      .filter(l=>COMMUTE_ELIGIBLE_CATS.includes(l.cat))
      .reduce((s,l)=>s+(l.creditCommuteMin ?? 0), 0);

    const mainRemaining = Math.max(0, dailyCap - todayMainUsed);
    const commuteRemaining = isCommuteEligible ? Math.max(0, commuteCap - todayCommuteUsed) : 0;

    const loggedMin = Number(form.min);
    // 通勤枠（知力・精神専用）を先に消費し、余った分だけ共有のメイン枠から引く。
    // 通勤枠は使い切れないと無駄になる一方、メイン枠は他カテゴリ（筋力・創造）とも共有のため、
    // 先にメイン枠を消費すると通勤枠が無駄になりやすい。専用枠から優先消費するのが全体最適。
    const creditCommuteMin = isCommuteEligible ? Math.min(loggedMin, commuteRemaining) : 0;
    const leftoverAfterCommute = loggedMin - creditCommuteMin;
    const creditMainMin = Math.min(leftoverAfterCommute, mainRemaining);
    const creditedMin = creditMainMin + creditCommuteMin;
    const ratio = loggedMin > 0 ? creditedMin / loggedMin : 0;

    const baseXP = cat.xpRate * creditedMin;
    const xp = Math.floor(baseXP * totalMult);
    const gemsEarned = Math.floor(creditedMin / 15) + (ratio > 0 ? gemBonus : 0);
    const entry = {
      id:Date.now(), cat:form.cat, min:loggedMin, note:form.activity, xp, date:today,
      creditMainMin, creditCommuteMin, capped: ratio < 1,
    };
    setLogs(prev => [entry,...prev]);
    setGems(g => g + gemsEarned);
    grantCharXP(xp);
    setForm(f => ({...f, min:30}));

    if (ratio <= 0) {
      showToast(`本日の記録上限に達しました。休息も大切です🌙`, "#a8a29e");
    } else if (ratio < 1) {
      showToast(`上限に近いため一部のみ加算：+${xp} EXP / +${gemsEarned}💎`, "#f0a850");
    } else if (creditCommuteMin > 0) {
      showToast(`+${xp} EXP / +${gemsEarned}💎（通勤枠を使用）`, cat.color);
    } else if (!activeBuff) {
      showToast(`+${xp} EXP / +${gemsEarned}💎`, cat.color);
    }
  }

  function doGacha(poolId) {
    const pool = GACHA_POOLS[poolId];
    if (gems < pool.cost) { showToast("ルーン石が足りない！", "#ef4444"); return; }
    setGems(g => g - pool.cost);
    setGachaAnim(true);
    setTimeout(() => {
      const item = drawGacha(poolId, ssrBonus, unlocked, ownedChars);
      if (item.type === "character") {
        // キャラクターは消費アイテムではなく、所持キャラクターリストへ追加
        setOwnedChars(prev => prev.includes(item.id) ? prev : [...prev, item.id]);
        showToast(`新しい仲間「${item.name}」を仲間にした！🎉`, "#f0c060");
      } else {
        // すべてのアイテムをインベントリへ（即時消費せず、ユーザーが使うタイミングを選べる）
        setInventory(prev => [...prev, {...item, uid:Date.now()+Math.random(), used:false, active:false}]);
      }
      setGachaResult(item);
      setGachaAnim(false);
    }, 1200);
  }

  function useItem(uid) {
    const item = inventory.find(i=>i.uid===uid);
    if (!item || item.used) return;
    const eff = item.effect;

    if (!eff) {
      // ご褒美アイテム：効果はないが「使用＝現実でそのご褒美を消費した」印として消費する
      setInventory(prev => prev.map(i=>i.uid===uid?{...i,used:true}:i));
      showToast(`「${item.label}」を使用！楽しんできてください🎉`, "#f0c060");
      return;
    }

    if (eff.type === "streak_shield") {
      setInventory(prev => prev.map(i=>i.uid===uid?{...i,used:true}:i));
      setShieldCharges(c => c + (eff.val || 1));
      showToast("🛡️ ストリーク守護をチャージ！記録できない日があっても自動でカバーします", "#f0c060");

    } else if (eff.type === "gems") {
      setInventory(prev => prev.map(i=>i.uid===uid?{...i,used:true}:i));
      setGems(g => g + eff.val);
      showToast(`${item.label}を使用！💎+${eff.val}`, "#f0c060");

    } else if (eff.type === "bonus_xp") {
      setInventory(prev => prev.map(i=>i.uid===uid?{...i,used:true}:i));
      setLogs(prev => [{id:Date.now(), cat:"study", min:0, note:`${item.label}使用`, xp:eff.val, date:today}, ...prev]);
      showToast(`${item.label}を使用！EXP+${eff.val}`, "#60a5fa");

    } else if (eff.type === "xp_mult") {
      // 同カテゴリの他のアクティブ化済みアイテムは解除してから、これをアクティブ化
      setInventory(prev => prev.map(i => {
        if (i.uid === uid) return {...i, active:true};
        if (i.effect?.type==="xp_mult" && i.effect.cat===eff.cat && !i.used) return {...i, active:false};
        return i;
      }));
      showToast(`${item.label}をセット！次の${CATEGORIES.find(c=>c.id===eff.cat)?.label}記録でEXP×${eff.val}倍`, "#f0c060");
    }
  }


  function addActivity(catId) {
    const label = newActivity.trim();
    if (!label) return;
    setActivities(prev => {
      const list = prev[catId] || [];
      if (list.includes(label)) return prev;
      return { ...prev, [catId]: [...list, label] };
    });
    setForm(f => ({...f, activity:label}));
    setNewActivity("");
  }

  function toggleHealthItem(itemId) {
    const item = healthItems.find(i=>i.id===itemId);
    const itemXP = item?.xp ?? 12;
    setHealthChecks(prev => {
      const todayList = prev[today] || [];
      const isChecked = todayList.includes(itemId);
      let updated;
      if (isChecked) {
        // チェック解除
        updated = todayList.filter(id=>id!==itemId);
      } else if (item?.group) {
        // グループ排他：同じgroupの他項目はその日1つだけ（重複達成防止）
        const others = healthItems.filter(i=>i.group===item.group && i.id!==itemId).map(i=>i.id);
        updated = [...todayList.filter(id=>!others.includes(id)), itemId];
        showToast(`+${itemXP} EXP 獲得！`, healthCat.color);
        grantCharXP(itemXP);
      } else {
        updated = [...todayList, itemId];
        showToast(`+${itemXP} EXP 獲得！`, healthCat.color);
        grantCharXP(itemXP);
      }
      return { ...prev, [today]: updated };
    });
  }

  function deleteHealthItem(itemId) {
    // デフォルト項目は削除不可（ユーザーが独自に追加したカスタム項目のみ削除できる）
    if (DEFAULT_HEALTH_ITEMS.some(d => d.id === itemId)) return;
    setHealthItems(prev => prev.filter(i => i.id !== itemId));
    setHealthChecks(prev => {
      const updated = {};
      for (const [date, ids] of Object.entries(prev)) updated[date] = ids.filter(id=>id!==itemId);
      return updated;
    });
  }

  function addHealthItem() {
    const label = newHabit.trim();
    if (!label) return;
    const id = "h" + Date.now();
    const diff = HEALTH_DIFFICULTY[newHabitDiff] ?? HEALTH_DIFFICULTY.normal;
    setHealthItems(prev => [...prev, { id, label, icon:"⭐", difficulty:newHabitDiff, xp:diff.xp }]);
    setNewHabit("");
    setNewHabitDiff("normal");
  }

  function unlockSkill(nodeId) {
    if (skillPoints <= 0) return;
    const node = Object.values(SKILL_TREE).flat().find(n => n.id === nodeId);
    setUnlocked(prev => [...prev, nodeId]);
    setSpUsed(prev => prev + 1);
    if (node?.type === "streak") {
      setShieldCharges(c => c + (node.val || 1));
      showToast("スキル解放！🛡️ ストリーク守護をチャージ", "#f0c060");
    } else {
      showToast("スキル解放！", "#f0c060");
    }
  }

  const todayLogs   = logs.filter(l=>l.date===today);
  const todayMin    = todayLogs.reduce((s,l)=>s+(l.min||0),0);
  const todayHealthChecked = healthChecks[today] || [];
  const todayHealthXP = todayHealthChecked.reduce((s,id)=>{
    const item = healthItems.find(i=>i.id===id);
    return s + (item?.xp ?? 12);
  }, 0);
  const todayXP     = todayLogs.reduce((s,l)=>s+l.xp,0) + todayHealthXP;
  const catStats  = CATEGORIES.filter(c=>c.mode!=="check").map(c=>({
    ...c,
    total: logs.filter(l=>l.cat===c.id).reduce((s,l)=>s+(l.min||0),0),
    count: logs.filter(l=>l.cat===c.id).length,
    xp:    logs.filter(l=>l.cat===c.id).reduce((s,l)=>s+l.xp,0),
  }));
  const maxMin = Math.max(...catStats.filter(c=>c.mode==="time").map(c=>c.total),1);
  const maxCount = Math.max(...catStats.filter(c=>c.mode==="count").map(c=>c.count),1);

  // 過去14日間の日別カテゴリ別時間集計（時系列グラフ用）
  const HIST_DAYS = 14;
  const histDates = Array.from({length:HIST_DAYS}, (_,i) => {
    const d = new Date();
    d.setDate(d.getDate() - (HIST_DAYS - 1 - i));
    return getLocalDateString(d);
  });
  const timeCats = CATEGORIES.filter(c=>c.mode==="time");
  const dailyHistory = histDates.map(date => {
    const dayLogs = logs.filter(l=>l.date===date);
    const byCat = {};
    timeCats.forEach(c => {
      byCat[c.id] = dayLogs.filter(l=>l.cat===c.id).reduce((s,l)=>s+(l.min||0),0);
    });
    const dayTotal = Object.values(byCat).reduce((s,v)=>s+v,0);
    return { date, byCat, total: dayTotal };
  });
  const maxDayTotal = Math.max(...dailyHistory.map(d=>d.total), 1);

  // 全期間累計（カテゴリ別、ドーナツグラフ用）
  const allTimeTotal = timeCats.reduce((s,c)=>s + catStats.find(cs=>cs.id===c.id).total, 0);
  let donutCursor = 0;
  const donutSegments = timeCats.map(c => {
    const val = catStats.find(cs=>cs.id===c.id).total;
    const pct = allTimeTotal > 0 ? val / allTimeTotal : 0;
    const startAngle = donutCursor * 360;
    donutCursor += pct;
    const endAngle = donutCursor * 360;
    return { ...c, val, pct, startAngle, endAngle };
  });
  function polarToXY(cx, cy, r, angleDeg) {
    const a = (angleDeg - 90) * Math.PI / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  }
  function donutArcPath(cx, cy, rOuter, rInner, startAngle, endAngle) {
    if (endAngle - startAngle >= 359.99) endAngle = startAngle + 359.99;
    const large = endAngle - startAngle > 180 ? 1 : 0;
    const [x1,y1] = polarToXY(cx, cy, rOuter, startAngle);
    const [x2,y2] = polarToXY(cx, cy, rOuter, endAngle);
    const [x3,y3] = polarToXY(cx, cy, rInner, endAngle);
    const [x4,y4] = polarToXY(cx, cy, rInner, startAngle);
    return `M ${x1} ${y1} A ${rOuter} ${rOuter} 0 ${large} 1 ${x2} ${y2} L ${x3} ${y3} A ${rInner} ${rInner} 0 ${large} 0 ${x4} ${y4} Z`;
  }


  const pct = Math.min((lvInfo.current/lvInfo.needed)*100,100);

  // ── inline styles ─────────────────────────────────────
  const BG     = "#f0ede8";
  const PANEL  = "rgba(255,252,248,0.96)";
  const BORDER = "rgba(99,102,241,0.18)";
  const CYAN   = "#4f6ef7";
  const GOLD   = "#c47f17";

  const glassCard = {
    background: PANEL,
    border: `1px solid ${BORDER}`,
    borderRadius: 16,
    backdropFilter: "blur(12px)",
    boxShadow: "0 2px 16px rgba(99,102,241,0.07)",
  };

  return (
    <div style={{
      minHeight:"100vh", background:BG, color:"#1e1b2e",
      fontFamily:"'SF Pro Display',-apple-system,BlinkMacSystemFont,'Hiragino Sans',sans-serif",
      display:"flex", flexDirection:"column", maxWidth:430, margin:"0 auto",
      position:"relative", overflow:"hidden",
    }}>
      <style>{`
        * { box-sizing:border-box; }
        ::-webkit-scrollbar { display:none; }
        input,select,textarea { font-family:inherit; }
        @keyframes lvup { from{transform:scale(.5) translateY(40px);opacity:0} to{transform:scale(1) translateY(0);opacity:1} }
        @keyframes fadeup { from{transform:translateY(16px);opacity:0} to{transform:translateY(0);opacity:1} }
        @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes float0 { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-8px)} }
        @keyframes float1 { 0%,100%{transform:translateY(-4px)} 50%{transform:translateY(6px)} }
        @keyframes float2 { 0%,100%{transform:translateY(4px)} 50%{transform:translateY(-6px)} }
        @keyframes scanline { 0%{transform:translateY(-100%)} 100%{transform:translateY(100vh)} }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }
        @keyframes toastIn { from{transform:translateX(120%);opacity:0} to{transform:translateX(0);opacity:1} }
        @keyframes gachaSpin { 0%{transform:rotate(0deg) scale(1)} 50%{transform:rotate(180deg) scale(1.3)} 100%{transform:rotate(360deg) scale(1)} }
        @keyframes resultPop { from{transform:scale(0.3) rotate(-10deg);opacity:0} to{transform:scale(1) rotate(0deg);opacity:1} }
        @keyframes bonusIn { from{transform:translateY(-30px);opacity:0} to{transform:translateY(0);opacity:1} }
      `}</style>

      {/* scan-line effect */}
      <div style={{
        position:"fixed",inset:0,pointerEvents:"none",zIndex:0,overflow:"hidden",
      }}>
        <div style={{
          position:"absolute",top:0,left:0,right:0,height:"2px",
          background:`linear-gradient(transparent,${CYAN}18,transparent)`,
          animation:"scanline 8s linear infinite",
        }}/>
      </div>

      {/* ── HEADER ── */}
      <div style={{
        position:"sticky",top:0,zIndex:50,
        background:`linear-gradient(180deg,${BG} 70%,transparent)`,
        padding:"16px 20px 10px",
      }}>
        {/* top bar */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
          <div>
            <div style={{fontSize:9,letterSpacing:5,color:CYAN,marginBottom:2}}>LIFE QUEST</div>
            <div style={{fontSize:18,fontWeight:800,letterSpacing:-0.3,lineHeight:1}}>
              {getTitle(lvInfo.lv)}
            </div>
          </div>
          {/* gems counter */}
          <div onClick={()=>setTab("gacha")} style={{
            display:"flex",alignItems:"center",gap:5,cursor:"pointer",
            background:"linear-gradient(135deg,#fef3c7,#fde68a)",
            border:"1px solid #f0c060",borderRadius:999,
            padding:"5px 12px",
          }}>
            <span style={{fontSize:14}}>💎</span>
            <span style={{fontWeight:800,fontSize:14,color:"#92400e"}}>{gems}</span>
          </div>
          <div style={{textAlign:"right"}}>
            <div style={{fontSize:9,color:"#57534e",letterSpacing:3}}>RANK</div>
            <div style={{
              fontSize:34,fontWeight:900,lineHeight:1,color:stage.primaryColor,
              textShadow:`0 0 20px ${stage.primaryColor}88`,
            }}>
              {lvInfo.lv}
            </div>
          </div>
        </div>

        {/* XP bar */}
        <div style={{position:"relative",height:4,background:"#e2ddd6",borderRadius:999,overflow:"visible"}}>
          <div style={{
            position:"absolute",top:0,left:0,height:"100%",borderRadius:999,
            width:`${pct}%`,
            background:`linear-gradient(90deg,${stage.accentColor},${stage.primaryColor})`,
            boxShadow:`0 0 12px ${stage.primaryColor}`,
            transition:"width .8s cubic-bezier(.4,0,.2,1)",
          }}/>
          {/* marker dot */}
          <div style={{
            position:"absolute",top:"50%",left:`${pct}%`,
            transform:"translate(-50%,-50%)",
            width:8,height:8,borderRadius:"50%",
            background:stage.primaryColor,
            boxShadow:`0 0 8px ${stage.primaryColor}`,
            transition:"left .8s cubic-bezier(.4,0,.2,1)",
          }}/>
        </div>
        <div style={{display:"flex",justifyContent:"space-between",fontSize:9,color:"#78716c",marginTop:4}}>
          <span>EXP {lvInfo.current.toLocaleString()}</span>
          <span>SP {skillPoints} | NEXT {lvInfo.needed.toLocaleString()}</span>
        </div>
      </div>

      {/* ── CONTENT ── */}
      <div style={{flex:1,overflowY:"auto",padding:"0 14px 100px",position:"relative",zIndex:1}}>

        {/* HOME */}
        {tab==="home" && (
          <div style={{display:"flex",flexDirection:"column",gap:12,animation:"fadeup .3s ease"}}>

            {/* mini char preview */}
            <div style={{
              ...glassCard,
              background: equippedChar && GACHA_CHARACTERS.find(c=>c.id===equippedChar)
                ? "linear-gradient(160deg,#fffbeb 0%,#faf8f5 100%)"
                : `linear-gradient(160deg,${stage.primaryColor}14 0%,#faf8f5 100%)`,
              border: equippedChar && GACHA_CHARACTERS.find(c=>c.id===equippedChar)
                ? "1px solid #fbbf2455"
                : `1px solid ${stage.primaryColor}30`,
              padding:"20px",
              display:"flex",gap:16,alignItems:"center",
            }}>
              <div style={{width:96,height:128,flexShrink:0}}>
                {(() => {
                  const eqData = GACHA_CHARACTERS.find(c=>c.id===equippedChar);
                  if (eqData) {
                    return (
                      <img src={getCharacterStageImage(eqData, calcCharLevel(charXP[eqData.id]||0).lv)} alt={eqData.name} style={{
                        width:"100%",height:"100%",objectFit:"contain",
                        filter:"drop-shadow(0 4px 12px #fbbf2455)",
                      }} onError={e=>{e.target.style.display="none";}}/>
                    );
                  }
                  return <CharacterSVG stage={stage} lv={lvInfo.lv} animated={true}/>;
                })()}
              </div>
              <div style={{flex:1}}>
                {(() => {
                  const eqData = GACHA_CHARACTERS.find(c=>c.id===equippedChar);
                  if (eqData) {
                    return (
                      <>
                        <div style={{fontSize:9,color:"#a16207",letterSpacing:3,marginBottom:4}}>EQUIPPED</div>
                        <div style={{fontSize:22,fontWeight:800,marginBottom:2}}>{eqData.name}</div>
                        <div style={{fontSize:11,color:"#78716c",marginBottom:12}}>★★★ UR</div>
                      </>
                    );
                  }
                  return (
                    <>
                      <div style={{fontSize:9,color:stage.primaryColor,letterSpacing:3,marginBottom:4}}>{stage.name.toUpperCase()}</div>
                      <div style={{fontSize:22,fontWeight:800,marginBottom:2}}>{stage.title_ja}</div>
                      <div style={{fontSize:11,color:"#78716c",marginBottom:12}}>{'★'.repeat(stage.rarity)}{'☆'.repeat(5-stage.rarity)}</div>
                    </>
                  );
                })()}
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
                  {[
                    {v:todayLogs.length, u:"本日の記録"},
                    {v:streak,           u:"日連続"},
                    {v:todayXP,          u:"本日EXP"},
                  ].map(({v,u})=>(
                    <div key={u}>
                      <div style={{fontSize:20,fontWeight:800,color:stage.primaryColor}}>{v}</div>
                      <div style={{fontSize:9,color:"#57534e"}}>{u}</div>
                    </div>
                  ))}
                </div>
                {shieldCharges > 0 && (
                  <div style={{marginTop:8,fontSize:10,color:"#8b5cf6",fontWeight:700}}>
                    🛡️ ストリーク守護 ×{shieldCharges}（記録できない日を自動でカバー）
                  </div>
                )}
              </div>
            </div>

            {/* activity feed */}
            <div style={{...glassCard,padding:"16px"}}>
              <div style={{fontSize:9,letterSpacing:4,color:CYAN,marginBottom:12}}>RECENT LOGS</div>
              {logs.length===0 && (
                <div style={{textAlign:"center",color:"#c5bfb8",padding:"32px 0",fontSize:13}}>
                  まだ記録なし<br/>
                  <span style={{fontSize:11,color:"#ddd8d0"}}>LOG タブから始めよう</span>
                </div>
              )}
              {logs.slice(0,6).map(l => {
                const cat = CATEGORIES.find(c=>c.id===l.cat);
                return (
                  <div key={l.id} style={{
                    display:"flex",alignItems:"center",gap:12,
                    padding:"10px 0",borderBottom:"1px solid #e8e3db",
                  }}>
                    <div style={{
                      width:38,height:38,borderRadius:10,flexShrink:0,
                      background:`${cat.color}18`,border:`1px solid ${cat.color}40`,
                      display:"flex",alignItems:"center",justifyContent:"center",
                      fontSize:16,color:cat.color,
                    }}>{cat.icon}</div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontWeight:600,fontSize:13,display:"flex",gap:6,alignItems:"center"}}>
                        <span style={{color:cat.color,fontSize:9,letterSpacing:2}}>{cat.en}</span>
                        {l.note && <span style={{color:"#57534e",fontWeight:400,fontSize:12}}>· {l.note}</span>}
                      </div>
                      <div style={{fontSize:10,color:"#78716c",marginTop:2}}>{l.date}</div>
                    </div>
                    <div style={{textAlign:"right",flexShrink:0}}>
                      {l.min != null ? (
                        <div style={{fontWeight:700,fontSize:13,color:cat.color}}>{l.min}<span style={{fontSize:9,color:"#78716c"}}>min</span></div>
                      ) : (
                        <div style={{fontWeight:700,fontSize:13,color:cat.color}}>1<span style={{fontSize:9,color:"#78716c"}}>回</span></div>
                      )}
                      <div style={{fontSize:10,color:"#57534e"}}>+{l.xp} EXP</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* CHARACTER */}
        {tab==="character" && (() => {
          const equippedData = GACHA_CHARACTERS.find(c => c.id === equippedChar);
          return (
          <div style={{animation:"fadeup .3s ease"}}>
            {/* full character display */}
            <div style={{
              ...glassCard,
              background: equippedData
                ? "linear-gradient(180deg,#fffbeb 0%,#faf8f5 60%)"
                : `linear-gradient(180deg,${stage.primaryColor}18 0%,#faf8f5 60%)`,
              border: equippedData ? "1px solid #fbbf2455" : `1px solid ${stage.primaryColor}40`,
              padding:"24px 20px",marginBottom:12,
              position:"relative",overflow:"hidden",
            }}>
              {/* bg grid */}
              <div style={{
                position:"absolute",inset:0,opacity:0.06,
                backgroundImage:`linear-gradient(${equippedData?"#fbbf24":stage.primaryColor} 1px,transparent 1px),linear-gradient(90deg,${equippedData?"#fbbf24":stage.primaryColor} 1px,transparent 1px)`,
                backgroundSize:"20px 20px",
              }}/>

              {equippedData ? (
                <>
                  <div style={{textAlign:"center",fontSize:14,marginBottom:4,color:"#f0c060",textShadow:"0 0 8px #f0c060"}}>
                    ★★★ UR
                  </div>
                  <div style={{height:300,position:"relative",zIndex:1,display:"flex",alignItems:"center",justifyContent:"center"}}>
                    <img src={getCharacterStageImage(equippedData, calcCharLevel(charXP[equippedData.id]||0).lv)} alt={equippedData.name} style={{
                      maxHeight:"100%",maxWidth:"100%",objectFit:"contain",
                      filter:"drop-shadow(0 8px 24px #fbbf2455)",
                    }} onError={e=>{e.target.style.display="none";}}/>
                  </div>
                  <div style={{textAlign:"center",position:"relative",zIndex:1,marginTop:8}}>
                    <div style={{fontSize:9,letterSpacing:5,color:"#a16207"}}>EQUIPPED CHARACTER</div>
                    <div style={{fontSize:28,fontWeight:900,margin:"4px 0"}}>{equippedData.name}</div>
                    {(() => {
                      const cLv = calcCharLevel(charXP[equippedData.id]||0);
                      return (
                        <div style={{fontSize:11,color:"#a16207",marginBottom:6,fontWeight:700}}>
                          キャラLv.{cLv.lv}{cLv.isMax ? " (MAX)" : ""}
                        </div>
                      );
                    })()}
                    <div style={{
                      display:"inline-block",padding:"3px 16px",borderRadius:999,
                      background:"#fef3c722",border:"1px solid #fbbf2455",
                      fontSize:11,color:"#a16207",
                    }}>{equippedData.passiveDesc}</div>
                  </div>
                  <div style={{textAlign:"center",marginTop:14,position:"relative",zIndex:1}}>
                    <button onClick={()=>{setEquippedChar(""); showToast("基本キャラクターに戻しました","#a8a29e");}} style={{
                      padding:"8px 20px",borderRadius:10,border:"1px solid #d6d3d1",cursor:"pointer",
                      background:"#fff",color:"#78716c",fontWeight:700,fontSize:12,
                    }}>基本キャラクターに戻す</button>
                  </div>
                </>
              ) : (
                <>
                  {/* rarity stars */}
                  <div style={{textAlign:"center",fontSize:14,marginBottom:4,
                    color:GOLD,textShadow:`0 0 8px ${GOLD}`}}>
                    {'★'.repeat(stage.rarity)}
                  </div>

                  <div style={{height:300,position:"relative",zIndex:1}}>
                    <CharacterSVG stage={stage} lv={lvInfo.lv} animated={true}/>
                  </div>

                  <div style={{textAlign:"center",position:"relative",zIndex:1,marginTop:8}}>
                    <div style={{fontSize:9,letterSpacing:5,color:stage.primaryColor}}>{stage.name.toUpperCase()}</div>
                    <div style={{fontSize:28,fontWeight:900,margin:"4px 0"}}>{stage.title_ja}</div>
                    <div style={{
                      display:"inline-block",padding:"3px 16px",borderRadius:999,
                      background:`${stage.primaryColor}22`,border:`1px solid ${stage.primaryColor}55`,
                      fontSize:11,color:stage.primaryColor,
                    }}>Lv.{lvInfo.lv} · {getTitle(lvInfo.lv)}</div>
                  </div>
                </>
              )}
            </div>

            {/* stat grid */}
            <div style={{...glassCard,padding:"16px",marginBottom:12}}>
              <div style={{fontSize:9,letterSpacing:4,color:CYAN,marginBottom:12}}>CHARACTER STATS</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                {[
                  { label:"総EXP",       v:totalXP.toLocaleString(),   color:CYAN },
                  { label:"総活動時間",   v:`${logs.reduce((s,l)=>s+(l.min||0),0)}min`, color:GOLD },
                  { label:"記録回数",     v:logs.length,                color:"#a78bfa" },
                  { label:"最高連続日数", v:`${streak}日`,              color:"#fb923c" },
                  { label:"スキル解放数", v:`${unlocked.length}個`,     color:"#4ade80" },
                  { label:"スキルポイント",v:`${skillPoints}SP`,        color:GOLD },
                ].map(({label,v,color})=>(
                  <div key={label} style={{
                    background:"#f5f2ee",borderRadius:10,padding:"10px 12px",
                    border:"1px solid #ddd8d0",
                  }}>
                    <div style={{fontSize:9,color:"#78716c",letterSpacing:2,marginBottom:4}}>{label}</div>
                    <div style={{fontSize:18,fontWeight:800,color}}>{v}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* next ascension */}
            {(() => {
              const next = CHAR_STAGES.find(s=>s.minLv>lvInfo.lv);
              if (!next) return null;
              return (
                <div style={{...glassCard,padding:"14px 16px",border:`1px solid ${next.primaryColor}30`,marginBottom:12}}>
                  <div style={{fontSize:9,letterSpacing:3,color:next.primaryColor,marginBottom:8}}>NEXT ASCENSION</div>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <div>
                      <div style={{fontWeight:700}}>{next.title_ja} <span style={{fontSize:9,color:"#78716c"}}>({next.name})</span></div>
                      <div style={{fontSize:10,color:"#57534e",marginTop:2}}>Lv.{next.minLv} で解放</div>
                    </div>
                    <div style={{fontSize:22,color:next.primaryColor}}>
                      {'★'.repeat(next.rarity)}
                    </div>
                  </div>
                  <div style={{marginTop:10,height:3,background:"#e2ddd6",borderRadius:999,overflow:"hidden"}}>
                    <div style={{
                      height:"100%",background:`linear-gradient(90deg,${next.accentColor},${next.primaryColor})`,
                      width:`${Math.min((lvInfo.lv/next.minLv)*100,100)}%`,
                      borderRadius:999,transition:"width .6s ease",
                    }}/>
                  </div>
                  <div style={{fontSize:9,color:"#78716c",marginTop:4,textAlign:"right"}}>
                    Lv.{lvInfo.lv} / {next.minLv}
                  </div>
                </div>
              );
            })()}

            {/* ── ガチャキャラクター図鑑 ── */}
            <div style={{...glassCard,padding:"16px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                <div style={{fontSize:9,letterSpacing:3,color:"#a16207"}}>CHARACTER COLLECTION</div>
                <div style={{
                  fontSize:11,fontWeight:700,color:"#a16207",
                  background:"#fef3c7",padding:"3px 10px",borderRadius:999,
                }}>{ownedChars.length}/{GACHA_CHARACTERS.length}</div>
              </div>
              <div style={{fontSize:11,color:"#78716c",marginBottom:14}}>
                ガチャで低確率入手できる特別な仲間たち。装備すると見た目とパッシブ効果が切り替わる。
              </div>

              {GACHA_CHARACTERS.length === 0 ? (
                <div style={{fontSize:11,color:"#a8a29e",textAlign:"center",padding:"16px 0"}}>
                  まだキャラクターが登録されていません
                </div>
              ) : (
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(88px, 1fr))",gap:10}}>
                  {GACHA_CHARACTERS.map(c => {
                    const owned = ownedChars.includes(c.id);
                    const isEquipped = equippedChar === c.id;
                    return (
                      <div key={c.id}
                        onClick={()=>setCharDetail({char:c, owned})}
                        style={{
                        aspectRatio:"0.8",borderRadius:14,cursor:"pointer",padding:"8px 6px",
                        display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"flex-end",
                        position:"relative",overflow:"hidden",
                        background: owned ? "linear-gradient(160deg,#fffbeb,#fef3c7)" : "#ece8e2",
                        border: isEquipped ? "2px solid #fbbf24" : owned ? "1.5px solid #fbbf2466" : "1.5px solid #ddd8d0",
                      }}>
                        {owned ? (
                          <>
                            <img src={getCharacterStageImage(c, calcCharLevel(charXP[c.id]||0).lv)} alt={c.name} style={{
                              position:"absolute",top:4,left:0,right:0,height:"65%",
                              objectFit:"contain",margin:"0 auto",
                            }} onError={e=>{e.target.style.display="none";}}/>
                            <span style={{
                              position:"absolute",top:4,left:4,fontSize:8,fontWeight:800,
                              color:"#78350f",background:"#fef3c7",padding:"1px 5px",borderRadius:4,
                            }}>Lv{calcCharLevel(charXP[c.id]||0).lv}</span>
                          </>
                        ) : (
                          <span style={{position:"absolute",top:"25%",fontSize:22,color:"#a8a29e"}}>?</span>
                        )}
                        <div style={{fontSize:9,fontWeight:700,textAlign:"center",
                          color: owned ? "#78350f" : "#a8a29e", zIndex:1}}>
                          {owned ? c.name : "？？？"}
                        </div>
                        {isEquipped && (
                          <span style={{
                            position:"absolute",top:4,right:4,fontSize:8,fontWeight:800,
                            color:"#92400e",background:"#fde68a",padding:"1px 6px",borderRadius:4,
                          }}>装備中</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
          );
        })()}


        {/* RECORD */}
        {tab==="record" && (() => {
          const selCat = CATEGORIES.find(c=>c.id===form.cat);
          const dailyCap = calcDailyCapMinutes(schedule);
          const commuteCap = calcCommuteBonusMinutes(schedule);
          const todayTimeLogs = logs.filter(l=>l.date===today && CATEGORIES.find(c=>c.id===l.cat)?.mode==="time");
          const todayMinUsed = todayTimeLogs.reduce((s,l)=>s+(l.creditMainMin ?? l.min ?? 0), 0);
          const todayCommuteUsed = todayTimeLogs
            .filter(l=>COMMUTE_ELIGIBLE_CATS.includes(l.cat))
            .reduce((s,l)=>s+(l.creditCommuteMin ?? 0), 0);
          const remainingMin = Math.max(0, dailyCap - todayMinUsed);
          const commuteRemaining = Math.max(0, commuteCap - todayCommuteUsed);
          const capPct = Math.min((todayMinUsed / dailyCap) * 100, 100);
          const commutePct = commuteCap > 0 ? Math.min((todayCommuteUsed / commuteCap) * 100, 100) : 0;
          return (
          <div style={{animation:"fadeup .3s ease"}}>
            {/* ── 本日の残り記録可能時間 ── */}
            <div style={{...glassCard,padding:"10px 14px",marginBottom:8}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
                <div style={{display:"flex",alignItems:"center",gap:6}}>
                  <span style={{fontSize:9,letterSpacing:2,color:"#78716c"}}>本日の記録可能時間</span>
                  <button onClick={()=>setShowScheduleModal(true)} style={{
                    border:"none",background:"none",cursor:"pointer",padding:0,
                    fontSize:10,color:CYAN,textDecoration:"underline",
                  }}>設定</button>
                </div>
                <span style={{fontSize:11,fontWeight:700,color: remainingMin<=0?"#ef4444":"#57534e"}}>
                  残り{remainingMin}分 / {dailyCap}分
                </span>
              </div>
              <div style={{height:5,background:"#e8e3db",borderRadius:999,overflow:"hidden"}}>
                <div style={{
                  height:"100%",
                  background: capPct>=100 ? "#ef4444" : capPct>=80 ? "#f0a850" : "linear-gradient(90deg,#4f6ef7,#7c93ff)",
                  width:`${capPct}%`,borderRadius:999,transition:"width .4s ease",
                }}/>
              </div>
              {commuteCap > 0 && (
                <>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",margin:"6px 0 4px"}}>
                    <span style={{fontSize:9,letterSpacing:2,color:"#78716c"}}>通勤枠（知力・精神）</span>
                    <span style={{fontSize:10,fontWeight:700,color:"#78716c"}}>
                      残り{commuteRemaining}分 / {commuteCap}分
                    </span>
                  </div>
                  <div style={{height:5,background:"#e8e3db",borderRadius:999,overflow:"hidden"}}>
                    <div style={{
                      height:"100%",
                      background: commutePct>=100 ? "#ef4444" : "linear-gradient(90deg,#a78bfa,#c4b5fd)",
                      width:`${commutePct}%`,borderRadius:999,transition:"width .4s ease",
                    }}/>
                  </div>
                </>
              )}
              {remainingMin<=0 && (
                <div style={{fontSize:10,color:"#ef4444",marginTop:5}}>
                  本日の上限に達しました。無理せず休息も大切な時間です🌙
                </div>
              )}
            </div>

            {(() => {
              const activeBuff = inventory.find(i=>i.effect?.type==="xp_mult" && i.effect.cat===form.cat && i.active && !i.used);
              return activeBuff && (
                <div style={{
                  ...glassCard,padding:"10px 14px",marginBottom:10,
                  background:"linear-gradient(135deg,#ecfdf5,#d1fae5)",
                  border:"1px solid #34d399",
                  display:"flex",alignItems:"center",gap:8,
                }}>
                  <span style={{fontSize:18}}>{activeBuff.icon}</span>
                  <span style={{fontSize:12,fontWeight:700,color:"#047857"}}>
                    {activeBuff.label}セット中 — 次の記録でEXP×{activeBuff.effect.val}倍！
                  </span>
                </div>
              );
            })()}
            <div style={{...glassCard,padding:"16px",marginBottom:12}}>
              <div style={{fontSize:9,letterSpacing:4,color:CYAN,marginBottom:10}}>NEW LOG</div>

              {/* category selector: 3×2グリッド（全カテゴリ同時表示） */}
              <div style={{display:"grid",gridTemplateColumns:"repeat(3, 1fr)",gap:6,marginBottom:8}}>
                {CATEGORIES.map(c => {
                  const sel = form.cat===c.id;
                  return (
                    <button key={c.id} onClick={()=>setForm(f=>({...f,cat:c.id,activity:""}))} style={{
                      display:"flex",flexDirection:"column",alignItems:"center",gap:3,
                      padding:"8px 4px",borderRadius:12,border:"none",cursor:"pointer",
                      background: sel ? `${c.color}18` : "#faf8f5",
                      outline: sel ? `1.5px solid ${c.color}` : "1.5px solid #e8e3db",
                    }}>
                      <span style={{
                        width:28,height:28,borderRadius:8,
                        background:`${c.color}22`,display:"flex",alignItems:"center",justifyContent:"center",
                        fontSize:14,color:c.color,
                      }}>{c.icon}</span>
                      <span style={{fontSize:10,fontWeight:700,color:sel?c.color:"#78716c"}}>{c.label}</span>
                    </button>
                  );
                })}
              </div>
              {/* 選択中カテゴリのレート/ボーナスを1行だけ表示 */}
              {(() => {
                const skillB = calcXPBonus(selCat.id, unlocked);
                const extB = calcExternalXPBonus(selCat.id, equippedChar);
                const bonus = (1+skillB)*(1+extB) - 1;
                const subtext = selCat.mode==="time"
                  ? `×${selCat.xpRate} EXP/min${bonus>0?` (+${Math.round(bonus*100)}%)`:""}`
                  : selCat.mode==="count"
                  ? `${selCat.baseXP} EXP/回${bonus>0?` (+${Math.round(bonus*100)}%)`:""}`
                  : `項目ごとにEXPが変動`;
                return (
                  <div style={{fontSize:10,color:"#a8a29e",marginBottom:16,paddingLeft:2}}>{subtext}</div>
                );
              })()}

              {/* ── TIME MODE ── */}
              {selCat.mode === "time" && (
                <>
                  <div style={{marginBottom:12}}>
                    <div style={{display:"flex",gap:6,alignItems:"center"}}>
                      <div style={{display:"flex",gap:5,flexWrap:"wrap",flex:1}}>
                        {[15,30,45,60,90,120].map(m=>(
                          <button key={m} onClick={()=>setForm(f=>({...f,min:m}))} style={{
                            padding:"6px 10px",borderRadius:8,border:"none",cursor:"pointer",
                            background: form.min===m ? selCat.color+"33" : "#f5f2ee",
                            outline: form.min===m ? `1px solid ${selCat.color}` : "1px solid #ddd8d0",
                            color: form.min===m ? "#1e1b2e" : "#57534e",
                            fontSize:12,fontWeight:600,
                          }}>{m}</button>
                        ))}
                      </div>
                      <input type="number" value={form.min} min={1} max={480}
                        onChange={e=>setForm(f=>({...f,min:Number(e.target.value)}))}
                        style={{
                          width:64,padding:"8px 8px",borderRadius:9,textAlign:"center",
                          border:"1px solid #ddd8d0",background:"#faf8f5",
                          color:"#1e1b2e",fontSize:14,outline:"none",flexShrink:0,
                        }}/>
                    </div>
                  </div>

                  <div style={{marginBottom:16}}>
                    <div style={{display:"flex",gap:6}}>
                      <select value={form.activity}
                        onChange={e=>setForm(f=>({...f,activity:e.target.value}))}
                        style={{
                          flex:1,padding:"10px 12px",borderRadius:10,
                          border:"1px solid #ddd8d0",background:"#faf8f5",
                          color: form.activity ? "#1e1b2e" : "#a8a29e",
                          fontSize:14,outline:"none",
                          appearance:"none",WebkitAppearance:"none",
                        }}>
                        <option value="">活動内容を選択…</option>
                        {(activities[form.cat]||[]).map(a=>(
                          <option key={a} value={a}>{a}</option>
                        ))}
                      </select>
                      <button onClick={()=>setShowAddActivity(v=>!v)} style={{
                        width:40,flexShrink:0,borderRadius:10,border:"1px solid #ddd8d0",
                        background: showAddActivity ? selCat.color+"22" : "#faf8f5",
                        color: showAddActivity ? selCat.color : "#78716c",
                        fontSize:16,cursor:"pointer",fontWeight:700,
                      }}>+</button>
                    </div>
                    {showAddActivity && (
                      <div style={{display:"flex",gap:8,marginTop:8}}>
                        <input value={newActivity} onChange={e=>setNewActivity(e.target.value)}
                          onKeyDown={e=>{ if(e.key==="Enter") { addActivity(form.cat); setShowAddActivity(false); } }}
                          placeholder="新しい項目を追加…"
                          autoFocus
                          style={{
                            flex:1,padding:"9px 12px",borderRadius:9,
                            border:"1px solid #ddd8d0",background:"#fff",
                            color:"#1e1b2e",fontSize:13,outline:"none",
                          }}/>
                        <button onClick={()=>{addActivity(form.cat); setShowAddActivity(false);}} style={{
                          padding:"9px 16px",borderRadius:9,border:"none",cursor:"pointer",
                          background:selCat.color,color:"#fff",fontWeight:700,fontSize:13,
                        }}>追加</button>
                      </div>
                    )}
                  </div>

                  {(() => {
                    const skillB = calcXPBonus(form.cat, unlocked, Number(form.min));
                    const extB = calcExternalXPBonus(form.cat, equippedChar);
                    const bonus = (1+skillB)*(1+extB) - 1;
                    const baseXP = selCat.xpRate * form.min;
                    const finalXP= Math.floor(baseXP * (1+bonus));
                    return (
                      <div style={{
                        background:`${selCat.color}0d`,border:`1px solid ${selCat.color}30`,
                        borderRadius:12,padding:"9px 16px",display:"flex",
                        justifyContent:"space-between",alignItems:"center",marginBottom:12,
                      }}>
                        <div>
                          <div style={{fontSize:9,color:"#57534e",letterSpacing:2}}>BASE EXP</div>
                          <div style={{fontSize:13,color:"#57534e",textDecoration: bonus>0?"line-through":"none"}}>{baseXP}</div>
                        </div>
                        {bonus > 0 && (
                          <div style={{fontSize:11,color:selCat.color}}>+{Math.round(bonus*100)}% SKILL BONUS</div>
                        )}
                        <div style={{textAlign:"right"}}>
                          <div style={{fontSize:9,color:selCat.color,letterSpacing:2}}>GAIN EXP</div>
                          <div style={{fontSize:24,fontWeight:900,color:selCat.color,
                            textShadow:`0 0 12px ${selCat.color}`}}>+{finalXP}</div>
                        </div>
                      </div>
                    );
                  })()}

                  <button onClick={addLog} disabled={!form.activity} style={{
                    width:"100%",padding:"15px",borderRadius:12,border:"none",
                    cursor: form.activity ? "pointer" : "not-allowed",
                    opacity: form.activity ? 1 : 0.5,
                    background:`linear-gradient(90deg,${selCat.glow},${selCat.color})`,
                    color:"#fff",fontWeight:800,fontSize:14,letterSpacing:3,
                    boxShadow:`0 4px 24px ${selCat.color}40`,
                  }}>SUBMIT LOG</button>
                </>
              )}

              {/* ── COUNT MODE (探索) ── */}
              {selCat.mode === "count" && (
                <>
                  <div style={{marginBottom:20}}>
                    <div style={{fontSize:9,letterSpacing:3,color:"#57534e",marginBottom:8}}>どんな体験をした？</div>
                    <input value={form.note} onChange={e=>setForm(f=>({...f,note:e.target.value}))}
                      placeholder="新しいカフェに行った、初対面の人と話した…"
                      style={{
                        width:"100%",padding:"11px 14px",borderRadius:10,
                        border:"1px solid #ddd8d0",background:"#faf8f5",
                        color:"#1e1b2e",fontSize:14,outline:"none",
                      }}/>
                  </div>

                  {(() => {
                    const skillB = calcXPBonus(form.cat, unlocked);
                    const extB = calcExternalXPBonus(form.cat, equippedChar);
                    const bonus = (1+skillB)*(1+extB) - 1;
                    const finalXP= Math.floor(selCat.baseXP * (1+bonus));
                    return (
                      <div style={{
                        background:`${selCat.color}0d`,border:`1px solid ${selCat.color}30`,
                        borderRadius:12,padding:"12px 16px",display:"flex",
                        justifyContent:"space-between",alignItems:"center",marginBottom:16,
                      }}>
                        <div>
                          <div style={{fontSize:9,color:"#57534e",letterSpacing:2}}>BASE EXP</div>
                          <div style={{fontSize:13,color:"#57534e",textDecoration: bonus>0?"line-through":"none"}}>{selCat.baseXP}</div>
                        </div>
                        {bonus > 0 && (
                          <div style={{fontSize:11,color:selCat.color}}>+{Math.round(bonus*100)}% SKILL BONUS</div>
                        )}
                        <div style={{textAlign:"right"}}>
                          <div style={{fontSize:9,color:selCat.color,letterSpacing:2}}>GAIN EXP</div>
                          <div style={{fontSize:26,fontWeight:900,color:selCat.color,
                            textShadow:`0 0 12px ${selCat.color}`}}>+{finalXP}</div>
                        </div>
                      </div>
                    );
                  })()}

                  <button onClick={addLog} disabled={!form.note.trim()} style={{
                    width:"100%",padding:"15px",borderRadius:12,border:"none",
                    cursor: form.note.trim() ? "pointer" : "not-allowed",
                    opacity: form.note.trim() ? 1 : 0.5,
                    background:`linear-gradient(90deg,${selCat.glow},${selCat.color})`,
                    color:"#fff",fontWeight:800,fontSize:14,letterSpacing:3,
                    boxShadow:`0 4px 24px ${selCat.color}40`,
                  }}>記録する</button>
                </>
              )}

              {/* ── CHECK MODE (体力) ── */}
              {selCat.mode === "check" && (
                <>
                  <div style={{fontSize:9,letterSpacing:3,color:"#57534e",marginBottom:10}}>今日の習慣チェック</div>
                  <div style={{
                    display:"flex",gap:8,alignItems:"flex-start",
                    background:"#f5f2ee",border:"1px solid #e8e3db",borderRadius:10,
                    padding:"10px 12px",marginBottom:12,
                  }}>
                    <span style={{fontSize:13,flexShrink:0}}>ℹ️</span>
                    <span style={{fontSize:10,color:"#78716c",lineHeight:1.6}}>
                      体力のEXPはレベル・キャラ育成にすぐ反映されますが、<b>スキルポイントへの反映のみ翌日に確定</b>します（当日中の付け外しでスキルポイントを先取りできないようにするためです）。
                    </span>
                  </div>
                  <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:16}}>
                    {healthItems.map(item => {
                      const checked = todayHealthChecked.includes(item.id);
                      const isCustom = !DEFAULT_HEALTH_ITEMS.some(d => d.id === item.id);
                      return (
                        <div key={item.id} style={{display:"flex",alignItems:"center",gap:6}}>
                          <button onClick={()=>toggleHealthItem(item.id)} style={{
                            flex:1,display:"flex",alignItems:"center",gap:12,padding:"12px 14px",
                            borderRadius:12,border:"none",cursor:"pointer",textAlign:"left",
                            background: checked ? `${selCat.color}18` : "#faf8f5",
                            outline: checked ? `1.5px solid ${selCat.color}` : "1.5px solid #e8e3db",
                            transition:"all .15s",
                          }}>
                            <span style={{
                              width:28,height:28,borderRadius: item.group ? 999 : 8,flexShrink:0,
                              display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,
                              background: checked ? selCat.color : "#e8e3db",
                              color: checked ? "#fff" : "#a8a29e",
                            }}>{checked ? "✓" : item.icon}</span>
                            <span style={{flex:1,fontSize:13,fontWeight:600,
                              color: checked ? selCat.color : "#44403c"}}>{item.label}</span>
                            <span style={{fontSize:11,color: checked ? selCat.color : "#a8a29e",fontWeight:700}}>
                              +{item.xp ?? 12}
                            </span>
                          </button>
                          {isCustom && (
                            <button onClick={()=>deleteHealthItem(item.id)} style={{
                              width:32,height:32,flexShrink:0,borderRadius:10,border:"1px solid #e8e3db",
                              background:"#faf8f5",color:"#a8a29e",cursor:"pointer",fontSize:14,
                            }}>🗑</button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div style={{fontSize:9,color:"#a8a29e",marginTop:-8,marginBottom:16,lineHeight:1.6}}>
                    ○丸アイコンの項目は「その日一番厳しく達成したレベル」を1つだけ選べます
                  </div>

                  <div style={{display:"flex",gap:6,marginBottom:8}}>
                    {Object.entries(HEALTH_DIFFICULTY).map(([key, d]) => (
                      <button key={key} onClick={()=>setNewHabitDiff(key)} style={{
                        flex:1,padding:"7px 4px",borderRadius:9,cursor:"pointer",
                        border: newHabitDiff===key ? `1.5px solid ${d.color}` : "1.5px solid #e8e3db",
                        background: newHabitDiff===key ? `${d.color}18` : "#faf8f5",
                        color: newHabitDiff===key ? d.color : "#a8a29e",
                        fontSize:11,fontWeight:700,
                      }}>
                        {d.label}<br/>
                        <span style={{fontSize:9,fontWeight:600}}>+{d.xp}</span>
                      </button>
                    ))}
                  </div>
                  <div style={{display:"flex",gap:8,marginBottom:8}}>
                    <input value={newHabit} onChange={e=>setNewHabit(e.target.value)}
                      onKeyDown={e=>{ if(e.key==="Enter") addHealthItem(); }}
                      placeholder="新しい習慣を追加…"
                      style={{
                        flex:1,padding:"10px 14px",borderRadius:10,
                        border:"1px solid #ddd8d0",background:"#faf8f5",
                        color:"#1e1b2e",fontSize:13,outline:"none",
                      }}/>
                    <button onClick={addHealthItem} style={{
                      padding:"10px 18px",borderRadius:10,border:"none",cursor:"pointer",
                      background:selCat.color,color:"#fff",fontWeight:700,fontSize:13,
                    }}>追加</button>
                  </div>
                  <div style={{fontSize:10,color:"#a8a29e",textAlign:"center"}}>
                    今日: {todayHealthChecked.length} / {(() => {
                      // グループ項目（就寝・起床など）は「1グループ＝達成枠1」として数える
                      const groups = new Set(healthItems.filter(i=>i.group).map(i=>i.group));
                      const ungroupedCount = healthItems.filter(i=>!i.group).length;
                      return ungroupedCount + groups.size;
                    })()} 完了
                  </div>
                </>
              )}
            </div>
          </div>
          );
        })()}

        {/* SKILLS */}
        {tab==="skills" && (
          <div style={{animation:"fadeup .3s ease"}}>
            <div style={{
              display:"flex",gap:6,padding:"0 0 12px",overflowX:"auto",
            }}>
              {CATEGORIES.filter(c=>c.mode!=="check").map(c=>(
                <button key={c.id} onClick={()=>setSkillCat(c.id)} style={{
                  flexShrink:0,padding:"7px 14px",borderRadius:999,border:"none",cursor:"pointer",
                  background: skillCat===c.id ? `${c.color}33` : "#f5f2ee",
                  outline: skillCat===c.id ? `1px solid ${c.color}` : "1px solid #ddd8d0",
                  color: skillCat===c.id ? c.color : "#57534e",
                  fontSize:12,fontWeight:700,letterSpacing:1,
                }}>{c.en}</button>
              ))}
            </div>

            <div style={{...glassCard,padding:"16px",marginBottom:12}}>
              {(() => {
                const cat = CATEGORIES.find(c=>c.id===skillCat);
                const xpB  = calcXPBonus(skillCat, unlocked);
                const gemB = calcGemBonus(skillCat, unlocked, equippedChar);
                return (
                  <div style={{marginBottom:16}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                      <div>
                        <div style={{fontSize:9,color:cat.color,letterSpacing:3,marginBottom:2}}>{cat.en} SKILL TREE</div>
                        <div style={{fontSize:16,fontWeight:700}}>{cat.label}スキル</div>
                      </div>
                    </div>
                    <div style={{display:"flex",gap:8}}>
                      <div style={{flex:1,textAlign:"center",padding:"8px",borderRadius:10,background:"#eff6ff",border:"1px solid #bfdbfe"}}>
                        <div style={{fontSize:9,color:"#1d4ed8",letterSpacing:1}}>EXP BONUS</div>
                        <div style={{fontWeight:800,fontSize:16,color:"#1d4ed8"}}>+{Math.round(xpB*100)}%</div>
                      </div>
                      <div style={{flex:1,textAlign:"center",padding:"8px",borderRadius:10,background:"#fffbeb",border:"1px solid #fde68a"}}>
                        <div style={{fontSize:9,color:GOLD,letterSpacing:1}}>GEM BONUS</div>
                        <div style={{fontWeight:800,fontSize:16,color:"#92400e"}}>+{gemB}💎/回</div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              <div style={{display:"flex",justifyContent:"space-between",
                fontSize:10,color:"#57534e",marginBottom:16,padding:"8px 12px",
                background:"#faf8f5",borderRadius:8}}>
                <span>スキルポイント残り</span>
                <span style={{color:skillPoints>0?GOLD:"#78716c",fontWeight:700}}>{skillPoints} SP</span>
              </div>

              <SkillTreeView
                catId={skillCat}
                lv={lvInfo.lv}
                unlocked={unlocked}
                onUnlock={unlockSkill}
                skillPoints={skillPoints}
              />
            </div>

            <div style={{...glassCard,padding:"14px 16px"}}>
              <div style={{fontSize:9,letterSpacing:3,color:"#57534e",marginBottom:10}}>習得済みスキル</div>
              {SKILL_TREE[skillCat].filter(n=>unlocked.includes(n.id)).length===0 && (
                <div style={{color:"#c5bfb8",fontSize:12,textAlign:"center",padding:"12px 0"}}>なし</div>
              )}
              {SKILL_TREE[skillCat].filter(n=>unlocked.includes(n.id)).map(n=>(
                <div key={n.id} style={{
                  display:"flex",justifyContent:"space-between",alignItems:"center",
                  padding:"8px 0",borderBottom:"1px solid #e8e3db",
                }}>
                  <div>
                    <span style={{color:CATEGORIES.find(c=>c.id===skillCat)?.color,fontSize:12,fontWeight:700}}>{n.label}</span>
                    <span style={{fontSize:10,color:"#78716c",marginLeft:8}}>{n.desc}</span>
                  </div>
                  <span style={{fontSize:10,color:"#4ade80",flexShrink:0}}>✓</span>
                </div>
              ))}
            </div>

            {/* ── 魔法図鑑 ── */}
            {(() => {
              const elem = ELEMENT_INFO[skillCat];
              if (!elem) return null;
              const magicCount = calcMagicCount(skillCat, logs);
              const allMagic = MAGIC_GRIMOIRE[skillCat] || [];
              const unlockedCount = allMagic.filter(m=>magicCount>=m.req).length;
              const nextMagic = allMagic.find(m=>magicCount<m.req);
              return (
                <div style={{...glassCard,padding:"16px",marginTop:12}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                    <div>
                      <div style={{fontSize:9,color:elem.color,letterSpacing:3,marginBottom:2}}>MAGIC GRIMOIRE</div>
                      <div style={{fontSize:16,fontWeight:700}}>{elem.name}属性 魔法図鑑</div>
                    </div>
                    <div style={{
                      fontSize:11,fontWeight:700,color:elem.dark,
                      background:elem.light,padding:"4px 10px",borderRadius:999,
                    }}>{unlockedCount}/{allMagic.length}</div>
                  </div>

                  <div style={{fontSize:10,color:"#78716c",marginBottom:14}}>
                    累計記録回数：{magicCount}回
                    {nextMagic && ` — 次は「${nextMagic.label}」まであと${nextMagic.req - magicCount}回`}
                  </div>

                  <div style={{
                    display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(78px, 1fr))",gap:8,
                  }}>
                    {allMagic.map(m => {
                      const isUnlocked = magicCount >= m.req;
                      const effInfo = EFFECT_TYPE_INFO[m.type];
                      return (
                        <div key={m.id}
                          onClick={()=>setMagicDetail({magic:m, elem, isUnlocked})}
                          style={{
                          aspectRatio:"1",borderRadius:12,cursor:"pointer",
                          display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
                          padding:"6px 4px",position:"relative",
                          background: isUnlocked
                            ? `linear-gradient(160deg, ${elem.light}, ${elem.color}33)`
                            : "#ece8e2",
                          border: isUnlocked ? `1.5px solid ${elem.color}88` : "1.5px solid #ddd8d0",
                          boxShadow: isUnlocked && m.tier===3 ? `0 4px 14px ${elem.color}55` : "none",
                        }}>
                          <span style={{
                            position:"absolute",top:4,left:6,fontSize:8,fontWeight:800,
                            color: isUnlocked ? elem.dark : "#a8a29e",
                          }}>{isUnlocked ? `×${m.req}` : "?"}</span>
                          {isUnlocked && (
                            <span style={{
                              position:"absolute",top:3,right:5,fontSize:10,
                            }}>{effInfo.icon}</span>
                          )}
                          <MagicGlyph catId={skillCat} tier={m.tier} color={elem.color} locked={!isUnlocked}/>
                          <div style={{
                            fontSize:9,fontWeight:700,textAlign:"center",marginTop:2,
                            color: isUnlocked ? "#1c1917" : "#a8a29e",
                          }}>{isUnlocked ? m.label : "未解放"}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* GACHA */}
        {tab==="gacha" && (
          <div style={{animation:"fadeup .3s ease",display:"flex",flexDirection:"column",gap:12}}>
            {/* ルーン石残高 */}
            <div style={{
              ...glassCard,padding:"16px 20px",
              background:"linear-gradient(135deg,#fffbeb,#fef3c7)",
              border:"1px solid #f0c060",
              display:"flex",alignItems:"center",justifyContent:"space-between",
            }}>
              <div>
                <div style={{fontSize:9,letterSpacing:3,color:GOLD,marginBottom:4}}>RUNE STONES</div>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <span style={{fontSize:28}}>💎</span>
                  <span style={{fontSize:32,fontWeight:900,color:"#92400e"}}>{gems}</span>
                </div>
                <div style={{fontSize:10,color:"#78716c",marginTop:4}}>
                  記録するたびに獲得（15分→1石）
                </div>
              </div>
              <div style={{textAlign:"right",fontSize:10,color:"#78716c"}}>
                <div>SSRボーナス</div>
                <div style={{fontSize:16,fontWeight:700,color:GOLD}}>+{Math.round(ssrBonus*100)}%</div>
              </div>
            </div>

            {/* キャラクター排出について */}
            <div style={{
              ...glassCard,padding:"14px 16px",
              background:"linear-gradient(135deg,#fff7e0,#ffe9a8)",
              border:"1px solid #f0c06066",
              display:"flex",alignItems:"center",gap:12,
            }}>
              <span style={{fontSize:24}}>🎴</span>
              <div style={{flex:1}}>
                <div style={{fontWeight:800,fontSize:12,color:"#92400e"}}>
                  キャラクターも出現中
                </div>
                <div style={{fontSize:10,color:"#78716c",marginTop:2,lineHeight:1.5}}>
                  下の2種どちらのガチャからも{Math.round(CHARACTER_DROP_RATE*100)}%の確率で仲間が出現（未所持キャラのみ対象）
                </div>
              </div>
              <div style={{textAlign:"right",fontSize:11,color:"#92400e",fontWeight:800,whiteSpace:"nowrap"}}>
                {ownedChars.length}/{GACHA_CHARACTERS.length}
              </div>
            </div>

            {/* ガチャ2種 */}
            {Object.entries(GACHA_POOLS).map(([poolId, pool])=>(
              <div key={poolId} style={{...glassCard,padding:"18px"}}>
                <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
                  <span style={{fontSize:28}}>{pool.icon}</span>
                  <div>
                    <div style={{fontWeight:800,fontSize:15}}>{pool.name}</div>
                    <div style={{fontSize:11,color:"#78716c"}}>{pool.desc}</div>
                  </div>
                  <div style={{marginLeft:"auto",textAlign:"right"}}>
                    <div style={{fontSize:9,color:GOLD,letterSpacing:2}}>COST</div>
                    <div style={{fontWeight:800,fontSize:16,color:"#92400e"}}>💎{pool.cost}</div>
                  </div>
                </div>

                {/* 排出リスト */}
                <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:14}}>
                  {pool.items.map(item=>(
                    <div key={item.id} style={{
                      display:"flex",alignItems:"center",gap:10,
                      padding:"8px 10px",borderRadius:10,
                      background:item.rarity==="SSR"?"#fffbeb":item.rarity==="SR"?"#f5f3ff":"#f8faff",
                      border:`1px solid ${item.color}44`,
                    }}>
                      <span style={{fontSize:18}}>{item.icon}</span>
                      <div style={{flex:1}}>
                        <div style={{display:"flex",alignItems:"center",gap:6}}>
                          <span style={{
                            fontSize:9,fontWeight:700,letterSpacing:1,
                            color:item.rarity==="SSR"?"#92400e":item.rarity==="SR"?"#5b21b6":"#1e40af",
                            background:item.rarity==="SSR"?"#fde68a":item.rarity==="SR"?"#ede9fe":"#dbeafe",
                            padding:"1px 6px",borderRadius:4,
                          }}>{item.rarity}</span>
                          <span style={{fontWeight:600,fontSize:12}}>{item.label}</span>
                        </div>
                        <div style={{fontSize:10,color:"#78716c",marginTop:2}}>{item.desc}</div>
                      </div>
                      <div style={{fontSize:10,color:"#94a3b8",fontWeight:600}}>
                        {Math.round(item.prob*100)}%
                      </div>
                    </div>
                  ))}
                </div>

                <button onClick={()=>doGacha(poolId)} disabled={gems<pool.cost||gachaAnim} style={{
                  width:"100%",padding:"13px",borderRadius:12,border:"none",
                  cursor:gems>=pool.cost&&!gachaAnim?"pointer":"not-allowed",
                  opacity:gems>=pool.cost?1:0.5,
                  background:gems>=pool.cost
                    ?"linear-gradient(90deg,#f59e0b,#f0c060)"
                    :"#e2ddd6",
                  color:gems>=pool.cost?"#1c1917":"#78716c",
                  fontWeight:800,fontSize:14,letterSpacing:2,
                  boxShadow:gems>=pool.cost?"0 4px 16px #f0c06044":"none",
                  transition:"all .2s",
                }}>
                  {gachaAnim ? "✨ 祈願中…" : `💎${pool.cost} で引く`}
                </button>
              </div>
            ))}

            {/* インベントリ */}
            {inventory.length > 0 && (
              <div style={{...glassCard,padding:"16px"}}>
                <div style={{fontSize:9,letterSpacing:3,color:CYAN,marginBottom:12}}>INVENTORY</div>
                <div style={{display:"flex",flexDirection:"column",gap:8}}>
                  {inventory.slice().sort((a,b)=>(a.used===b.used?0:a.used?1:-1)).map(item=>(
                    <div key={item.uid} style={{
                      display:"flex",alignItems:"center",gap:10,
                      padding:"10px 12px",borderRadius:10,
                      background:item.used?"#f5f5f4":item.active?"#ecfdf5":item.rarity==="SSR"?"#fffbeb":item.rarity==="SR"?"#f5f3ff":"#f8faff",
                      border:`1px solid ${item.used?"#e2ddd6":item.active?"#34d399":item.color+"44"}`,
                      opacity:item.used?0.5:1,
                    }}>
                      <span style={{fontSize:20}}>{item.icon}</span>
                      <div style={{flex:1}}>
                        <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                          <span style={{
                            fontSize:9,fontWeight:700,
                            color:item.rarity==="SSR"?"#92400e":item.rarity==="SR"?"#5b21b6":"#1e40af",
                            background:item.rarity==="SSR"?"#fde68a":item.rarity==="SR"?"#ede9fe":"#dbeafe",
                            padding:"1px 6px",borderRadius:4,
                          }}>{item.rarity}</span>
                          <span style={{fontWeight:700,fontSize:12}}>{item.label}</span>
                          {item.active && (
                            <span style={{fontSize:9,fontWeight:700,color:"#047857",background:"#a7f3d0",padding:"1px 6px",borderRadius:4}}>
                              セット中
                            </span>
                          )}
                        </div>
                        <div style={{fontSize:10,color:"#78716c",marginTop:1}}>{item.desc}</div>
                      </div>
                      {!item.used && !item.active && (
                        <button onClick={()=>useItem(item.uid)} style={{
                          padding:"6px 12px",borderRadius:8,border:"none",cursor:"pointer",
                          background:CYAN,color:"#fff",fontSize:11,fontWeight:700,
                          flexShrink:0,
                        }}>
                          {item.effect?.type==="xp_mult" ? "セット" : "使用"}
                        </button>
                      )}
                      {item.active && (
                        <span style={{fontSize:10,color:"#059669",fontWeight:700,flexShrink:0}}>待機中</span>
                      )}
                      {item.used && <span style={{fontSize:10,color:"#a8a29e",flexShrink:0}}>使用済</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* STATUS */}
        {tab==="stats" && (
          <div style={{animation:"fadeup .3s ease",display:"flex",flexDirection:"column",gap:12}}>

            {/* ── 全期間累計（ドーナツグラフ） ── */}
            <div style={{...glassCard,padding:"16px"}}>
              <div style={{fontSize:9,letterSpacing:3,color:CYAN,marginBottom:4}}>ALL-TIME TOTAL</div>
              <div style={{fontSize:13,fontWeight:700,marginBottom:16}}>全期間の累計記録時間</div>

              <div style={{display:"flex",alignItems:"center",gap:18}}>
                {/* ドーナツ */}
                <div style={{position:"relative",flexShrink:0,width:120,height:120}}>
                  <svg viewBox="0 0 120 120" width="120" height="120">
                    {allTimeTotal > 0 ? donutSegments.filter(s=>s.val>0).map(s => (
                      <path key={s.id}
                        d={donutArcPath(60,60,56,38,s.startAngle,s.endAngle)}
                        fill={s.color}
                        opacity={0.92}
                      />
                    )) : (
                      <circle cx="60" cy="60" r="47" fill="none" stroke="#f0ede8" strokeWidth="18" />
                    )}
                  </svg>
                  <div style={{
                    position:"absolute",inset:0,display:"flex",flexDirection:"column",
                    alignItems:"center",justifyContent:"center",
                  }}>
                    <div style={{fontSize:20,fontWeight:900,color:"#1c1917",lineHeight:1}}>
                      {allTimeTotal >= 60 ? Math.round(allTimeTotal/60*10)/10 : allTimeTotal}
                    </div>
                    <div style={{fontSize:8,color:"#78716c",letterSpacing:1}}>
                      {allTimeTotal >= 60 ? "時間" : "分"}
                    </div>
                  </div>
                </div>

                {/* 凡例＋割合 */}
                <div style={{flex:1,display:"flex",flexDirection:"column",gap:8}}>
                  {donutSegments.filter(s=>s.val>0).sort((a,b)=>b.val-a.val).map(s => (
                    <div key={s.id} style={{display:"flex",alignItems:"center",gap:8}}>
                      <span style={{width:9,height:9,borderRadius:3,background:s.color,flexShrink:0}}/>
                      <span style={{fontSize:11,color:"#44403c",flex:1}}>{s.label}</span>
                      <span style={{fontSize:11,fontWeight:700,color:s.color}}>{Math.round(s.pct*100)}%</span>
                      <span style={{fontSize:9,color:"#a8a29e",width:48,textAlign:"right"}}>
                        {s.val >= 60 ? `${Math.round(s.val/60*10)/10}h` : `${s.val}min`}
                      </span>
                    </div>
                  ))}
                  {allTimeTotal === 0 && (
                    <div style={{fontSize:11,color:"#a8a29e"}}>記録するとここに表示されます</div>
                  )}
                </div>
              </div>
            </div>

            {/* ── 14日間の積み上げ棒グラフ ── */}
            <div style={{...glassCard,padding:"16px"}}>
              <div style={{fontSize:9,letterSpacing:3,color:CYAN,marginBottom:4}}>RECENT ACTIVITY</div>
              <div style={{fontSize:13,fontWeight:700,marginBottom:14}}>直近14日間の記録時間</div>

              <div style={{display:"flex",alignItems:"flex-end",gap:4,height:140,marginBottom:8}}>
                {dailyHistory.map((d,i) => {
                  const dateObj = new Date(d.date+"T00:00:00");
                  const isToday = d.date === today;
                  const barH = Math.max((d.total/maxDayTotal)*120, d.total>0?4:0);
                  return (
                    <div key={d.date} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",height:"100%",justifyContent:"flex-end"}}>
                      <div style={{
                        width:"100%",maxWidth:18,height:barH,borderRadius:"4px 4px 2px 2px",
                        display:"flex",flexDirection:"column-reverse",overflow:"hidden",
                        outline:isToday?`1.5px solid ${CYAN}`:"none",outlineOffset:2,
                      }}>
                        {timeCats.map(c => {
                          const v = d.byCat[c.id];
                          if (!v) return null;
                          const segH = d.total>0 ? (v/d.total)*barH : 0;
                          return <div key={c.id} style={{width:"100%",height:segH,background:c.color}}/>;
                        })}
                        {d.total===0 && <div style={{width:"100%",height:3,background:"#e8e3db"}}/>}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{display:"flex",gap:4}}>
                {dailyHistory.map(d => {
                  const dateObj = new Date(d.date+"T00:00:00");
                  const isToday = d.date === today;
                  return (
                    <div key={d.date} style={{flex:1,textAlign:"center"}}>
                      <div style={{fontSize:8,color:isToday?CYAN:"#a8a29e",fontWeight:isToday?800:500}}>
                        {dateObj.getDate()}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* legend */}
              <div style={{display:"flex",flexWrap:"wrap",gap:"6px 12px",marginTop:14,paddingTop:12,borderTop:"1px solid #f0ede8"}}>
                {timeCats.map(c => (
                  <div key={c.id} style={{display:"flex",alignItems:"center",gap:4}}>
                    <span style={{width:8,height:8,borderRadius:2,background:c.color,display:"inline-block"}}/>
                    <span style={{fontSize:10,color:"#57534e"}}>{c.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* ── カテゴリ別累計 ── */}
            <div style={{fontSize:9,letterSpacing:3,color:CYAN,marginTop:4,marginLeft:4}}>TOTAL BY CATEGORY</div>

            {catStats.map(c=>{
              const isCount = c.mode === "count";
              const barPct = isCount ? (c.count/maxCount)*100 : (c.total/maxMin)*100;
              return (
              <div key={c.id} style={{...glassCard,padding:"14px 16px"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <span style={{
                      width:32,height:32,borderRadius:8,flexShrink:0,
                      background:`${c.color}18`,border:`1px solid ${c.color}30`,
                      display:"flex",alignItems:"center",justifyContent:"center",
                      fontSize:16,color:c.color,
                    }}>{c.icon}</span>
                    <div>
                      <div style={{fontWeight:700,fontSize:13}}>{c.label}</div>
                      <div style={{fontSize:9,color:"#57534e",letterSpacing:2}}>{c.en}</div>
                    </div>
                  </div>
                  <div style={{textAlign:"right"}}>
                    {isCount ? (
                      <div style={{fontSize:16,fontWeight:800,color:c.color}}>{c.count}<span style={{fontSize:9,color:"#57534e"}}>回</span></div>
                    ) : (
                      <div style={{fontSize:16,fontWeight:800,color:c.color}}>{c.total}<span style={{fontSize:9,color:"#57534e"}}>min</span></div>
                    )}
                    <div style={{fontSize:10,color:"#78716c"}}>{isCount ? `${c.xp}EXP` : `${c.count}回 · ${c.xp}EXP`}</div>
                  </div>
                </div>
                <div style={{height:4,background:"#f5f2ee",borderRadius:999,overflow:"hidden"}}>
                  <div style={{
                    height:"100%",borderRadius:999,
                    width:`${barPct}%`,
                    background:`linear-gradient(90deg,${c.glow},${c.color})`,
                    boxShadow:`0 0 8px ${c.color}88`,
                    transition:"width .8s cubic-bezier(.4,0,.2,1)",
                  }}/>
                </div>
                {/* skill bonus indicator */}
                {calcXPBonus(c.id,unlocked) > 0 && (
                  <div style={{fontSize:9,color:c.color,marginTop:6,letterSpacing:1}}>
                    スキルボーナス +{Math.round(calcXPBonus(c.id,unlocked)*100)}% 適用中
                  </div>
                )}
              </div>
              );
            })}

            {/* HEALTH card */}
            <div style={{...glassCard,padding:"14px 16px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <span style={{
                    width:32,height:32,borderRadius:8,flexShrink:0,
                    background:`${healthCat.color}18`,border:`1px solid ${healthCat.color}30`,
                    display:"flex",alignItems:"center",justifyContent:"center",
                    fontSize:16,color:healthCat.color,
                  }}>{healthCat.icon}</span>
                  <div>
                    <div style={{fontWeight:700,fontSize:13}}>{healthCat.label}</div>
                    <div style={{fontSize:9,color:"#57534e",letterSpacing:2}}>{healthCat.en}</div>
                  </div>
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:16,fontWeight:800,color:healthCat.color}}>
                    {Object.values(healthChecks).reduce((s,a)=>s+(a?.length||0),0)}<span style={{fontSize:9,color:"#57534e"}}>回</span>
                  </div>
                  <div style={{fontSize:10,color:"#78716c"}}>{healthXP}EXP</div>
                </div>
              </div>

              {/* per-item completion */}
              <div style={{display:"flex",flexDirection:"column",gap:6,marginTop:4}}>
                {healthItems.map(item=>{
                  const doneDays = Object.values(healthChecks).filter(arr=>arr?.includes(item.id)).length;
                  const totalDays = Object.keys(healthChecks).length || 1;
                  const rate = Math.round((doneDays/totalDays)*100);
                  return (
                    <div key={item.id} style={{display:"flex",alignItems:"center",gap:8}}>
                      <span style={{fontSize:11,color:"#44403c",flex:1}}>{item.icon} {item.label}</span>
                      <span style={{fontSize:10,color:healthCat.color,fontWeight:700}}>{doneDays}日</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ── デバイス間同期 ── */}
            <div style={{...glassCard,padding:"16px"}}>
              <div style={{fontSize:9,letterSpacing:3,color:CYAN,marginBottom:4}}>SYNC</div>
              <div style={{fontSize:13,fontWeight:700,marginBottom:4}}>デバイス間同期</div>
              <div style={{fontSize:11,color:"#78716c",marginBottom:16}}>
                同期コードで別のスマホ・PCとデータを共有できます。
              </div>

              {syncCode ? (
                <>
                  <div style={{
                    padding:"14px 16px",borderRadius:12,marginBottom:10,
                    background:"linear-gradient(135deg,#eff6ff,#dbeafe)",
                    border:"1px solid #60a5fa66",
                  }}>
                    <div style={{fontSize:9,color:"#1d4ed8",letterSpacing:2,marginBottom:4}}>同期コード</div>
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}>
                      <div style={{fontSize:20,fontWeight:900,color:"#1e3a8a",letterSpacing:1,fontFamily:"monospace"}}>
                        {syncCode}
                      </div>
                      <button onClick={()=>{
                        navigator.clipboard?.writeText(syncCode);
                        showToast("コードをコピーしました", "#60a5fa");
                      }} style={{
                        padding:"6px 12px",borderRadius:8,border:"none",cursor:"pointer",
                        background:"#3b82f6",color:"#fff",fontSize:11,fontWeight:700,flexShrink:0,
                      }}>コピー</button>
                    </div>
                    <div style={{fontSize:10,color:"#1d4ed8",marginTop:8,display:"flex",alignItems:"center",gap:6}}>
                      {syncStatus==="syncing" && <>🔄 同期中...</>}
                      {syncStatus==="synced" && <>✓ 同期済み{syncLastAt && ` (${new Date(syncLastAt).toLocaleTimeString("ja-JP",{hour:"2-digit",minute:"2-digit"})})`}</>}
                      {syncStatus==="error" && <span style={{color:"#dc2626"}}>⚠ 同期エラー（通信を確認してください）</span>}
                      {syncStatus==="idle" && <>待機中</>}
                    </div>
                  </div>
                  <button onClick={doSyncPush} disabled={syncBusy} style={{
                    width:"100%",padding:"10px",borderRadius:10,border:"1px solid #d6d3d1",cursor:"pointer",
                    background:"#fff",color:"#57534e",fontWeight:700,fontSize:12,marginBottom:8,
                  }}>今すぐ同期</button>
                  <button onClick={handleUnlinkSync} style={{
                    width:"100%",padding:"9px",borderRadius:10,border:"none",cursor:"pointer",
                    background:"none",color:"#a8a29e",fontWeight:600,fontSize:11,
                  }}>同期を解除</button>
                </>
              ) : (
                <>
                  <button onClick={handleIssueSyncCode} disabled={syncBusy} style={{
                    width:"100%",padding:"13px 16px",borderRadius:12,border:"none",cursor:"pointer",
                    background:"linear-gradient(135deg,#eff6ff,#dbeafe)",
                    border:"1px solid #60a5fa66",
                    display:"flex",alignItems:"center",gap:12,textAlign:"left",marginBottom:14,
                    opacity: syncBusy?0.6:1,
                  }}>
                    <span style={{fontSize:24}}>🔗</span>
                    <div>
                      <div style={{fontWeight:700,fontSize:13,color:"#1e3a8a"}}>
                        {syncBusy ? "発行中..." : "同期コードを発行"}
                      </div>
                      <div style={{fontSize:10,color:"#1d4ed8",marginTop:2}}>
                        このデバイスのデータをクラウドに保存します
                      </div>
                    </div>
                  </button>

                  <div style={{fontSize:10,color:"#a8a29e",marginBottom:8}}>
                    または、別のデバイスで発行したコードを入力：
                  </div>
                  <div style={{display:"flex",gap:8}}>
                    <input
                      value={syncInput}
                      onChange={e=>setSyncInput(e.target.value)}
                      placeholder="a3f9-2k1p"
                      style={{
                        flex:1,padding:"10px 12px",borderRadius:10,
                        border:"1px solid #d6d3d1",fontSize:13,fontFamily:"monospace",
                        background:"#faf8f5",
                      }}
                    />
                    <button onClick={handlePullSyncCode} disabled={syncBusy || !syncInput.trim()} style={{
                      padding:"10px 16px",borderRadius:10,border:"none",cursor:"pointer",
                      background: syncInput.trim() ? "#3b82f6" : "#d6d3d1",
                      color:"#fff",fontWeight:700,fontSize:12,flexShrink:0,
                    }}>読込</button>
                  </div>
                  <div style={{fontSize:10,color:"#a8a29e",marginTop:10,lineHeight:1.6}}>
                    ※ コードを入力すると、このデバイスのデータは上書きされます。
                  </div>
                </>
              )}
            </div>

            {/* ── エクスポート ── */}
            <div style={{...glassCard,padding:"16px"}}>
              <div style={{fontSize:9,letterSpacing:3,color:CYAN,marginBottom:4}}>EXPORT</div>
              <div style={{fontSize:13,fontWeight:700,marginBottom:4}}>データのエクスポート</div>
              <div style={{fontSize:11,color:"#78716c",marginBottom:16}}>
                記録データをファイルとして書き出します。
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                <button onClick={exportCSV} style={{
                  padding:"13px 16px",borderRadius:12,border:"none",cursor:"pointer",
                  background:"linear-gradient(135deg,#ecfdf5,#d1fae5)",
                  border:"1px solid #34d39966",
                  display:"flex",alignItems:"center",gap:12,
                  textAlign:"left",
                }}>
                  <span style={{fontSize:24}}>📊</span>
                  <div>
                    <div style={{fontWeight:700,fontSize:13,color:"#14532d"}}>CSVでエクスポート</div>
                    <div style={{fontSize:10,color:"#166534",marginTop:2}}>
                      Excel・Googleスプレッドシートで開けます
                    </div>
                  </div>
                </button>
                <button onClick={exportJSON} style={{
                  padding:"13px 16px",borderRadius:12,border:"none",cursor:"pointer",
                  background:"linear-gradient(135deg,#eff6ff,#dbeafe)",
                  border:"1px solid #60a5fa66",
                  display:"flex",alignItems:"center",gap:12,
                  textAlign:"left",
                }}>
                  <span style={{fontSize:24}}>💾</span>
                  <div>
                    <div style={{fontWeight:700,fontSize:13,color:"#1e3a8a"}}>JSONでバックアップ</div>
                    <div style={{fontSize:10,color:"#1d4ed8",marginTop:2}}>
                      ルーン石・インベントリ・スキルも含む完全バックアップ
                    </div>
                  </div>
                </button>
              </div>
              <div style={{fontSize:10,color:"#a8a29e",marginTop:12,lineHeight:1.6}}>
                ※ CSVはログ記録のみ。JSONは全データを含みます。
              </div>
            </div>

          </div>
        )}
      </div>

      {/* ── BOTTOM NAV ── */}
      <div style={{
        position:"fixed",bottom:0,left:"50%",transform:"translateX(-50%)",
        width:"100%",maxWidth:430,zIndex:50,
        background:`rgba(240,237,232,0.97)`,
        borderTop:`1px solid ${BORDER}`,
        backdropFilter:"blur(20px)",
        display:"grid",gridTemplateColumns:`repeat(${TABS.length},1fr)`,
        padding:"10px 0 20px",
      }}>
        {TABS.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)} style={{
            background:"none",border:"none",cursor:"pointer",
            display:"flex",flexDirection:"column",alignItems:"center",gap:3,padding:"4px 0",
          }}>
            <span style={{
              fontSize:18,
              color: tab===t.id ? CYAN : "#9c9087",
              textShadow: tab===t.id ? `0 0 10px ${CYAN}44` : "none",
              transition:"all .2s",
            }}>{t.icon}</span>
            <span style={{
              fontSize:8,letterSpacing:2,fontWeight:700,
              color: tab===t.id ? CYAN : "#9c9087",
            }}>{t.label}</span>
            {tab===t.id && (
              <div style={{
                width:16,height:1.5,borderRadius:999,
                background:`linear-gradient(90deg,transparent,${CYAN},transparent)`,
              }}/>
            )}
          </button>
        ))}
      </div>

      {/* ── SCHEDULE SETTINGS MODAL ── */}
      {showScheduleModal && (() => {
        const previewCap = calcDailyCapMinutes(schedule);
        return (
          <div onClick={()=>setShowScheduleModal(false)} style={{
            position:"fixed",inset:0,background:"rgba(30,20,10,0.6)",
            backdropFilter:"blur(4px)",display:"flex",alignItems:"center",
            justifyContent:"center",zIndex:200,padding:20,
          }}>
            <div onClick={e=>e.stopPropagation()} style={{
              background:"#fff",borderRadius:20,padding:"24px 22px",
              width:340,maxWidth:"100%",
              animation:"resultPop .35s cubic-bezier(.34,1.56,.64,1)",
            }}>
              <div style={{fontSize:9,letterSpacing:3,color:CYAN,marginBottom:4}}>SCHEDULE</div>
              <div style={{fontSize:15,fontWeight:800,marginBottom:4}}>生活スケジュール設定</div>
              <div style={{fontSize:11,color:"#78716c",marginBottom:18,lineHeight:1.6}}>
                起床・就寝・勤務/通学時間から、1日に記録できる時間の上限を算出します。
              </div>

              <div style={{display:"flex",flexDirection:"column",gap:12,marginBottom:16}}>
                <div style={{display:"flex",gap:10}}>
                  <label style={{flex:1}}>
                    <div style={{fontSize:10,color:"#78716c",marginBottom:4}}>起床時刻</div>
                    <input type="time" value={schedule.wake}
                      onChange={e=>setSchedule(s=>({...s, wake:e.target.value}))}
                      style={{width:"100%",padding:"8px 10px",borderRadius:8,border:"1px solid #d6d3d1",fontSize:13}}/>
                  </label>
                  <label style={{flex:1}}>
                    <div style={{fontSize:10,color:"#78716c",marginBottom:4}}>就寝時刻</div>
                    <input type="time" value={schedule.sleep}
                      onChange={e=>setSchedule(s=>({...s, sleep:e.target.value}))}
                      style={{width:"100%",padding:"8px 10px",borderRadius:8,border:"1px solid #d6d3d1",fontSize:13}}/>
                  </label>
                </div>

                <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer"}}>
                  <input type="checkbox" checked={schedule.hasWork}
                    onChange={e=>setSchedule(s=>({...s, hasWork:e.target.checked}))}/>
                  <span style={{fontSize:12,color:"#44403c"}}>仕事・学校がある</span>
                </label>

                {schedule.hasWork && (
                  <div style={{display:"flex",gap:10}}>
                    <label style={{flex:1}}>
                      <div style={{fontSize:10,color:"#78716c",marginBottom:4}}>開始時刻</div>
                      <input type="time" value={schedule.workStart}
                        onChange={e=>setSchedule(s=>({...s, workStart:e.target.value}))}
                        style={{width:"100%",padding:"8px 10px",borderRadius:8,border:"1px solid #d6d3d1",fontSize:13}}/>
                    </label>
                    <label style={{flex:1}}>
                      <div style={{fontSize:10,color:"#78716c",marginBottom:4}}>終了時刻</div>
                      <input type="time" value={schedule.workEnd}
                        onChange={e=>setSchedule(s=>({...s, workEnd:e.target.value}))}
                        style={{width:"100%",padding:"8px 10px",borderRadius:8,border:"1px solid #d6d3d1",fontSize:13}}/>
                    </label>
                  </div>
                )}

                <div style={{height:1,background:"#f0ede8",margin:"4px 0"}}/>

                <label style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer"}}>
                  <input type="checkbox" checked={schedule.hasCommute}
                    onChange={e=>setSchedule(s=>({...s, hasCommute:e.target.checked}))}/>
                  <span style={{fontSize:12,color:"#44403c"}}>通勤・通学がある</span>
                </label>

                {schedule.hasCommute && (
                  <>
                    <div style={{display:"flex",gap:8}}>
                      {[
                        {id:"transit", label:"電車・バス"},
                        {id:"car",     label:"車・自転車等"},
                      ].map(m => (
                        <button key={m.id} type="button"
                          onClick={()=>setSchedule(s=>({...s, commuteMode:m.id}))}
                          style={{
                            flex:1,padding:"7px 4px",borderRadius:8,cursor:"pointer",
                            border: schedule.commuteMode===m.id ? "1.5px solid #a78bfa" : "1.5px solid #e8e3db",
                            background: schedule.commuteMode===m.id ? "#f5f3ff" : "#faf8f5",
                            color: schedule.commuteMode===m.id ? "#6d28d9" : "#a8a29e",
                            fontSize:11,fontWeight:700,
                          }}>{m.label}</button>
                      ))}
                    </div>
                    <label>
                      <div style={{fontSize:10,color:"#78716c",marginBottom:4}}>片道の所要時間（分）</div>
                      <input type="number" min="0" value={schedule.commuteOneWayMin}
                        onChange={e=>setSchedule(s=>({...s, commuteOneWayMin:e.target.value}))}
                        style={{width:"100%",padding:"8px 10px",borderRadius:8,border:"1px solid #d6d3d1",fontSize:13}}/>
                    </label>
                    {schedule.commuteMode === "car" && (
                      <div style={{fontSize:10,color:"#a8a29e",lineHeight:1.5}}>
                        車・自転車等は安全のため、通勤中の記録枠は付与されません。
                      </div>
                    )}
                  </>
                )}
              </div>

              <div style={{
                padding:"12px 14px",borderRadius:12,marginBottom:10,
                background:"#eff6ff",border:"1px solid #bfdbfe",
              }}>
                <div style={{fontSize:10,color:"#1d4ed8",marginBottom:2}}>算出された1日の記録上限</div>
                <div style={{fontSize:22,fontWeight:800,color:"#1e3a8a"}}>{previewCap}分</div>
                <div style={{fontSize:9,color:"#3b82f6",marginTop:2}}>
                  ※食事・身支度等として{LIFE_BUFFER_MIN}分を自動で確保しています
                </div>
              </div>

              {calcCommuteBonusMinutes(schedule) > 0 && (
                <div style={{
                  padding:"12px 14px",borderRadius:12,marginBottom:16,
                  background:"#f5f3ff",border:"1px solid #ddd6fe",
                }}>
                  <div style={{fontSize:10,color:"#6d28d9",marginBottom:2}}>通勤中の学習枠（別枠・知力/精神のみ）</div>
                  <div style={{fontSize:22,fontWeight:800,color:"#5b21b6"}}>{calcCommuteBonusMinutes(schedule)}分</div>
                </div>
              )}

              <button onClick={()=>setShowScheduleModal(false)} style={{
                width:"100%",padding:"12px",borderRadius:12,border:"none",cursor:"pointer",
                background:CYAN,color:"#fff",fontWeight:800,fontSize:13,
              }}>保存して閉じる</button>
            </div>
          </div>
        );
      })()}

      {/* ── CHARACTER DETAIL MODAL ── */}
      {charDetail && (() => {
        const { char, owned } = charDetail;
        const isEquipped = equippedChar === char.id;
        return (
          <div onClick={()=>setCharDetail(null)} style={{
            position:"fixed",inset:0,background:"rgba(30,20,10,0.78)",
            backdropFilter:"blur(6px)",display:"flex",alignItems:"center",
            justifyContent:"center",zIndex:200,padding:20,
          }}>
            <div onClick={e=>e.stopPropagation()} style={{
              background:"#fff",borderRadius:22,padding:"28px 24px",
              width:320,maxWidth:"100%",
              animation:"resultPop .4s cubic-bezier(.34,1.56,.64,1)",
              border:"1.5px solid #fbbf2455",
            }}>
              {owned ? (
                <>
                  <div style={{display:"flex",justifyContent:"center",marginBottom:14}}>
                    <img src={getCharacterStageImage(char, calcCharLevel(charXP[char.id]||0).lv)} alt={char.name} style={{
                      width:140,height:140,objectFit:"contain",
                      filter:"drop-shadow(0 4px 16px #fbbf2455)",
                    }} onError={e=>{e.target.style.display="none";}}/>
                  </div>
                  <div style={{textAlign:"center",marginBottom:4}}>
                    <span style={{fontSize:9,letterSpacing:3,color:"#a16207",fontWeight:700}}>UR ★★★</span>
                  </div>
                  <div style={{textAlign:"center",fontSize:20,fontWeight:800,marginBottom:6}}>{char.name}</div>
                  {(() => {
                    const cLv = calcCharLevel(charXP[char.id]||0);
                    return (
                      <div style={{marginBottom:14}}>
                        <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:"#a16207",marginBottom:3}}>
                          <span style={{fontWeight:800}}>Lv.{cLv.lv}{cLv.isMax?" (MAX)":""}</span>
                          {!cLv.isMax && <span>{cLv.current}/{cLv.needed}</span>}
                        </div>
                        <div style={{height:6,background:"#f5e9c8",borderRadius:999,overflow:"hidden"}}>
                          <div style={{
                            height:"100%",background:"linear-gradient(90deg,#f59e0b,#fbbf24)",
                            width: cLv.isMax ? "100%" : `${Math.min((cLv.current/cLv.needed)*100,100)}%`,
                            borderRadius:999,transition:"width .4s ease",
                          }}/>
                        </div>
                      </div>
                    );
                  })()}
                  <div style={{display:"flex",justifyContent:"center",marginBottom:14}}>
                    <div style={{
                      padding:"5px 14px",borderRadius:999,
                      background:"#fef3c7",border:"1px solid #fbbf2455",
                    }}>
                      <span style={{fontSize:11,fontWeight:700,color:"#a16207"}}>{char.passiveDesc}</span>
                    </div>
                  </div>
                  <div style={{
                    padding:"12px 14px",borderRadius:12,marginBottom:16,
                    background:"#faf8f5",border:"1px solid #f0ede8",
                  }}>
                    <div style={{fontSize:12,color:"#44403c",lineHeight:1.7,fontStyle:"italic"}}>
                      "{char.flavor}"
                    </div>
                  </div>
                  {isEquipped ? (
                    <button onClick={()=>{setEquippedChar(""); setCharDetail(null); showToast("基本キャラクターに戻しました","#a8a29e");}} style={{
                      width:"100%",padding:"11px",borderRadius:12,border:"1px solid #d6d3d1",cursor:"pointer",
                      background:"#fff",color:"#78716c",fontWeight:700,fontSize:13,
                    }}>装備を解除する</button>
                  ) : (
                    <button onClick={()=>{setEquippedChar(char.id); setCharDetail(null); showToast(`${char.name}を装備した！`,"#f0c060");}} style={{
                      width:"100%",padding:"11px",borderRadius:12,border:"none",cursor:"pointer",
                      background:"linear-gradient(90deg,#f59e0b,#fbbf24)",color:"#fff",fontWeight:800,fontSize:13,
                    }}>このキャラクターを装備する</button>
                  )}
                </>
              ) : (
                <div style={{
                  padding:"24px 16px",borderRadius:12,textAlign:"center",
                  background:"#f5f5f4",border:"1px solid #e7e5e4",
                }}>
                  <div style={{fontSize:32,marginBottom:10,color:"#a8a29e"}}>？</div>
                  <div style={{fontSize:12,color:"#78716c"}}>
                    まだ入手していません。ガチャで低確率に排出されます。
                  </div>
                </div>
              )}
              <button onClick={()=>setCharDetail(null)} style={{
                width:"100%",marginTop:12,padding:"10px",borderRadius:12,border:"none",cursor:"pointer",
                background:"#f5f2ee",color:"#57534e",fontWeight:700,fontSize:12,
              }}>閉じる</button>
            </div>
          </div>
        );
      })()}

      {/* ── MAGIC DETAIL MODAL ── */}
      {magicDetail && (() => {
        const { magic, elem, isUnlocked } = magicDetail;
        const effInfo = EFFECT_TYPE_INFO[magic.type];
        return (
          <div onClick={()=>setMagicDetail(null)} style={{
            position:"fixed",inset:0,background:"rgba(30,20,10,0.78)",
            backdropFilter:"blur(6px)",display:"flex",alignItems:"center",
            justifyContent:"center",zIndex:200,padding:20,
          }}>
            <div onClick={e=>e.stopPropagation()} style={{
              background:"#fff",borderRadius:22,padding:"28px 24px",
              width:320,maxWidth:"100%",
              animation:"resultPop .4s cubic-bezier(.34,1.56,.64,1)",
              border:`1.5px solid ${elem.color}55`,
            }}>
              <div style={{display:"flex",justifyContent:"center",marginBottom:14}}>
                <div style={{
                  width:84,height:84,borderRadius:18,
                  display:"flex",alignItems:"center",justifyContent:"center",
                  background: isUnlocked
                    ? `linear-gradient(160deg, ${elem.light}, ${elem.color}33)`
                    : "#ece8e2",
                  border: isUnlocked ? `1.5px solid ${elem.color}88` : "1.5px solid #ddd8d0",
                  boxShadow: isUnlocked && magic.tier===3 ? `0 4px 18px ${elem.color}55` : "none",
                }}>
                  <MagicGlyph catId={skillCat} tier={magic.tier} color={elem.color} locked={!isUnlocked}/>
                </div>
              </div>

              <div style={{textAlign:"center",marginBottom:4}}>
                <span style={{fontSize:9,letterSpacing:3,color:elem.color,fontWeight:700}}>
                  {elem.name}属性 ・ Tier {magic.tier}
                </span>
              </div>
              <div style={{textAlign:"center",fontSize:20,fontWeight:800,marginBottom:14}}>
                {isUnlocked ? magic.label : "？？？"}
              </div>

              {isUnlocked ? (
                <>
                  {/* 効果バッジ群 */}
                  <div style={{display:"flex",justifyContent:"center",gap:6,marginBottom:14,flexWrap:"wrap"}}>
                    <div style={{
                      display:"flex",alignItems:"center",gap:4,
                      padding:"4px 10px",borderRadius:999,
                      background:effInfo.color+"1a",border:`1px solid ${effInfo.color}55`,
                    }}>
                      <span style={{fontSize:12}}>{effInfo.icon}</span>
                      <span style={{fontSize:11,fontWeight:700,color:effInfo.color}}>{effInfo.label}</span>
                    </div>
                    {magic.power > 0 && (
                      <div style={{
                        padding:"4px 10px",borderRadius:999,
                        background:"#f5f5f4",border:"1px solid #d6d3d1",
                      }}>
                        <span style={{fontSize:11,fontWeight:700,color:"#57534e"}}>威力 {magic.power}</span>
                      </div>
                    )}
                    <div style={{
                      padding:"4px 10px",borderRadius:999,
                      background:"#f5f5f4",border:"1px solid #d6d3d1",
                    }}>
                      <span style={{fontSize:11,fontWeight:700,color:"#57534e"}}>対象：{magic.target}</span>
                    </div>
                  </div>

                  {/* フレーバーテキスト */}
                  <div style={{
                    padding:"12px 14px",borderRadius:12,marginBottom:10,
                    background:"#faf8f5",border:"1px solid #f0ede8",
                  }}>
                    <div style={{fontSize:12,color:"#44403c",lineHeight:1.7,fontStyle:"italic"}}>
                      "{magic.flavor}"
                    </div>
                  </div>

                  <div style={{fontSize:11,color:"#a8a29e",textAlign:"center"}}>
                    {magic.desc}
                  </div>
                </>
              ) : (
                <div style={{
                  padding:"16px",borderRadius:12,textAlign:"center",
                  background:"#f5f5f4",border:"1px solid #e7e5e4",
                }}>
                  <div style={{fontSize:12,color:"#78716c",marginBottom:8}}>
                    累計記録 ×{magic.req} で解放されます
                  </div>
                  <div style={{fontSize:11,color:"#a8a29e"}}>
                    あと{Math.max(0, magic.req - calcMagicCount(skillCat, logs))}回の記録で習得できます
                  </div>
                </div>
              )}

              <button onClick={()=>setMagicDetail(null)} style={{
                width:"100%",marginTop:18,padding:"11px",borderRadius:12,border:"none",cursor:"pointer",
                background:"#f5f2ee",color:"#57534e",fontWeight:700,fontSize:13,
              }}>閉じる</button>
            </div>
          </div>
        );
      })()}

      {/* ── LOGIN BONUS MODAL ── */}
      {loginBonus && (
        <div style={{
          position:"fixed",inset:0,background:"rgba(200,195,188,0.75)",
          backdropFilter:"blur(8px)",display:"flex",alignItems:"center",
          justifyContent:"center",zIndex:200,
        }}>
          <div style={{
            background:"#fff",borderRadius:24,padding:"36px 28px",
            width:300,textAlign:"center",
            animation:"bonusIn .4s cubic-bezier(.34,1.56,.64,1)",
            boxShadow:"0 8px 40px rgba(0,0,0,0.15)",
          }}>
            <div style={{fontSize:48,marginBottom:8}}>{loginBonus.bonus.icon}</div>
            <div style={{fontSize:9,letterSpacing:4,color:GOLD,marginBottom:6}}>LOGIN BONUS</div>
            <div style={{fontSize:20,fontWeight:800,marginBottom:4}}>{loginBonus.bonus.label}</div>
            <div style={{fontSize:13,color:"#78716c",marginBottom:20}}>{loginBonus.streak}日連続ログイン中！</div>
            <div style={{display:"flex",justifyContent:"center",gap:16,marginBottom:24}}>
              <div style={{textAlign:"center",padding:"12px 20px",borderRadius:12,background:"#fffbeb",border:"1px solid #f0c060"}}>
                <div style={{fontSize:22}}>💎</div>
                <div style={{fontWeight:800,fontSize:20,color:"#92400e"}}>+{loginBonus.bonus.gems}</div>
                <div style={{fontSize:10,color:"#78716c"}}>ルーン石</div>
              </div>
              {loginBonus.bonus.xp > 0 && (
                <div style={{textAlign:"center",padding:"12px 20px",borderRadius:12,background:"#eff6ff",border:"1px solid #93c5fd"}}>
                  <div style={{fontSize:22}}>⚡</div>
                  <div style={{fontWeight:800,fontSize:20,color:"#1d4ed8"}}>+{loginBonus.bonus.xp}</div>
                  <div style={{fontSize:10,color:"#78716c"}}>EXP</div>
                </div>
              )}
            </div>
            {/* 7日ボーナス予告 */}
            {loginBonus.streak < 7 && (
              <div style={{fontSize:11,color:"#78716c",marginBottom:16}}>
                あと{7-loginBonus.streak}日で7日連続ボーナス！💎15獲得
              </div>
            )}
            <button onClick={()=>setLoginBonus(null)} style={{
              width:"100%",padding:"12px",borderRadius:12,border:"none",cursor:"pointer",
              background:"linear-gradient(90deg,#f59e0b,#f0c060)",
              color:"#1c1917",fontWeight:800,fontSize:14,letterSpacing:2,
            }}>受け取る！</button>
          </div>
        </div>
      )}

      {/* ── GACHA RESULT MODAL ── */}
      {(gachaAnim || gachaResult) && (
        <div style={{
          position:"fixed",inset:0,background:"rgba(10,0,30,0.88)",
          backdropFilter:"blur(6px)",display:"flex",alignItems:"center",
          justifyContent:"center",zIndex:200,
        }} onClick={gachaResult && !gachaAnim ? ()=>setGachaResult(null) : undefined}>
          {gachaAnim ? (
            <div style={{textAlign:"center"}}>
              <div style={{
                fontSize:72,animation:"gachaSpin 1.2s ease-in-out",
                display:"inline-block",
              }}>✨</div>
              <div style={{color:"#fff",fontSize:14,marginTop:16,letterSpacing:3}}>祈願中…</div>
            </div>
          ) : gachaResult && gachaResult.type === "character" ? (
            <div style={{
              background:"linear-gradient(180deg,#fffbeb,#fff)",borderRadius:24,padding:"36px 28px",
              width:300,textAlign:"center",
              animation:"resultPop .5s cubic-bezier(.34,1.56,.64,1)",
              border:"2px solid #fbbf24",
              boxShadow:"0 0 40px #fbbf2455",
            }}>
              <div style={{
                fontSize:9,letterSpacing:4,marginBottom:8,fontWeight:800,color:"#92400e",
              }}>UR — 新しい仲間！★★★</div>
              <img src={getCharacterStageImage(gachaResult, calcCharLevel(charXP[gachaResult.id]||0).lv)} alt={gachaResult.name} style={{
                width:140,height:140,objectFit:"contain",margin:"0 auto 12px",display:"block",
                filter:"drop-shadow(0 0 20px #fbbf2488)",
              }} onError={e=>{e.target.style.display="none";}}/>
              <div style={{fontSize:20,fontWeight:800,marginBottom:6,color:"#92400e"}}>
                {gachaResult.name}
              </div>
              <div style={{
                display:"inline-block",fontSize:11,fontWeight:700,color:"#a16207",
                background:"#fef3c7",padding:"4px 12px",borderRadius:999,marginBottom:14,
              }}>{gachaResult.passiveDesc}</div>
              <div style={{fontSize:12,color:"#78716c",marginBottom:24,fontStyle:"italic"}}>
                "{gachaResult.flavor}"
              </div>
              <button onClick={()=>setGachaResult(null)} style={{
                width:"100%",padding:"12px",borderRadius:12,border:"none",cursor:"pointer",
                background:"linear-gradient(90deg,#f59e0b,#fbbf24)",
                color:"#fff",fontWeight:800,fontSize:14,letterSpacing:2,
              }}>閉じる</button>
            </div>
          ) : gachaResult && (
            <div style={{
              background:"#fff",borderRadius:24,padding:"36px 28px",
              width:300,textAlign:"center",
              animation:"resultPop .5s cubic-bezier(.34,1.56,.64,1)",
            }}>
              <div style={{
                fontSize:9,letterSpacing:4,marginBottom:8,fontWeight:700,
                color:gachaResult.rarity==="SSR"?"#92400e":gachaResult.rarity==="SR"?"#5b21b6":"#1e40af",
              }}>{gachaResult.rarity} — {gachaResult.rarity==="SSR"?"超絶！！":gachaResult.rarity==="SR"?"レア！":"GOOD"}</div>
              <div style={{
                fontSize:64,marginBottom:12,
                filter:`drop-shadow(0 0 16px ${gachaResult.color})`,
              }}>{gachaResult.icon}</div>
              <div style={{
                fontSize:20,fontWeight:800,marginBottom:8,
                color:gachaResult.color,
              }}>{gachaResult.label}</div>
              <div style={{fontSize:12,color:"#78716c",marginBottom:24}}>{gachaResult.desc}</div>
              <button onClick={()=>setGachaResult(null)} style={{
                width:"100%",padding:"12px",borderRadius:12,border:"none",cursor:"pointer",
                background:gachaResult.rarity==="SSR"
                  ?"linear-gradient(90deg,#f59e0b,#f0c060)"
                  :gachaResult.rarity==="SR"
                  ?"linear-gradient(90deg,#8b5cf6,#a78bfa)"
                  :"linear-gradient(90deg,#3b82f6,#60a5fa)",
                color:"#fff",fontWeight:800,fontSize:14,letterSpacing:2,
              }}>閉じる</button>
            </div>
          )}
        </div>
      )}

      {/* ── LEVEL UP MODAL ── */}
      {levelUp && (
        <LevelUpModal
          oldLv={levelUp.oldLv}
          newLv={levelUp.newLv}
          stage={getCharStage(levelUp.newLv)}
          onClose={()=>setLevelUp(null)}/>
      )}

      {/* ── TOAST ── */}
      {toast && (
        <div style={{
          position:"fixed",bottom:110,right:16,zIndex:300,
          background:"#f5f2ee",border:`1px solid ${toast.color}55`,
          borderRadius:10,padding:"10px 16px",
          fontSize:13,fontWeight:700,color:toast.color,
          animation:"toastIn .3s ease",
          boxShadow:`0 4px 20px ${toast.color}30`,
        }}>{toast.msg}</div>
      )}
    </div>
  );
}

// ブラウザ直読み用のマウント処理。
// ※ export文はブラウザの通常スクリプトでは構文エラーになるため使用しない
const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<LifeQuest />);
