(() => {
  const { useState, useEffect, useRef, useCallback } = React;
  const FIREBASE_PROJECT_ID = "life-quest-14110";
  const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/synccodes`;
  const appStorage = (() => {
    try {
      window.localStorage.setItem("__lq_test", "1");
      window.localStorage.removeItem("__lq_test");
      return window.localStorage;
    } catch (e) {
      const mem = {};
      return {
        getItem: (k) => k in mem ? mem[k] : null,
        setItem: (k, v) => {
          mem[k] = String(v);
        },
        removeItem: (k) => {
          delete mem[k];
        }
      };
    }
  })();
  function generateSyncCode() {
    const chars = "abcdefghjkmnpqrstuvwxyz23456789";
    const part = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
    return `${part()}-${part()}`;
  }
  async function syncPush(code, dataObj) {
    const url = `${FIRESTORE_BASE}/${encodeURIComponent(code)}`;
    const body = {
      fields: {
        payload: { stringValue: JSON.stringify(dataObj) },
        updatedAt: { stringValue: (/* @__PURE__ */ new Date()).toISOString() }
      }
    };
    const res = await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`sync push failed: ${res.status}`);
    return true;
  }
  async function syncPull(code) {
    const url = `${FIRESTORE_BASE}/${encodeURIComponent(code)}`;
    const res = await fetch(url);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`sync pull failed: ${res.status}`);
    const json = await res.json();
    const payload = json.fields?.payload?.stringValue;
    if (!payload) return null;
    return { data: JSON.parse(payload), updatedAt: json.fields?.updatedAt?.stringValue ?? null };
  }
  async function syncPeekUpdatedAt(code) {
    try {
      const url = `${FIRESTORE_BASE}/${encodeURIComponent(code)}?mask.fieldPaths=updatedAt`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const json = await res.json();
      return json.fields?.updatedAt?.stringValue ?? null;
    } catch (e) {
      return null;
    }
  }
  const CHAR_IMAGE_BASE = "https://nejio.github.io/life-quest/characters/";
  const CHAR_MAX_LEVEL = 10;
  const CHAR_EVOLUTION_LEVELS = [1, 4, 8];
  function xpForCharLevel(lv) {
    return Math.floor(200 * Math.pow(1.25, lv - 1));
  }
  function calcCharLevel(totalXP) {
    let lv = 1, xp = totalXP;
    while (lv < CHAR_MAX_LEVEL && xp >= xpForCharLevel(lv)) {
      xp -= xpForCharLevel(lv);
      lv++;
    }
    const needed = lv >= CHAR_MAX_LEVEL ? 0 : xpForCharLevel(lv);
    return { lv, current: xp, needed, isMax: lv >= CHAR_MAX_LEVEL };
  }
  const DEFAULT_SCHEDULE = {
    wake: "07:00",
    sleep: "23:00",
    hasWork: true,
    workStart: "09:00",
    workEnd: "18:00",
    hasCommute: false,
    commuteMode: "transit",
    commuteOneWayMin: "30"
  };
  const LIFE_BUFFER_MIN = 120;
  const DAILY_CAP_MIN_FLOOR = 60;
  const DAILY_CAP_MIN_CEIL = 360;
  const EXPLORE_DAILY_LIMIT = 3;
  const COMMUTE_ELIGIBLE_CATS = ["study", "reading"];
  function timeToMinutes(t) {
    const [h, m] = (t || "00:00").split(":").map(Number);
    return (h || 0) * 60 + (m || 0);
  }
  function calcDailyCapMinutes(schedule) {
    const s = schedule || DEFAULT_SCHEDULE;
    const wake = timeToMinutes(s.wake);
    let sleep = timeToMinutes(s.sleep);
    if (sleep <= wake) sleep += 24 * 60;
    let awake = sleep - wake;
    if (s.hasWork) {
      let ws = timeToMinutes(s.workStart);
      let we = timeToMinutes(s.workEnd);
      if (we <= ws) we += 24 * 60;
      awake -= we - ws;
    }
    const cap = awake - LIFE_BUFFER_MIN;
    return Math.max(DAILY_CAP_MIN_FLOOR, Math.min(cap, DAILY_CAP_MIN_CEIL));
  }
  function calcCommuteBonusMinutes(schedule) {
    const s = schedule || DEFAULT_SCHEDULE;
    if (!s.hasCommute || s.commuteMode !== "transit") return 0;
    const oneWay = Number(s.commuteOneWayMin) || 0;
    return Math.max(0, oneWay * 2);
  }
  const GACHA_CHARACTERS = [
    {
      id: "c001",
      name: "\u30A8\u30EA\u30AB",
      rarity: "UR",
      stages: [
        CHAR_IMAGE_BASE + "swordgirl_stage1.png",
        // キャラLv1〜：旅立ちの剣士
        CHAR_IMAGE_BASE + "swordgirl_stage2.png",
        // キャラLv4〜：翠嵐の剣士
        CHAR_IMAGE_BASE + "swordgirl_stage3.png"
        // キャラLv8〜：紅蓮の支配者
      ],
      passive: { type: "xp", cat: "exercise", val: 0.15 },
      passiveDesc: "\u7B4B\u529BEXP +15%",
      flavor: "\u4E00\u4ECB\u306E\u65C5\u4EBA\u3060\u3063\u305F\u5C11\u5973\u306F\u5263\u3092\u53D6\u308A\u3001\u98A8\u7E8F\u3046\u5263\u58EB\u3068\u3057\u3066\u935B\u932C\u3092\u91CD\u306D\u3001\u3084\u304C\u3066\u7D05\u84EE\u306E\u708E\u3092\u8EAB\u306B\u7E8F\u3046\u652F\u914D\u8005\u3078\u3068\u81F3\u3063\u305F\u3002"
    }
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
  function getCharacterStageImage(char, charLv) {
    if (!char?.stages?.length) return null;
    let idx = 0;
    for (let i = 0; i < CHAR_EVOLUTION_LEVELS.length; i++) {
      if (charLv >= CHAR_EVOLUTION_LEVELS[i]) idx = i;
    }
    return char.stages[Math.min(idx, char.stages.length - 1)];
  }
  const CHARACTER_DROP_RATE = 0.01;
  function drawCharacterDrop(ownedCharIds) {
    if (GACHA_CHARACTERS.length === 0) return null;
    if (Math.random() >= CHARACTER_DROP_RATE) return null;
    const candidates = GACHA_CHARACTERS.filter((c) => !ownedCharIds.includes(c.id));
    if (candidates.length === 0) return null;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }
  const AVATAR_IMAGE_BASE = "https://nejio.github.io/life-quest/avatars/";
  const CHAR_IMAGES = {
    wanderer: AVATAR_IMAGE_BASE + "wanderer.png",
    acolyte: AVATAR_IMAGE_BASE + "acolyte.png",
    knight: AVATAR_IMAGE_BASE + "knight.png",
    archon: AVATAR_IMAGE_BASE + "archon.png",
    sovereign: AVATAR_IMAGE_BASE + "sovereign.png"
  };
  const CATEGORIES = [
    {
      id: "study",
      label: "\u77E5\u529B",
      en: "INT",
      icon: "\u2726",
      color: "#3b82f6",
      glow: "#1d4ed8",
      xpRate: 9,
      mode: "time",
      desc: "\u52C9\u5F37\u30FB\u8CC7\u683C\u5B66\u7FD2\u30FB\u8A9E\u5B66\u30FB\u30D7\u30ED\u30B0\u30E9\u30DF\u30F3\u30B0\u30FB\u30EA\u30B5\u30FC\u30C1"
    },
    {
      id: "exercise",
      label: "\u7B4B\u529B",
      en: "STRENGTH",
      icon: "\u25C8",
      color: "#fb923c",
      glow: "#c2410c",
      xpRate: 9,
      mode: "time",
      desc: "\u904B\u52D5\u30FB\u30C8\u30EC\u30FC\u30CB\u30F3\u30B0\u30FB\u30B9\u30DD\u30FC\u30C4\u30FB\u30E8\u30AC"
    },
    {
      id: "reading",
      label: "\u7CBE\u795E",
      en: "MIND",
      icon: "\u274B",
      color: "#facc15",
      glow: "#a16207",
      xpRate: 9,
      mode: "time",
      desc: "\u8AAD\u66F8\u30FB\u7791\u60F3\u30FB\u30B8\u30E3\u30FC\u30CA\u30EA\u30F3\u30B0\u30FB\u81EA\u5DF1\u53CD\u7701"
    },
    {
      id: "art",
      label: "\u5275\u9020",
      en: "CRAFT",
      icon: "\u25CE",
      color: "#a78bfa",
      glow: "#6d28d9",
      xpRate: 9,
      mode: "time",
      desc: "\u8DA3\u5473\u30FB\u5236\u4F5C\u30FB\u30A4\u30E9\u30B9\u30C8\u30FB\u97F3\u697D\u306A\u3069"
    },
    {
      id: "other",
      label: "\u63A2\u7D22",
      en: "EXPLORE",
      icon: "\u25C7",
      color: "#4ade80",
      glow: "#15803d",
      baseXP: 300,
      mode: "count",
      desc: "\u65B0\u3057\u3044\u5834\u6240\u30FB\u4F53\u9A13\u30FB\u4EBA\u3068\u306E\u51FA\u4F1A\u3044\u3092\u8A18\u9332"
    },
    {
      id: "health",
      label: "\u4F53\u529B",
      en: "HEALTH",
      icon: "\u2665",
      color: "#f87171",
      glow: "#b91c1c",
      checkXP: 12,
      mode: "check",
      desc: "\u826F\u3044\u7FD2\u6163\u306E\u30C1\u30A7\u30C3\u30AF\u30EA\u30B9\u30C8\uFF08\u7761\u7720\u30FB\u98DF\u4E8B\u306A\u3069\uFF09"
    }
  ];
  const HEALTH_DIFFICULTY = {
    easy: { label: "\u304B\u3093\u305F\u3093", xp: 15, color: "#4ade80" },
    normal: { label: "\u3075\u3064\u3046", xp: 25, color: "#facc15" },
    hard: { label: "\u304D\u3064\u3044", xp: 40, color: "#f87171" }
  };
  const DEFAULT_HEALTH_ITEMS = [
    { id: "h1", label: "23\u6642\u307E\u3067\u306B\u5C31\u5BDD", icon: "\u{1F319}", difficulty: "normal", xp: 25, group: "sleep" },
    { id: "h5", label: "22\u6642\u307E\u3067\u306B\u5C31\u5BDD", icon: "\u{1F311}", difficulty: "hard", xp: 40, group: "sleep" },
    { id: "h6", label: "6\u6642\u307E\u3067\u306B\u8D77\u304D\u308B", icon: "\u23F0", difficulty: "normal", xp: 25, group: "wake" },
    { id: "h7", label: "5\u6642\u307E\u3067\u306B\u8D77\u304D\u308B", icon: "\u{1F305}", difficulty: "hard", xp: 40, group: "wake" },
    { id: "h2", label: "\u30B8\u30E3\u30F3\u30AF\u30D5\u30FC\u30C9\u56DE\u907F", icon: "\u{1F957}", difficulty: "easy", xp: 15 },
    { id: "h3", label: "\u6C34\u30922L\u4EE5\u4E0A\u98F2\u3080", icon: "\u{1F4A7}", difficulty: "easy", xp: 15 },
    { id: "h4", label: "\u671D\u98DF\u3092\u3068\u308B", icon: "\u{1F373}", difficulty: "easy", xp: 15 }
  ];
  function migrateHealthItems(saved) {
    if (!saved) return DEFAULT_HEALTH_ITEMS;
    const merged = saved.map((item) => {
      const def = DEFAULT_HEALTH_ITEMS.find((d) => d.id === item.id);
      return def ? { ...item, ...def } : { ...item, xp: item.xp ?? 12 };
    });
    const mergedIds = new Set(merged.map((i) => i.id));
    const missingDefaults = DEFAULT_HEALTH_ITEMS.filter((d) => !mergedIds.has(d.id));
    const combined = [...merged, ...missingDefaults];
    const defaultLabels = new Set(DEFAULT_HEALTH_ITEMS.map((d) => d.label));
    const deduped = combined.filter((item) => {
      const isDefault = DEFAULT_HEALTH_ITEMS.some((d) => d.id === item.id);
      if (isDefault) return true;
      if (defaultLabels.has(item.label)) return false;
      return true;
    });
    const defaultOrder = DEFAULT_HEALTH_ITEMS.map((d) => d.id);
    const defaultsInOrder = defaultOrder.map((id) => deduped.find((i) => i.id === id)).filter(Boolean);
    const customItems = deduped.filter((i) => !defaultOrder.includes(i.id));
    return [...defaultsInOrder, ...customItems];
  }
  const DEFAULT_ACTIVITIES = {
    study: ["\u8CC7\u683C\u5B66\u7FD2", "\u8A9E\u5B66\u5B66\u7FD2", "\u30D7\u30ED\u30B0\u30E9\u30DF\u30F3\u30B0", "\u30EA\u30B5\u30FC\u30C1\u30FB\u8ABF\u3079\u3082\u306E", "\u30AA\u30F3\u30E9\u30A4\u30F3\u8B1B\u5EA7"],
    exercise: ["\u7B4B\u30C8\u30EC", "\u30E9\u30F3\u30CB\u30F3\u30B0", "\u30E8\u30AC\u30FB\u30B9\u30C8\u30EC\u30C3\u30C1", "\u30A6\u30A9\u30FC\u30AD\u30F3\u30B0", "\u30B9\u30DD\u30FC\u30C4"],
    reading: ["\u5C0F\u8AAC", "\u30D3\u30B8\u30CD\u30B9\u66F8\u30FB\u6559\u990A\u66F8", "\u7791\u60F3\u30FB\u30DE\u30A4\u30F3\u30C9\u30D5\u30EB\u30CD\u30B9", "\u30B8\u30E3\u30FC\u30CA\u30EA\u30F3\u30B0"],
    art: ["\u30A4\u30E9\u30B9\u30C8", "\u97F3\u697D", "writing\u30FB\u6587\u7AE0\u5236\u4F5C", "DIY\u30FB\u5DE5\u4F5C"]
  };
  const CHAR_STAGES = [
    { minLv: 1, name: "Wanderer", title_ja: "\u653E\u6D6A\u8005", rarity: 1, primaryColor: "#60a5fa", accentColor: "#1d4ed8" },
    { minLv: 5, name: "Acolyte", title_ja: "\u5F93\u8005", rarity: 2, primaryColor: "#34d399", accentColor: "#065f46" },
    { minLv: 12, name: "Knight", title_ja: "\u9A0E\u58EB", rarity: 3, primaryColor: "#a78bfa", accentColor: "#5b21b6" },
    { minLv: 34, name: "Archon", title_ja: "\u57F7\u653F\u795E", rarity: 4, primaryColor: "#fb923c", accentColor: "#9a3412" },
    { minLv: 50, name: "Sovereign", title_ja: "\u8987\u738B", rarity: 5, primaryColor: "#f0c060", accentColor: "#92400e" }
  ];
  const SKILL_TREE = {
    study: [
      { id: "s1", label: "\u77E5\u8B58\u306E\u706F\u706B", en: "Ember of Knowledge", req: null, minLv: 1, type: "xp", val: 0.05, desc: "\u77E5\u529BEXP +5%" },
      { id: "s2", label: "\u92FC\u306E\u8A18\u61B6", en: "Steel Memory", req: "s1", minLv: 17, type: "xp", val: 0.1, desc: "\u77E5\u529BEXP +10%\u3002\u8A18\u61B6\u306F\u92FC\u3088\u308A\u5F37\u304F\u3002" },
      { id: "s3", label: "\u6DF1\u6DF5\u306E\u66F8", en: "Tome of Abyss", req: "s2", minLv: 32, type: "xp", val: 0.15, desc: "\u77E5\u529BEXP +15%\u3002\u6DF1\u304F\u8AAD\u3080\u307B\u3069\u5F37\u304F\u306A\u308B\u3002" },
      { id: "s4", label: "\u8CE2\u8005\u306E\u77F3", en: "Philosopher's Stone", req: "s1", minLv: 23, type: "gem", val: 1, desc: "\u77E5\u529B\u8A18\u9332\u3067\u30EB\u30FC\u30F3\u77F3+1\u3002\u77E5\u8B58\u304C\u5BCC\u3092\u751F\u3080\u3002" },
      { id: "s5", label: "\u5168\u77E5\u306E\u773C", en: "Eye of Omniscience", req: ["s3", "s4"], minLv: 36, type: "xp", val: 0.2, desc: "\u77E5\u529BEXP +20%\u3002\u5168\u3066\u3092\u898B\u901A\u3059\u5883\u5730\u3002" },
      { id: "s6", label: "\u6642\u9593\u5727\u7E2E", en: "Time Compression", req: "s2", minLv: 27, type: "xp", val: 0.2, desc: "15\u5206\u4EE5\u4E0B\u306E\u77ED\u6642\u9593\u5B66\u7FD2\u3082EXP +20%\u3002" },
      { id: "s7", label: "\u4E0D\u6EC5\u306E\u63A2\u7A76", en: "Undying Inquiry", req: "s5", minLv: 40, type: "streak", val: 1, desc: "\u30B9\u30C8\u30EA\u30FC\u30AF\u304C1\u56DE\u3060\u3051\u5207\u308C\u305A\u306B\u6E08\u3080\u5B88\u8B77\u3002" }
    ],
    exercise: [
      { id: "e1", label: "\u9244\u306E\u610F\u5FD7", en: "Iron Will", req: null, minLv: 1, type: "xp", val: 0.05, desc: "\u7B4B\u529BEXP +5%" },
      { id: "e2", label: "\u8840\u8089\u306E\u93A7", en: "Flesh Armor", req: "e1", minLv: 17, type: "xp", val: 0.1, desc: "\u7B4B\u529BEXP +10%\u3002\u9650\u754C\u3092\u8D85\u3048\u3088\u3002" },
      { id: "e3", label: "\u795E\u901F", en: "Godspeed", req: "e2", minLv: 32, type: "xp", val: 0.15, desc: "\u7B4B\u529BEXP +15%\u3002\u96F7\u3088\u308A\u901F\u304F\u52D5\u3051\u3002" },
      { id: "e4", label: "\u6226\u58EB\u306E\u8840", en: "Warrior's Blood", req: "e1", minLv: 23, type: "gem", val: 1, desc: "\u7B4B\u529B\u8A18\u9332\u3067\u30EB\u30FC\u30F3\u77F3+1\u3002\u6C57\u306F\u5B9D\u77F3\u3060\u3002" },
      { id: "e5", label: "\u8987\u738B\u964D\u81E8", en: "Sovereign's Descent", req: ["e3", "e4"], minLv: 36, type: "xp", val: 0.2, desc: "\u7B4B\u529BEXP +20%\u3002\u8AB0\u3082\u6B62\u3081\u3089\u308C\u306A\u3044\u3002" },
      { id: "e6", label: "\u4E0D\u5C48\u306E\u95D8\u5FD7", en: "Indomitable Spirit", req: "e2", minLv: 27, type: "streak", val: 1, desc: "\u30B9\u30C8\u30EA\u30FC\u30AF\u5B88\u8B77\xD71\u3002\u6298\u308C\u306A\u3044\u5FC3\u3002" },
      { id: "e7", label: "\u795E\u57DF", en: "Divine Realm", req: "e5", minLv: 40, type: "gacha", val: 0.05, desc: "\u30AC\u30C1\u30E3SSR\u6392\u51FA\u7387+5%\u3002\u795E\u306E\u6069\u5BF5\u3002" }
    ],
    reading: [
      { id: "r1", label: "\u9759\u5BC2\u306E\u9580", en: "Gate of Silence", req: null, minLv: 1, type: "xp", val: 0.05, desc: "\u7CBE\u795EEXP +5%" },
      { id: "r2", label: "\u5185\u306A\u308B\u58F0", en: "Inner Voice", req: "r1", minLv: 17, type: "xp", val: 0.1, desc: "\u7CBE\u795EEXP +10%\u3002\u9B42\u306E\u6DF1\u307F\u3078\u3002" },
      { id: "r3", label: "\u865A\u7A7A\u306E\u93E1", en: "Mirror of the Void", req: "r2", minLv: 32, type: "xp", val: 0.15, desc: "\u7CBE\u795EEXP +15%\u3002\u5DF1\u3092\u6620\u3059\u93E1\u3002" },
      { id: "r4", label: "\u5922\u60F3\u5BB6\u306E\u523B\u5370", en: "Dreamer's Mark", req: "r1", minLv: 23, type: "gem", val: 1, desc: "\u7CBE\u795E\u8A18\u9332\u3067\u30EB\u30FC\u30F3\u77F3+1\u3002\u5922\u304C\u73FE\u5B9F\u3092\u5909\u3048\u308B\u3002" },
      { id: "r5", label: "\u6D85\u69C3", en: "Nirvana", req: ["r3", "r4"], minLv: 36, type: "xp", val: 0.2, desc: "\u7CBE\u795EEXP +20%\u3002\u5B8C\u5168\u306A\u308B\u609F\u308A\u3002" },
      { id: "r6", label: "\u6708\u5149\u306E\u52A0\u8B77", en: "Moonlight Ward", req: "r2", minLv: 27, type: "streak", val: 1, desc: "\u30B9\u30C8\u30EA\u30FC\u30AF\u5B88\u8B77\xD71\u3002\u6708\u304C\u5B88\u8B77\u3059\u308B\u3002" },
      { id: "r7", label: "\u5343\u306E\u8A00\u8449", en: "Thousand Words", req: "r5", minLv: 40, type: "gacha", val: 0.05, desc: "\u30AC\u30C1\u30E3SSR\u6392\u51FA\u7387+5%\u3002\u8A00\u8449\u306E\u529B\u3002" }
    ],
    art: [
      { id: "a1", label: "\u5275\u9020\u306E\u706B\u82B1", en: "Creative Spark", req: null, minLv: 1, type: "xp", val: 0.05, desc: "\u5275\u9020EXP +5%" },
      { id: "a2", label: "\u719F\u7DF4\u306E\u624B", en: "Master's Hand", req: "a1", minLv: 17, type: "xp", val: 0.1, desc: "\u5275\u9020EXP +10%\u3002\u9053\u5177\u306F\u624B\u306E\u5EF6\u9577\u3002" },
      { id: "a3", label: "\u970A\u611F\u306E\u5D50", en: "Storm of Inspiration", req: "a2", minLv: 32, type: "xp", val: 0.15, desc: "\u5275\u9020EXP +15%\u3002\u5D50\u304C\u5091\u4F5C\u3092\u751F\u3080\u3002" },
      { id: "a4", label: "\u932C\u91D1\u306E\u7B46", en: "Alchemist's Brush", req: "a1", minLv: 23, type: "gem", val: 2, desc: "\u5275\u9020\u8A18\u9332\u3067\u30EB\u30FC\u30F3\u77F3+2\u3002\u82B8\u8853\u306F\u91D1\u306A\u308A\u3002" },
      { id: "a5", label: "\u795E\u57DF\u306E\u82B8\u8853", en: "Divine Artistry", req: ["a3", "a4"], minLv: 36, type: "xp", val: 0.2, desc: "\u5275\u9020EXP +20%\u3002\u795E\u3059\u3089\u5AC9\u59AC\u3059\u308B\u3002" },
      { id: "a6", label: "\u7F8E\u306E\u7D50\u6676", en: "Crystal of Beauty", req: "a2", minLv: 27, type: "gacha", val: 0.05, desc: "\u30AC\u30C1\u30E3SSR\u6392\u51FA\u7387+5%\u3002\u7F8E\u3057\u3055\u304C\u904B\u3092\u547C\u3076\u3002" },
      { id: "a7", label: "\u5275\u4E16", en: "Genesis", req: "a5", minLv: 40, type: "gem", val: 3, desc: "\u5275\u9020\u8A18\u9332\u3067\u30EB\u30FC\u30F3\u77F3+3\u3002\u65B0\u4E16\u754C\u3092\u5275\u308C\u3002" }
    ],
    other: [
      { id: "o1", label: "\u653E\u6D6A\u8005\u306E\u672C\u80FD", en: "Wanderer's Instinct", req: null, minLv: 1, type: "xp", val: 0.05, desc: "\u63A2\u7D22EXP +5%" },
      { id: "o2", label: "\u7E01\u306E\u7CF8", en: "Thread of Fate", req: "o1", minLv: 17, type: "gem", val: 1, desc: "\u63A2\u7D22\u8A18\u9332\u3067\u30EB\u30FC\u30F3\u77F3+1\u3002\u51FA\u4F1A\u3044\u304C\u8CA1\u7523\u3002" },
      { id: "o3", label: "\u5730\u5E73\u306E\u5F7C\u65B9", en: "Beyond the Horizon", req: "o2", minLv: 32, type: "xp", val: 0.15, desc: "\u63A2\u7D22EXP +15%\u3002\u9650\u754C\u306E\u5148\u3078\u3002" },
      { id: "o4", label: "\u661F\u8AAD\u307F\u306E\u76EE", en: "Star Reader's Eye", req: "o1", minLv: 23, type: "xp", val: 0.1, desc: "\u63A2\u7D22EXP +10%\u3002\u661F\u304C\u9053\u3092\u793A\u3059\u3002" },
      { id: "o5", label: "\u4E16\u754C\u306E\u6B69\u304D\u65B9", en: "Ways of the World", req: ["o3", "o4"], minLv: 36, type: "xp", val: 0.2, desc: "\u63A2\u7D22EXP +20%\u3002\u5168\u3066\u306E\u9053\u3092\u77E5\u308B\u8005\u3002" },
      { id: "o6", label: "\u5E78\u904B\u306E\u5973\u795E", en: "Lady of Fortune", req: "o2", minLv: 27, type: "gacha", val: 0.05, desc: "\u30AC\u30C1\u30E3SSR\u6392\u51FA\u7387+5%\u3002\u904B\u547D\u306B\u611B\u3055\u308C\u308B\u3002" },
      { id: "o7", label: "\u4F1D\u8AAC\u306E\u653E\u6D6A", en: "Legendary Wandering", req: "o5", minLv: 40, type: "gem", val: 2, desc: "\u63A2\u7D22\u8A18\u9332\u3067\u30EB\u30FC\u30F3\u77F3+2\u3002\u4F1D\u8AAC\u3092\u523B\u3081\u3002" }
    ]
  };
  const ELEMENT_INFO = {
    study: { name: "\u6C34", color: "#3b82f6", light: "#dbeafe", dark: "#1d4ed8" },
    exercise: { name: "\u708E", color: "#f97316", light: "#fed7aa", dark: "#c2410c" },
    reading: { name: "\u571F", color: "#a16207", light: "#fde8c8", dark: "#78350f" },
    art: { name: "\u96F7", color: "#d946ef", light: "#f5d0fe", dark: "#a21caf" },
    other: { name: "\u98A8", color: "#34d399", light: "#bbf7d0", dark: "#15803d" }
  };
  const MAGIC_GRIMOIRE = {
    // 水属性（知力）— 制御・妨害系。直接火力より「相手の動きを封じる」魔法が多い
    study: [
      {
        id: "ms1",
        label: "\u6C34\u5F3E",
        req: 5,
        tier: 1,
        power: 12,
        type: "attack",
        target: "\u5358\u4F53",
        desc: "\u57FA\u672C\u306E\u6C34\u5C5E\u6027\u9B54\u6CD5\u3002\u6700\u521D\u306E\u4E00\u6EF4\u3002",
        flavor: "\u5C0F\u3055\u306A\u6C34\u306E\u584A\u3092\u6483\u3061\u51FA\u3059\u3002\u5A01\u529B\u306F\u4F4E\u3044\u304C\u3001\u547D\u4E2D\u7387\u304C\u9AD8\u3044\u3002"
      },
      {
        id: "ms2",
        label: "\u6E05\u6D41",
        req: 15,
        tier: 1,
        power: 10,
        type: "debuff",
        target: "\u5358\u4F53",
        desc: "\u6F84\u3093\u3060\u6D41\u308C\u304C\u601D\u8003\u3092\u7814\u304E\u6F84\u307E\u3059\u3002",
        flavor: "\u6575\u306E\u52D5\u304D\u3092\u920D\u3089\u305B\u308B\u6E05\u6D41\u3092\u307E\u3068\u308F\u305B\u308B\u3002\u547D\u4E2D\u6642\u3001\u6575\u306E\u884C\u52D5\u901F\u5EA6-15%\u3002"
      },
      {
        id: "ms3",
        label: "\u9727\u96E8",
        req: 30,
        tier: 2,
        power: 8,
        type: "dot",
        target: "\u7BC4\u56F2",
        desc: "\u7D30\u3084\u304B\u306A\u77E5\u8B58\u304C\u964D\u308A\u7A4D\u3082\u308B\u3002",
        flavor: "\u7D30\u304B\u306A\u6C34\u6EF4\u304C\u8FBA\u308A\u4E00\u5E2F\u306B\u964D\u308A\u6CE8\u304E\u30013\u30BF\u30FC\u30F3\u306E\u9593\u3058\u308F\u3058\u308F\u3068\u30C0\u30E1\u30FC\u30B8\u3092\u4E0E\u3048\u7D9A\u3051\u308B\u3002"
      },
      {
        id: "ms4",
        label: "\u6FC0\u6D41",
        req: 50,
        tier: 2,
        power: 28,
        type: "attack",
        target: "\u5358\u4F53",
        desc: "\u52E2\u3044\u3092\u5897\u3057\u305F\u77E5\u306E\u5954\u6D41\u3002",
        flavor: "\u5727\u5012\u7684\u306A\u6C34\u6D41\u3067\u6575\u3092\u62BC\u3057\u6D41\u3059\u3002\u30CE\u30C3\u30AF\u30D0\u30C3\u30AF\u52B9\u679C\u3042\u308A\u3002"
      },
      {
        id: "ms5",
        label: "\u6C37\u7D50\u754C",
        req: 80,
        tier: 2,
        power: 6,
        type: "debuff",
        target: "\u7BC4\u56F2",
        desc: "\u601D\u8003\u3092\u51CD\u7D50\u3055\u305B\u3001\u672C\u8CEA\u3060\u3051\u3092\u6B8B\u3059\u3002",
        flavor: "\u5468\u56F2\u4E00\u5E2F\u3092\u51CD\u3089\u305B\u3001\u6575\u5168\u4F53\u306E\u884C\u52D5\u30921\u30BF\u30FC\u30F3\u5C01\u3058\u308B\u3002\u4F4E\u5A01\u529B\u3060\u304C\u62D8\u675F\u529B\u306F\u7D76\u5927\u3002"
      },
      {
        id: "ms6",
        label: "\u5927\u6E26\u6F6E",
        req: 120,
        tier: 3,
        power: 45,
        type: "attack",
        target: "\u7BC4\u56F2",
        desc: "\u5168\u3066\u3092\u98F2\u307F\u8FBC\u3080\u77E5\u8B58\u306E\u6E26\u3002",
        flavor: "\u5DE8\u5927\u306A\u6E26\u304C\u6226\u5834\u5168\u4F53\u3092\u98F2\u307F\u8FBC\u3080\u3002\u7BC4\u56F2\u5185\u306E\u6575\u3059\u3079\u3066\u306B\u5927\u30C0\u30E1\u30FC\u30B8\u3002"
      },
      {
        id: "ms7",
        label: "\u6DF1\u6DF5\u306E\u6D77",
        req: 180,
        tier: 3,
        power: 20,
        type: "special",
        target: "\u5168\u4F53",
        desc: "\u6975\u3081\u3057\u8005\u3060\u3051\u304C\u8FBF\u308A\u7740\u304F\u6DF1\u6DF5\u3002",
        flavor: "\u6226\u5834\u305D\u306E\u3082\u306E\u3092\u6DF1\u6D77\u306B\u5909\u3048\u308B\u7981\u546A\u3002\u6BCE\u30BF\u30FC\u30F3\u7D99\u7D9A\u30C0\u30E1\u30FC\u30B8\u3092\u4E0E\u3048\u3064\u3064\u3001\u81EA\u8EAB\u306E\u9B54\u529B\u3092\u56DE\u5FA9\u3057\u7D9A\u3051\u308B\u3002"
      }
    ],
    // 炎属性（筋力）— 高火力・継続ダメージ。シンプルにパワフルな殴り合い向き
    exercise: [
      {
        id: "me1",
        label: "\u706B\u7A2E",
        req: 5,
        tier: 1,
        power: 14,
        type: "attack",
        target: "\u5358\u4F53",
        desc: "\u57FA\u672C\u306E\u708E\u5C5E\u6027\u9B54\u6CD5\u3002\u6700\u521D\u306E\u4E00\u706F\u3002",
        flavor: "\u5C0F\u3055\u306A\u708E\u5F3E\u3092\u653E\u3064\u3002\u7D20\u6734\u3060\u304C\u624B\u5805\u3044\u4E00\u6483\u3002"
      },
      {
        id: "me2",
        label: "\u707C\u71B1",
        req: 15,
        tier: 1,
        power: 18,
        type: "attack",
        target: "\u5358\u4F53",
        desc: "\u5185\u306B\u79D8\u3081\u305F\u95D8\u5FD7\u304C\u71C3\u3048\u4E0A\u304C\u308B\u3002",
        flavor: "\u95D8\u5FD7\u304C\u305D\u306E\u307E\u307E\u708E\u3068\u306A\u3063\u3066\u6575\u3092\u713C\u304F\u3002\u4F1A\u5FC3\u7387\u304C\u3084\u3084\u9AD8\u3044\u3002"
      },
      {
        id: "me3",
        label: "\u706B\u708E\u5F3E",
        req: 30,
        tier: 2,
        power: 24,
        type: "dot",
        target: "\u5358\u4F53",
        desc: "\u935B\u3048\u305F\u529B\u3092\u653E\u3064\u4E00\u6483\u3002",
        flavor: "\u7740\u5F3E\u5F8C\u3082\u71C3\u3048\u5E83\u304C\u308A\u30012\u30BF\u30FC\u30F3\u306B\u308F\u305F\u3063\u3066\u708E\u4E0A\u30C0\u30E1\u30FC\u30B8\u3092\u4E0E\u3048\u308B\u3002"
      },
      {
        id: "me4",
        label: "\u696D\u706B",
        req: 50,
        tier: 2,
        power: 38,
        type: "attack",
        target: "\u5358\u4F53",
        desc: "\u9650\u754C\u3092\u8D85\u3048\u305F\u95D8\u5FD7\u306E\u696D\u706B\u3002",
        flavor: "\u5DF1\u306E\u9650\u754C\u3092\u71C3\u6599\u306B\u5909\u3048\u308B\u4E00\u6483\u5FC5\u6BBA\u3002\u5A01\u529B\u306F\u9AD8\u3044\u304C\u53CD\u52D5\u3067\u81EA\u8EAB\u3082\u6D88\u8017\u3059\u308B\u3002"
      },
      {
        id: "me5",
        label: "\u7206\u708E\u6CE2",
        req: 80,
        tier: 2,
        power: 30,
        type: "attack",
        target: "\u7BC4\u56F2",
        desc: "\u935B\u932C\u306E\u6210\u679C\u304C\u7206\u767A\u7684\u306B\u958B\u82B1\u3059\u308B\u3002",
        flavor: "\u7206\u767A\u7684\u306A\u71B1\u6CE2\u304C\u5468\u56F2\u3092\u306A\u304E\u6255\u3046\u3002\u7BC4\u56F2\u5185\u306E\u6575\u5168\u54E1\u306B\u5747\u7B49\u30C0\u30E1\u30FC\u30B8\u3002"
      },
      {
        id: "me6",
        label: "\u4E0D\u6B7B\u9CE5\u306E\u7FFC",
        req: 120,
        tier: 3,
        power: 0,
        type: "heal",
        target: "\u81EA\u8EAB",
        desc: "\u4F55\u5EA6\u5012\u308C\u3066\u3082\u7ACB\u3061\u4E0A\u304C\u308B\u4E0D\u5C48\u306E\u8A3C\u3002",
        flavor: "\u529B\u5C3D\u304D\u3066\u3082\u708E\u306E\u7FFC\u3067\u8607\u308B\u3002\u6226\u95D8\u4E0D\u80FD\u306B\u306A\u3063\u305F\u77AC\u9593\u3001\u4E00\u5EA6\u3060\u3051HP\u309250%\u56DE\u5FA9\u3057\u3066\u5FA9\u6D3B\u3002"
      },
      {
        id: "me7",
        label: "\u8987\u738B\u306E\u5486\u54EE",
        req: 180,
        tier: 3,
        power: 60,
        type: "attack",
        target: "\u5168\u4F53",
        desc: "\u9802\u70B9\u306B\u7ACB\u3064\u8005\u3060\u3051\u304C\u7E8F\u3046\u708E\u3002",
        flavor: "\u5486\u54EE\u4E00\u3064\u3067\u6226\u5834\u3092\u713C\u304D\u5C3D\u304F\u3059\u3002\u5168\u4F53\u306B\u5927\u30C0\u30E1\u30FC\u30B8\u3001\u3055\u3089\u306B\u6575\u5168\u4F53\u30923\u30BF\u30FC\u30F3\u602F\u307E\u305B\u308B\u3002"
      }
    ],
    // 土属性（精神）— 防御・回復・耐久。攻撃面では地味だが長期戦に強い
    reading: [
      {
        id: "mr1",
        label: "\u5C0F\u77F3\u5F3E",
        req: 5,
        tier: 1,
        power: 10,
        type: "attack",
        target: "\u5358\u4F53",
        desc: "\u57FA\u672C\u306E\u571F\u5C5E\u6027\u9B54\u6CD5\u3002\u6700\u521D\u306E\u4E00\u6295\u3002",
        flavor: "\u5C0F\u3055\u306A\u77F3\u3092\u6295\u3052\u3064\u3051\u308B\u3002\u5730\u5473\u3060\u304C\u5916\u308C\u306B\u304F\u3044\u3002"
      },
      {
        id: "mr2",
        label: "\u5B89\u3089\u304E",
        req: 15,
        tier: 1,
        power: 0,
        type: "heal",
        target: "\u81EA\u8EAB",
        desc: "\u5FC3\u3092\u843D\u3061\u7740\u3051\u308B\u9759\u304B\u306A\u5B89\u606F\u3002",
        flavor: "\u6DF1\u547C\u5438\u3068\u3068\u3082\u306B\u7CBE\u795E\u3092\u6574\u3048\u3001HP\u3092\u5C11\u91CF\u56DE\u5FA9\u3059\u308B\u3002"
      },
      {
        id: "mr3",
        label: "\u571F\u58C1",
        req: 30,
        tier: 2,
        power: 0,
        type: "buff",
        target: "\u81EA\u8EAB",
        desc: "\u63FA\u308B\u304C\u306C\u610F\u5FD7\u304C\u58C1\u3068\u306A\u308B\u3002",
        flavor: "\u9811\u5F37\u306A\u571F\u306E\u58C1\u3092\u5C55\u958B\u3057\u30013\u30BF\u30FC\u30F3\u306E\u9593\u53D7\u3051\u308B\u30C0\u30E1\u30FC\u30B8\u309230%\u8EFD\u6E1B\u3059\u308B\u3002"
      },
      {
        id: "mr4",
        label: "\u6839\u306E\u7E1B\u308A",
        req: 50,
        tier: 2,
        power: 14,
        type: "debuff",
        target: "\u5358\u4F53",
        desc: "\u5185\u5074\u304B\u3089\u6E80\u3061\u308B\u78BA\u304B\u306A\u529B\u3002",
        flavor: "\u5730\u4E2D\u304B\u3089\u6839\u3092\u4F38\u3070\u3057\u6575\u306E\u8DB3\u3092\u7D61\u3081\u53D6\u308B\u30021\u30BF\u30FC\u30F3\u884C\u52D5\u4E0D\u80FD\uFF0B\u7D99\u7D9A\u30C0\u30E1\u30FC\u30B8\u3002"
      },
      {
        id: "mr5",
        label: "\u5730\u9CF4\u308A",
        req: 80,
        tier: 2,
        power: 32,
        type: "attack",
        target: "\u7BC4\u56F2",
        desc: "\u9759\u8B10\u306A\u5927\u5730\u304C\u8F5F\u304D\u3092\u3042\u3052\u308B\u3002",
        flavor: "\u5927\u5730\u305D\u306E\u3082\u306E\u3092\u63FA\u3089\u3057\u3001\u7ACB\u3063\u3066\u3044\u308B\u6575\u5168\u54E1\u306B\u3088\u308D\u3081\u304D\u30C0\u30E1\u30FC\u30B8\u3092\u4E0E\u3048\u308B\u3002"
      },
      {
        id: "mr6",
        label: "\u8056\u57DF\u7D50\u754C",
        req: 120,
        tier: 3,
        power: 0,
        type: "heal",
        target: "\u5168\u4F53",
        desc: "\u7A62\u308C\u306A\u304D\u8056\u57DF\u3092\u4F5C\u308A\u51FA\u3059\u529B\u3002",
        flavor: "\u6E05\u6D44\u306A\u7D50\u754C\u306E\u4E2D\u3001\u6BCE\u30BF\u30FC\u30F3\u81EA\u8EAB\u306EHP\u3092\u7D99\u7D9A\u56DE\u5FA9\u3059\u308B\u4E0D\u6EC5\u306E\u8056\u57DF\u3092\u5F35\u308B\u3002"
      },
      {
        id: "mr7",
        label: "\u6D85\u69C3\u306E\u5C71",
        req: 180,
        tier: 3,
        power: 50,
        type: "special",
        target: "\u5168\u4F53",
        desc: "\u609F\u308A\u306B\u81F3\u3063\u305F\u8005\u3060\u3051\u304C\u8FBF\u308A\u7740\u304F\u5883\u5730\u3002",
        flavor: "\u52D5\u304B\u3056\u308B\u3053\u3068\u5C71\u306E\u5982\u3057\u3002\u88AB\u30C0\u30E1\u30FC\u30B8\u3092\u5927\u5E45\u8EFD\u6E1B\u3057\u3064\u3064\u3001\u53CD\u5C04\u30C0\u30E1\u30FC\u30B8\u3067\u6575\u5168\u4F53\u3092\u653B\u6483\u3059\u308B\u3002"
      }
    ],
    // 雷属性（創造）— 速攻・連撃・クリティカル。ハイリスクハイリターン
    art: [
      {
        id: "ma1",
        label: "\u706B\u82B1",
        req: 5,
        tier: 1,
        power: 11,
        type: "attack",
        target: "\u5358\u4F53",
        desc: "\u57FA\u672C\u306E\u96F7\u5C5E\u6027\u9B54\u6CD5\u3002\u6700\u521D\u306E\u9583\u304D\u3002",
        flavor: "\u6307\u5148\u306B\u5C0F\u3055\u306A\u706B\u82B1\u3092\u6563\u3089\u3059\u3002\u7D20\u65E9\u304F\u7E70\u308A\u51FA\u305B\u308B\u5148\u5236\u653B\u6483\u3002"
      },
      {
        id: "ma2",
        label: "\u9583\u5149",
        req: 15,
        tier: 1,
        power: 13,
        type: "attack",
        target: "\u5358\u4F53",
        desc: "\u7A81\u7136\u306E\u3072\u3089\u3081\u304D\u304C\u8D70\u308B\u3002",
        flavor: "\u9583\u304D\u3068\u5171\u306B\u653E\u3064\u4E00\u6483\u3002\u4F1A\u5FC3\u7387+10%\u3002"
      },
      {
        id: "ma3",
        label: "\u96FB\u5149\u77F3\u706B",
        req: 30,
        tier: 2,
        power: 9,
        type: "attack",
        target: "\u5358\u4F53",
        desc: "\u77AC\u304F\u9593\u306B\u5F62\u306B\u306A\u308B\u30A2\u30A4\u30C7\u30A2\u3002",
        flavor: "\u4F4E\u5A01\u529B\u306A\u304C\u3089\u5FC5\u305A2\u56DE\u9023\u7D9A\u3067\u30D2\u30C3\u30C8\u3059\u308B\u9023\u6483\u9B54\u6CD5\u3002"
      },
      {
        id: "ma4",
        label: "\u7D2B\u96FB",
        req: 50,
        tier: 2,
        power: 34,
        type: "attack",
        target: "\u5358\u4F53",
        desc: "\u92ED\u304F\u7F8E\u3057\u3044\u5275\u9020\u306E\u9583\u5149\u3002",
        flavor: "\u92ED\u304F\u7F8E\u3057\u3044\u4E00\u6483\u3002\u4F1A\u5FC3\u6642\u306E\u30C0\u30E1\u30FC\u30B8\u500D\u7387\u304C\u901A\u5E38\u3088\u308A\u9AD8\u3044\u3002"
      },
      {
        id: "ma5",
        label: "\u96F7\u9CF4",
        req: 80,
        tier: 2,
        power: 22,
        type: "debuff",
        target: "\u7BC4\u56F2",
        desc: "\u4E16\u754C\u306B\u97FF\u304D\u6E21\u308B\u5275\u9020\u306E\u8F5F\u304D\u3002",
        flavor: "\u8F5F\u97F3\u3067\u6575\u5168\u4F53\u3092\u602F\u307E\u305B\u30011\u30BF\u30FC\u30F3\u306E\u9593\u547D\u4E2D\u7387\u3092\u4E0B\u3052\u308B\u3002"
      },
      {
        id: "ma6",
        label: "\u88C2\u7A7A\u96F7",
        req: 120,
        tier: 3,
        power: 48,
        type: "attack",
        target: "\u5358\u4F53",
        desc: "\u5E38\u8B58\u3092\u5207\u308A\u88C2\u304F\u72EC\u5275\u6027\u3002",
        flavor: "\u5E38\u8B58\u3092\u5207\u308A\u88C2\u304F\u4E00\u6483\u5FC5\u6BBA\u306E\u96F7\u6483\u3002\u9632\u5FA1\u7121\u8996\u3067\u5927\u30C0\u30E1\u30FC\u30B8\u3002"
      },
      {
        id: "ma7",
        label: "\u5275\u4E16\u306E\u96F7\u9706",
        req: 180,
        tier: 3,
        power: 55,
        type: "attack",
        target: "\u5168\u4F53",
        desc: "\u65B0\u305F\u306A\u4E16\u754C\u3092\u751F\u307F\u51FA\u3059\u529B\u3002",
        flavor: "\u5929\u5730\u5275\u9020\u306E\u96F7\u304C\u6226\u5834\u306B\u964D\u308A\u6CE8\u3050\u3002\u5168\u4F53\u306B\u9AD8\u30C0\u30E1\u30FC\u30B8\u3001\u5FC5\u305A\u4F1A\u5FC3\u3068\u306A\u308B\u3002"
      }
    ],
    // 風属性（探索）— 回避・移動・範囲。直接火力は控えめだが立ち回りで優位を取る
    other: [
      {
        id: "mo1",
        label: "\u305D\u3088\u98A8",
        req: 5,
        tier: 1,
        power: 9,
        type: "attack",
        target: "\u5358\u4F53",
        desc: "\u57FA\u672C\u306E\u98A8\u5C5E\u6027\u9B54\u6CD5\u3002\u6700\u521D\u306E\u4E00\u6B69\u3002",
        flavor: "\u8EFD\u3084\u304B\u306A\u98A8\u306E\u5203\u3092\u653E\u3064\u3002\u6D88\u8CBB\u304C\u5C11\u306A\u304F\u9023\u767A\u304C\u5229\u304F\u3002"
      },
      {
        id: "mo2",
        label: "\u8FFD\u3044\u98A8",
        req: 15,
        tier: 1,
        power: 0,
        type: "buff",
        target: "\u81EA\u8EAB",
        desc: "\u80CC\u4E2D\u3092\u62BC\u3057\u3066\u304F\u308C\u308B\u512A\u3057\u3044\u98A8\u3002",
        flavor: "\u8FFD\u3044\u98A8\u3092\u53D7\u3051\u30012\u30BF\u30FC\u30F3\u306E\u9593\u884C\u52D5\u901F\u5EA6+25%\u3002"
      },
      {
        id: "mo3",
        label: "\u65CB\u98A8",
        req: 30,
        tier: 2,
        power: 16,
        type: "attack",
        target: "\u7BC4\u56F2",
        desc: "\u884C\u304F\u5148\u3005\u3067\u5DFB\u304D\u8D77\u3053\u308B\u5C0F\u3055\u306A\u6E26\u3002",
        flavor: "\u5C0F\u3055\u306A\u7ADC\u5DFB\u304C\u5468\u56F2\u3092\u5DFB\u304D\u8FBC\u3080\u3002\u8907\u6570\u306E\u6575\u306B\u540C\u6642\u30C0\u30E1\u30FC\u30B8\u3002"
      },
      {
        id: "mo4",
        label: "\u75BE\u98A8",
        req: 50,
        tier: 2,
        power: 0,
        type: "buff",
        target: "\u81EA\u8EAB",
        desc: "\u8AB0\u3088\u308A\u3082\u901F\u304F\u4E16\u754C\u3092\u5DE1\u308B\u529B\u3002",
        flavor: "\u5727\u5012\u7684\u306A\u901F\u3055\u3067\u6575\u306E\u653B\u6483\u3092\u898B\u5207\u308B\u30023\u30BF\u30FC\u30F3\u306E\u9593\u56DE\u907F\u7387+40%\u3002"
      },
      {
        id: "mo5",
        label: "\u98A8\u8AAD\u307F",
        req: 80,
        tier: 2,
        power: 20,
        type: "debuff",
        target: "\u5358\u4F53",
        desc: "\u898B\u3048\u306A\u3044\u6D41\u308C\u3092\u8AAD\u307F\u89E3\u304F\u529B\u3002",
        flavor: "\u6575\u306E\u5F31\u70B9\u3092\u98A8\u304C\u6559\u3048\u3066\u304F\u308C\u308B\u3002\u547D\u4E2D\u6642\u3001\u5BFE\u8C61\u306E\u9632\u5FA1\u529B\u30922\u30BF\u30FC\u30F3\u4E0B\u3052\u308B\u3002"
      },
      {
        id: "mo6",
        label: "\u66B4\u98A8\u57DF",
        req: 120,
        tier: 3,
        power: 36,
        type: "attack",
        target: "\u7BC4\u56F2",
        desc: "\u3042\u3089\u3086\u308B\u5834\u6240\u3092\u8E0F\u7834\u3059\u308B\u8005\u306E\u8A3C\u3002",
        flavor: "\u66B4\u98A8\u304C\u6226\u5834\u5168\u4F53\u3092\u5439\u304D\u8352\u308C\u308B\u3002\u7BC4\u56F2\u5185\u306E\u6575\u306B\u30C0\u30E1\u30FC\u30B8\uFF0B\u30CE\u30C3\u30AF\u30D0\u30C3\u30AF\u3002"
      },
      {
        id: "mo7",
        label: "\u5929\u7FD4\u3051\u308B\u98A8",
        req: 180,
        tier: 3,
        power: 0,
        type: "special",
        target: "\u81EA\u8EAB",
        desc: "\u4E16\u754C\u306E\u679C\u3066\u307E\u3067\u81EA\u7531\u306B\u99C6\u3051\u308B\u529B\u3002",
        flavor: "\u98A8\u305D\u306E\u3082\u306E\u3068\u4E00\u4F53\u5316\u3057\u30011\u30BF\u30FC\u30F3\u306E\u9593\u3042\u3089\u3086\u308B\u653B\u6483\u3092\u5B8C\u5168\u56DE\u907F\u3059\u308B\u3002"
      }
    ]
  };
  const EFFECT_TYPE_INFO = {
    attack: { label: "\u653B\u6483", icon: "\u2694\uFE0F", color: "#dc2626" },
    dot: { label: "\u7D99\u7D9A\u30C0\u30E1\u30FC\u30B8", icon: "\u{1F525}", color: "#ea580c" },
    debuff: { label: "\u5F31\u4F53\u5316", icon: "\u{1F300}", color: "#7c3aed" },
    buff: { label: "\u5F37\u5316", icon: "\u2728", color: "#16a34a" },
    heal: { label: "\u56DE\u5FA9", icon: "\u{1F49A}", color: "#16a34a" },
    special: { label: "\u7279\u6B8A", icon: "\u2B50", color: "#d97706" }
  };
  function calcMagicCount(catId, logs) {
    return logs.filter((l) => l.cat === catId).length;
  }
  const TREE_LAYOUT = {
    study: [{ id: "s1", x: 100, y: 40 }, { id: "s2", x: 55, y: 120 }, { id: "s3", x: 55, y: 210 }, { id: "s4", x: 145, y: 120 }, { id: "s5", x: 100, y: 300 }, { id: "s6", x: 55, y: 300 }, { id: "s7", x: 100, y: 390 }],
    exercise: [{ id: "e1", x: 100, y: 40 }, { id: "e2", x: 55, y: 120 }, { id: "e3", x: 55, y: 210 }, { id: "e4", x: 145, y: 120 }, { id: "e5", x: 100, y: 300 }, { id: "e6", x: 145, y: 210 }, { id: "e7", x: 100, y: 390 }],
    reading: [{ id: "r1", x: 100, y: 40 }, { id: "r2", x: 55, y: 120 }, { id: "r3", x: 55, y: 210 }, { id: "r4", x: 145, y: 120 }, { id: "r5", x: 100, y: 300 }, { id: "r6", x: 145, y: 210 }, { id: "r7", x: 100, y: 390 }],
    art: [{ id: "a1", x: 100, y: 40 }, { id: "a2", x: 55, y: 120 }, { id: "a3", x: 55, y: 210 }, { id: "a4", x: 145, y: 120 }, { id: "a5", x: 100, y: 300 }, { id: "a6", x: 145, y: 210 }, { id: "a7", x: 100, y: 390 }],
    other: [{ id: "o1", x: 100, y: 40 }, { id: "o2", x: 55, y: 120 }, { id: "o3", x: 55, y: 210 }, { id: "o4", x: 145, y: 120 }, { id: "o5", x: 100, y: 300 }, { id: "o6", x: 145, y: 210 }, { id: "o7", x: 100, y: 390 }]
  };
  const LOGIN_BONUS_TABLE = [
    { day: 1, gems: 3, xp: 0, label: "\u521D\u56DE\u30ED\u30B0\u30A4\u30F3", icon: "\u{1F31F}" },
    { day: 2, gems: 3, xp: 50, label: "2\u65E5\u9023\u7D9A", icon: "\u2728" },
    { day: 3, gems: 5, xp: 50, label: "3\u65E5\u9023\u7D9A", icon: "\u{1F525}" },
    { day: 4, gems: 5, xp: 100, label: "4\u65E5\u9023\u7D9A", icon: "\u{1F48E}" },
    { day: 5, gems: 5, xp: 100, label: "5\u65E5\u9023\u7D9A", icon: "\u26A1" },
    { day: 6, gems: 8, xp: 150, label: "6\u65E5\u9023\u7D9A", icon: "\u{1F319}" },
    { day: 7, gems: 15, xp: 200, label: "7\u65E5\u9023\u7D9A\u30DC\u30FC\u30CA\u30B9\uFF01", icon: "\u{1F451}" },
    { day: 14, gems: 30, xp: 500, label: "14\u65E5\u9023\u7D9A\uFF01", icon: "\u{1F3C6}" },
    { day: 30, gems: 60, xp: 1e3, label: "30\u65E5\u9023\u7D9A\uFF01\uFF01", icon: "\u{1F308}" }
  ];
  function getLoginBonus(streak) {
    const exact = LOGIN_BONUS_TABLE.find((b) => b.day === streak);
    if (exact) return exact;
    if (streak >= 30) return { gems: 10, xp: 200, label: `${streak}\u65E5\u9023\u7D9A`, icon: "\u{1F525}" };
    if (streak >= 14) return { gems: 8, xp: 100, label: `${streak}\u65E5\u9023\u7D9A`, icon: "\u26A1" };
    if (streak >= 7) return { gems: 5, xp: 50, label: `${streak}\u65E5\u9023\u7D9A`, icon: "\u{1F48E}" };
    return { gems: 3, xp: 30, label: `${streak}\u65E5\u9023\u7D9A`, icon: "\u2728" };
  }
  const GACHA_POOLS = {
    reward: {
      name: "\u3054\u8912\u7F8E\u30AC\u30C1\u30E3",
      cost: 10,
      icon: "\u{1F381}",
      desc: "\u73FE\u5B9F\u306E\u3054\u8912\u7F8E\u3092\u5F15\u3053\u3046\uFF01",
      items: [
        { id: "rw1", rarity: "SSR", label: "\u5916\u98DF\u4E0A\u9650\u306A\u3057\u5238", desc: "\u4ECA\u9031\u672B\u3001\u597D\u304D\u306A\u3082\u306E\u3092\u4E0A\u9650\u306A\u3057\u3067\u5916\u98DF\u3057\u3066\u3088\u3044\uFF01", icon: "\u{1F37D}\uFE0F", color: "#f0c060", prob: 0.01 },
        { id: "rw2", rarity: "SSR", label: "\u597D\u304D\u306A\u3082\u306E\u8CFC\u5165\u5238", desc: "\u6B32\u3057\u304B\u3063\u305F\u3082\u306E\u30921\u3064\u8CB7\u3063\u3066\u3088\u3044\uFF01\uFF08\u4E88\u7B973000\u5186\uFF09", icon: "\u{1F6CD}\uFE0F", color: "#f0c060", prob: 0.02 },
        { id: "rw3", rarity: "SR", label: "\u30B3\u30F3\u30D3\u30CB\u30B9\u30A4\u30FC\u30C4\u5238", desc: "\u65B0\u4F5C\u30B3\u30F3\u30D3\u30CB\u30B9\u30A4\u30FC\u30C4\u3092\u8CB7\u3063\u3066\u3088\u3044\uFF01", icon: "\u{1F370}", color: "#a78bfa", prob: 0.07 },
        { id: "rw4", rarity: "SR", label: "\u30AB\u30D5\u30A7\u8D05\u6CA2\u5238", desc: "\u597D\u304D\u306A\u30AB\u30D5\u30A7\u3067\u30C9\u30EA\u30F3\u30AF\uFF0B\u30B9\u30A4\u30FC\u30C4\u3092\u983C\u3093\u3067\u3088\u3044\uFF01", icon: "\u2615", color: "#a78bfa", prob: 0.1 },
        { id: "rw5", rarity: "R", label: "\u30B2\u30FC\u30E030\u5206\u5238", desc: "\u30B9\u30DE\u30DB\u30B2\u30FC\u30E0\u309230\u5206\u904A\u3093\u3067\u3088\u3044\uFF01", icon: "\u{1F3AE}", color: "#60a5fa", prob: 0.3 },
        { id: "rw6", rarity: "R", label: "\u52D5\u753B1\u6642\u9593\u5238", desc: "\u52D5\u753B\u914D\u4FE1\u30B5\u30FC\u30D3\u30B9\u30921\u6642\u9593\u697D\u3057\u3093\u3067\u3088\u3044\uFF01", icon: "\u{1F4FA}", color: "#60a5fa", prob: 0.25 },
        { id: "rw7", rarity: "R", label: "\u30C0\u30E9\u30C0\u30E930\u5206\u5238", desc: "\u4F55\u3082\u305B\u305A\u4F11\u606F\u3057\u3066\u3088\u3044\uFF01\u7F6A\u60AA\u611F\u306A\u3057\uFF01", icon: "\u{1F6CB}\uFE0F", color: "#60a5fa", prob: 0.25 }
      ]
    },
    buff: {
      name: "\u30D0\u30D5\u30A2\u30A4\u30C6\u30E0\u30AC\u30C1\u30E3",
      cost: 8,
      icon: "\u2697\uFE0F",
      desc: "\u8A18\u9332\u3092\u6709\u5229\u306B\u3059\u308B\u30A2\u30A4\u30C6\u30E0\u3092\u5165\u624B\uFF01",
      items: [
        { id: "bf1", rarity: "SSR", label: "\u8CE2\u8005\u306E\u7D50\u6676", desc: "\u6B21\u306E\u77E5\u529B\u8A18\u9332\u306EEXP\xD72\u500D", icon: "\u{1F48E}", color: "#f0c060", prob: 0.02, effect: { type: "xp_mult", cat: "study", val: 2, uses: 1 } },
        { id: "bf2", rarity: "SSR", label: "\u795E\u901F\u306E\u7FFC", desc: "\u6B21\u306E\u7B4B\u529B\u8A18\u9332\u306EEXP\xD72\u500D", icon: "\u{1F98B}", color: "#f0c060", prob: 0.02, effect: { type: "xp_mult", cat: "exercise", val: 2, uses: 1 } },
        { id: "bf3", rarity: "SR", label: "\u77E5\u529B\u306E\u7D50\u6676", desc: "\u6B21\u306E\u77E5\u529B\u8A18\u9332\u306EEXP\xD71.5\u500D", icon: "\u{1F52E}", color: "#a78bfa", prob: 0.08, effect: { type: "xp_mult", cat: "study", val: 1.5, uses: 1 } },
        { id: "bf4", rarity: "SR", label: "\u30B9\u30BF\u30DF\u30CA\u30C9\u30EA\u30F3\u30AF", desc: "\u30B9\u30C8\u30EA\u30FC\u30AF\u304C1\u56DE\u9014\u5207\u308C\u3066\u3082\u5B88\u8B77\u3057\u3066\u304F\u308C\u308B", icon: "\u26A1", color: "#a78bfa", prob: 0.08, effect: { type: "streak_shield", val: 1, uses: 1 } },
        { id: "bf5", rarity: "SR", label: "\u5275\u9020\u306E\u7114", desc: "\u6B21\u306E\u5275\u9020\u8A18\u9332\u306EEXP\xD71.5\u500D", icon: "\u{1F525}", color: "#a78bfa", prob: 0.08, effect: { type: "xp_mult", cat: "art", val: 1.5, uses: 1 } },
        { id: "bf6", rarity: "R", label: "\u30EB\u30FC\u30F3\u77F3\u306E\u6B20\u7247", desc: "\u30EB\u30FC\u30F3\u77F3+5\u7372\u5F97", icon: "\u{1F4A0}", color: "#60a5fa", prob: 0.24, effect: { type: "gems", val: 5 } },
        { id: "bf7", rarity: "R", label: "EXP\u306E\u9732", desc: "EXP+100\u7372\u5F97", icon: "\u2728", color: "#60a5fa", prob: 0.24, effect: { type: "bonus_xp", val: 100 } },
        { id: "bf8", rarity: "R", label: "\u63A2\u7D22\u8005\u306E\u5730\u56F3", desc: "\u6B21\u306E\u63A2\u7D22\u8A18\u9332\u306EEXP\xD71.5\u500D", icon: "\u{1F5FA}\uFE0F", color: "#60a5fa", prob: 0.24, effect: { type: "xp_mult", cat: "other", val: 1.5, uses: 1 } }
      ]
    }
  };
  function drawGacha(poolId, bonusSSRRate, unlockedSkills, ownedCharIds = []) {
    const charDrop = drawCharacterDrop(ownedCharIds);
    if (charDrop) return { type: "character", ...charDrop };
    const pool = GACHA_POOLS[poolId];
    const totalBonus = bonusSSRRate;
    const items = pool.items.map((item) => ({
      ...item,
      prob: item.rarity === "SSR" ? item.prob + totalBonus / pool.items.filter((i) => i.rarity === "SSR").length : item.prob
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
    { lv: 1, title: "\u653E\u6D6A\u8005" },
    { lv: 5, title: "\u5F93\u8005" },
    { lv: 12, title: "\u9A0E\u58EB" },
    { lv: 34, title: "\u57F7\u653F\u795E" },
    { lv: 50, title: "\u8987\u738B" }
  ];
  function xpForLevel(lv) {
    return Math.floor(200 * Math.pow(1.16, lv - 1));
  }
  function calcLevel(totalXP) {
    let lv = 1, xp = totalXP;
    while (xp >= xpForLevel(lv)) {
      xp -= xpForLevel(lv);
      lv++;
    }
    return { lv, current: xp, needed: xpForLevel(lv) };
  }
  function getTitle(lv) {
    return [...TITLES_MAP].reverse().find((t) => lv >= t.lv)?.title ?? "\u653E\u6D6A\u8005";
  }
  function getCharStage(lv) {
    return [...CHAR_STAGES].reverse().find((s) => lv >= s.minLv) ?? CHAR_STAGES[0];
  }
  function getLocalDateString(date = /* @__PURE__ */ new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  function calcStreak(logs, healthChecks, shieldDates = []) {
    const healthDates = Object.keys(healthChecks || {}).filter((d) => (healthChecks[d] || []).length > 0);
    const allDates = [...logs.map((l) => l.date), ...healthDates, ...shieldDates || []];
    if (!allDates.length) return 0;
    const days = [...new Set(allDates)].sort().reverse();
    const today = getLocalDateString();
    if (days[0] !== today && days[0] !== getLocalDateString(new Date(Date.now() - 864e5))) return 0;
    let streak = 1;
    for (let i = 1; i < days.length; i++) {
      if ((new Date(days[i - 1]) - new Date(days[i])) / 864e5 === 1) streak++;
      else break;
    }
    return streak;
  }
  function getStreakGapDates(logs, healthChecks, shieldDates) {
    const healthDates = Object.keys(healthChecks || {}).filter((d2) => (healthChecks[d2] || []).length > 0);
    const active = /* @__PURE__ */ new Set([...logs.map((l) => l.date), ...healthDates, ...shieldDates || []]);
    if (active.size === 0) return [];
    const last = [...active].sort().reverse()[0];
    const today = getLocalDateString();
    if (last >= today) return [];
    const gaps = [];
    const d = /* @__PURE__ */ new Date(last + "T00:00:00");
    for (let i = 0; i < 366; i++) {
      d.setDate(d.getDate() + 1);
      const ds = getLocalDateString(d);
      if (ds >= today) break;
      gaps.push(ds);
    }
    return gaps;
  }
  function calcHealthXP(healthChecks, healthItems, excludeDate = null) {
    const xpMap = Object.fromEntries(healthItems.map((i) => [i.id, i.xp ?? 12]));
    return Object.entries(healthChecks || {}).reduce((sum, [date, ids]) => {
      if (date === excludeDate) return sum;
      return sum + (ids || []).reduce((s, id) => s + (xpMap[id] ?? 12), 0);
    }, 0);
  }
  function isNodeUnlocked(node, unlockedIds, lv) {
    if (lv < node.minLv) return false;
    if (!node.req) return true;
    if (Array.isArray(node.req)) return node.req.every((r) => unlockedIds.includes(r));
    return unlockedIds.includes(node.req);
  }
  function getEquippedCharData(equippedChar) {
    return GACHA_CHARACTERS.find((c) => c.id === equippedChar) || null;
  }
  function calcXPBonus(catId, unlockedSkills, sessionMin = null) {
    const tree = SKILL_TREE[catId] ?? [];
    let bonus = tree.filter((n) => unlockedSkills.includes(n.id) && n.type === "xp" && n.id !== "s6").reduce((s, n) => s + n.val, 0);
    const timeCompress = tree.find((n) => n.id === "s6" && unlockedSkills.includes(n.id));
    if (timeCompress && sessionMin !== null && sessionMin <= 15) bonus += timeCompress.val;
    return bonus;
  }
  const SUBSCRIPTION_XP_BOOST = 0.3;
  function calcExternalXPBonus(catId, equippedChar, isSubscribed = false) {
    let bonus = 0;
    const char = getEquippedCharData(equippedChar);
    if (char?.passive?.type === "xp" && char.passive.cat === catId) bonus += char.passive.val;
    if (isSubscribed) bonus += SUBSCRIPTION_XP_BOOST;
    return bonus;
  }
  function calcGemBonus(catId, unlockedSkills, equippedChar) {
    const tree = SKILL_TREE[catId] ?? [];
    let bonus = tree.filter((n) => unlockedSkills.includes(n.id) && n.type === "gem").reduce((s, n) => s + n.val, 0);
    const char = getEquippedCharData(equippedChar);
    if (char?.passive?.type === "gem" && char.passive.cat === catId) bonus += char.passive.val;
    return bonus;
  }
  function calcSSRBonus(unlockedSkills, equippedChar) {
    let bonus = Object.values(SKILL_TREE).flat().filter((n) => unlockedSkills.includes(n.id) && n.type === "gacha").reduce((s, n) => s + n.val, 0);
    const char = getEquippedCharData(equippedChar);
    if (char?.passive?.type === "gacha") bonus += char.passive.val;
    return bonus;
  }
  function calcStreakShields(unlockedSkills) {
    return Object.values(SKILL_TREE).flat().filter((n) => unlockedSkills.includes(n.id) && n.type === "streak").reduce((s, n) => s + n.val, 0);
  }
  function CharacterSVG({ stage, lv, animated }) {
    const imgSrc = CHAR_IMAGES[stage.name.toLowerCase()];
    return /* @__PURE__ */ React.createElement("div", { style: {
      width: "100%",
      height: "100%",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      position: "relative"
    } }, /* @__PURE__ */ React.createElement("div", { style: {
      position: "absolute",
      inset: 0,
      background: `radial-gradient(ellipse at 50% 70%, ${stage.primaryColor}28 0%, transparent 70%)`,
      borderRadius: 16
    } }), /* @__PURE__ */ React.createElement(
      "img",
      {
        src: imgSrc,
        alt: stage.title_ja,
        style: {
          width: "100%",
          height: "100%",
          objectFit: "contain",
          filter: animated ? `drop-shadow(0 0 14px ${stage.primaryColor}99)` : "none",
          transition: "filter .3s ease"
        }
      }
    ));
  }
  function MagicGlyph({ catId, tier, color, locked }) {
    const stroke = locked ? "#a8a29e" : color;
    const fill = locked ? "#a8a29e" : color;
    const glyphs = {
      study: {
        1: /* @__PURE__ */ React.createElement("path", { d: "M27 8 C20 22 14 30 14 38 A13 13 0 0 0 40 38 C40 30 34 22 27 8 Z", fill, opacity: locked ? 0.5 : 0.85 }),
        2: /* @__PURE__ */ React.createElement("g", { stroke, strokeWidth: "3", fill: "none", strokeLinecap: "round", opacity: locked ? 0.5 : 1 }, /* @__PURE__ */ React.createElement("path", { d: "M5 20 Q14 10 23 20 T41 20 T59 20" }), /* @__PURE__ */ React.createElement("path", { d: "M5 32 Q14 22 23 32 T41 32 T59 32", opacity: "0.7" }), /* @__PURE__ */ React.createElement("path", { d: "M5 44 Q14 34 23 44 T41 44 T59 44", opacity: "0.5" })),
        3: /* @__PURE__ */ React.createElement("g", { opacity: locked ? 0.5 : 1 }, /* @__PURE__ */ React.createElement(
          "path",
          {
            d: "M27 27 m-18 0 a18 18 0 1 1 36 0 a13 13 0 1 1 -26 0 a8 8 0 1 1 16 0 a3 3 0 1 1 -6 0",
            stroke,
            strokeWidth: "2.5",
            fill: "none",
            strokeLinecap: "round"
          }
        ), /* @__PURE__ */ React.createElement("circle", { cx: "27", cy: "27", r: "3", fill }))
      },
      exercise: {
        1: /* @__PURE__ */ React.createElement("path", { d: "M27 10 C21 19 17 25 17 32 A10 10 0 0 0 37 32 C37 25 33 19 27 10 Z", fill, opacity: locked ? 0.5 : 0.9 }),
        2: /* @__PURE__ */ React.createElement(
          "path",
          {
            d: "M27 6 C19 17 14 25 14 34 A13 13 0 0 0 40 34 C40 25 35 17 27 6 Z M27 20 C23 26 21 30 21 34 A6 6 0 0 0 33 34 C33 30 31 26 27 20 Z",
            fill,
            opacity: locked ? 0.5 : 1
          }
        ),
        3: /* @__PURE__ */ React.createElement("g", { opacity: locked ? 0.5 : 1 }, /* @__PURE__ */ React.createElement("path", { d: "M27 4 C16 18 10 28 10 38 A17 17 0 0 0 44 38 C44 28 38 18 27 4 Z", fill, opacity: "0.85" }), /* @__PURE__ */ React.createElement("path", { d: "M27 18 C20 27 17 32 17 38 A10 10 0 0 0 37 38 C37 32 34 27 27 18 Z", fill: locked ? "#d6d3d1" : "#fff7ed", opacity: "0.9" }))
      },
      reading: {
        // tier1: 小さな石（ゴツゴツした不規則な多角形）
        1: /* @__PURE__ */ React.createElement(
          "polygon",
          {
            points: "27,12 34,17 38,26 34,38 22,40 14,33 15,20 22,13",
            fill,
            opacity: locked ? 0.5 : 0.9
          }
        ),
        // tier2: 岩が積み重なった様子（大小2つの多角形）
        2: /* @__PURE__ */ React.createElement("g", { opacity: locked ? 0.5 : 1 }, /* @__PURE__ */ React.createElement("polygon", { points: "27,10 36,16 40,27 35,38 20,40 13,32 15,20 22,12", fill }), /* @__PURE__ */ React.createElement("polygon", { points: "27,18 32,22 31,30 23,31 20,24 23,18", fill: locked ? "#d6d3d1" : "#fde8c8", opacity: "0.7" })),
        // tier3: 山＋結晶。複数の鋭角三角形が重なり、土属性の「大地の守護」を表現
        3: /* @__PURE__ */ React.createElement("g", { opacity: locked ? 0.5 : 1 }, /* @__PURE__ */ React.createElement("polygon", { points: "27,7 40,28 34,42 20,42 14,28", fill }), /* @__PURE__ */ React.createElement("polygon", { points: "27,7 40,28 34,42 20,42 14,28", fill: locked ? "#d6d3d1" : "#fde8c8", opacity: "0.0" }), /* @__PURE__ */ React.createElement("polygon", { points: "27,16 34,30 20,30", fill: locked ? "#d6d3d1" : "#fde8c8", opacity: "0.65" }), /* @__PURE__ */ React.createElement("polygon", { points: "19,32 27,42 11,42", fill, opacity: "0.7" }), /* @__PURE__ */ React.createElement("polygon", { points: "35,32 43,42 27,42", fill, opacity: "0.7" }))
      },
      art: {
        1: /* @__PURE__ */ React.createElement("polygon", { points: "29,8 20,30 27,30 23,46 38,24 30,24", fill, opacity: locked ? 0.5 : 0.9 }),
        2: /* @__PURE__ */ React.createElement("polygon", { points: "30,5 18,28 26,28 21,49 41,22 31,22", fill, opacity: locked ? 0.5 : 1 }),
        3: /* @__PURE__ */ React.createElement("g", { opacity: locked ? 0.5 : 1 }, /* @__PURE__ */ React.createElement("polygon", { points: "30,4 16,28 25,28 19,50 42,21 30,21", fill }), /* @__PURE__ */ React.createElement("polygon", { points: "30,4 16,28 25,28", fill: locked ? "#d6d3d1" : "#fdf4ff", opacity: "0.6" }))
      },
      other: {
        1: /* @__PURE__ */ React.createElement("path", { d: "M8 22 Q20 14 30 22 T50 22", stroke, strokeWidth: "3", fill: "none", strokeLinecap: "round", opacity: locked ? 0.5 : 1 }),
        2: /* @__PURE__ */ React.createElement("g", { stroke, strokeWidth: "3", fill: "none", strokeLinecap: "round", opacity: locked ? 0.5 : 1 }, /* @__PURE__ */ React.createElement("path", { d: "M6 18 Q18 8 28 18 T50 18" }), /* @__PURE__ */ React.createElement("path", { d: "M6 30 Q18 20 28 30 T50 30", opacity: "0.7" }), /* @__PURE__ */ React.createElement("path", { d: "M10 42 Q20 36 28 42 T46 42", opacity: "0.5" })),
        3: /* @__PURE__ */ React.createElement("g", { opacity: locked ? 0.5 : 1 }, /* @__PURE__ */ React.createElement(
          "path",
          {
            d: "M27 27 m-16 0 a16 16 0 1 1 32 0 a11 11 0 1 1 -22 0 a6 6 0 1 1 12 0",
            stroke,
            strokeWidth: "2.5",
            fill: "none",
            strokeLinecap: "round"
          }
        ), /* @__PURE__ */ React.createElement("circle", { cx: "27", cy: "27", r: "2.5", fill }))
      }
    };
    return /* @__PURE__ */ React.createElement("svg", { viewBox: "0 0 54 54", width: "48", height: "48" }, glyphs[catId]?.[tier] || /* @__PURE__ */ React.createElement("circle", { cx: "27", cy: "27", r: "10", fill }));
  }
  function SkillTreeView({ catId, lv, unlocked, onUnlock, skillPoints }) {
    const cat = CATEGORIES.find((c) => c.id === catId);
    const nodes = SKILL_TREE[catId];
    const layout = TREE_LAYOUT[catId];
    const [tooltip, setTooltip] = useState(null);
    const getPos = (id) => layout.find((l) => l.id === id);
    const edges = nodes.flatMap((n) => {
      if (!n.req) return [];
      const reqs = Array.isArray(n.req) ? n.req : [n.req];
      return reqs.map((r) => ({ from: r, to: n.id }));
    });
    return /* @__PURE__ */ React.createElement("div", { style: { position: "relative" } }, /* @__PURE__ */ React.createElement(
      "svg",
      {
        viewBox: "0 0 200 440",
        width: "200",
        height: "440",
        style: { display: "block", margin: "0 auto", overflow: "visible" }
      },
      /* @__PURE__ */ React.createElement("defs", null, /* @__PURE__ */ React.createElement("filter", { id: "nglow" }, /* @__PURE__ */ React.createElement("feGaussianBlur", { stdDeviation: "3", result: "b" }), /* @__PURE__ */ React.createElement("feMerge", null, /* @__PURE__ */ React.createElement("feMergeNode", { in: "b" }), /* @__PURE__ */ React.createElement("feMergeNode", { in: "SourceGraphic" })))),
      edges.map(({ from, to }, i) => {
        const f = getPos(from), t = getPos(to);
        const active = unlocked.includes(from) && unlocked.includes(to);
        const ready = unlocked.includes(from) && !unlocked.includes(to);
        return /* @__PURE__ */ React.createElement(
          "line",
          {
            key: i,
            x1: f.x,
            y1: f.y,
            x2: t.x,
            y2: t.y,
            stroke: active ? cat.color : ready ? cat.color + "55" : "#e8e4de",
            strokeWidth: active ? 2 : 1,
            strokeDasharray: active ? "none" : "4 3",
            style: active ? { filter: `drop-shadow(0 0 4px ${cat.color})` } : {}
          }
        );
      }),
      nodes.map((n) => {
        const pos = getPos(n.id);
        const isUnlocked = unlocked.includes(n.id);
        const canUnlock = !isUnlocked && isNodeUnlocked(n, unlocked, lv) && skillPoints > 0;
        const locked = !isUnlocked && !canUnlock;
        return /* @__PURE__ */ React.createElement(
          "g",
          {
            key: n.id,
            style: { cursor: canUnlock ? "pointer" : "default" },
            onClick: () => canUnlock && onUnlock(n.id),
            onMouseEnter: () => setTooltip(n.id),
            onMouseLeave: () => setTooltip(null)
          },
          isUnlocked && /* @__PURE__ */ React.createElement(
            "circle",
            {
              cx: pos.x,
              cy: pos.y,
              r: "22",
              fill: cat.color + "22",
              stroke: cat.color,
              strokeWidth: "0",
              style: { filter: `drop-shadow(0 0 8px ${cat.color})` }
            }
          ),
          /* @__PURE__ */ React.createElement(
            "circle",
            {
              cx: pos.x,
              cy: pos.y,
              r: "18",
              fill: isUnlocked ? cat.color + "33" : canUnlock ? "#e8e4de" : "#ede9e3",
              stroke: isUnlocked ? cat.color : canUnlock ? cat.color + "88" : "#e8e4de",
              strokeWidth: isUnlocked ? 2 : 1.5
            }
          ),
          /* @__PURE__ */ React.createElement(
            "text",
            {
              x: pos.x,
              y: pos.y + 5,
              textAnchor: "middle",
              fontSize: "14",
              fill: isUnlocked ? cat.color : locked ? "#78716c" : cat.color + "88",
              style: isUnlocked ? { filter: `drop-shadow(0 0 6px ${cat.color})` } : {}
            },
            isUnlocked ? "\u25C6" : canUnlock ? "\u25C7" : "\u25CB"
          )
        );
      })
    ), tooltip && (() => {
      const n = nodes.find((x) => x.id === tooltip);
      const pos = getPos(tooltip);
      const isUnlocked = unlocked.includes(n.id);
      const canUnlock = !isUnlocked && isNodeUnlocked(n, unlocked, lv) && skillPoints > 0;
      return /* @__PURE__ */ React.createElement("div", { style: {
        position: "absolute",
        left: pos.x > 100 ? "auto" : "60%",
        right: pos.x > 100 ? "60%" : "auto",
        top: pos.y * (390 / 390) * 0.75,
        background: "#f5f2ee",
        border: `1px solid ${cat.color}55`,
        borderRadius: 10,
        padding: "10px 12px",
        minWidth: 140,
        pointerEvents: "none",
        zIndex: 10
      } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: cat.color, letterSpacing: 2, marginBottom: 4 } }, n.en), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, fontWeight: 700, marginBottom: 4 } }, n.label), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "#44403c", marginBottom: 6 } }, n.desc), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "#78716c" } }, "\u5FC5\u8981Lv ", n.minLv), canUnlock && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: cat.color, marginTop: 4 } }, "\u30BF\u30C3\u30D7\u3057\u3066\u89E3\u653E"), isUnlocked && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "#4ade80", marginTop: 4 } }, "\u2713 \u7FD2\u5F97\u6E08\u307F"));
    })());
  }
  function LevelUpModal({ oldLv, newLv, stage, onClose }) {
    return /* @__PURE__ */ React.createElement("div", { style: {
      position: "fixed",
      inset: 0,
      background: "rgba(200,195,188,0.75)",
      backdropFilter: "blur(8px)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 200
    } }, /* @__PURE__ */ React.createElement("div", { style: {
      position: "relative",
      width: 320,
      background: "linear-gradient(160deg,#faf8f5 0%,#f5f2ee 100%)",
      border: `1px solid ${stage.primaryColor}88`,
      borderRadius: 20,
      padding: "40px 32px",
      textAlign: "center",
      animation: "lvup .5s cubic-bezier(.34,1.56,.64,1)",
      boxShadow: `0 0 80px ${stage.primaryColor}40`
    } }, ["tl", "tr", "bl", "br"].map((pos) => /* @__PURE__ */ React.createElement("div", { key: pos, style: {
      position: "absolute",
      top: pos.includes("t") ? 12 : "auto",
      bottom: pos.includes("b") ? 12 : "auto",
      left: pos.includes("l") ? 12 : "auto",
      right: pos.includes("r") ? 12 : "auto",
      width: 16,
      height: 16,
      borderTop: pos.includes("t") ? `1.5px solid ${stage.primaryColor}` : "none",
      borderBottom: pos.includes("b") ? `1.5px solid ${stage.primaryColor}` : "none",
      borderLeft: pos.includes("l") ? `1.5px solid ${stage.primaryColor}` : "none",
      borderRight: pos.includes("r") ? `1.5px solid ${stage.primaryColor}` : "none"
    } })), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, letterSpacing: 5, color: stage.primaryColor, marginBottom: 16 } }, "ASCENSION COMPLETE"), /* @__PURE__ */ React.createElement("div", { style: { height: 140, marginBottom: 16 } }, /* @__PURE__ */ React.createElement(CharacterSVG, { stage, lv: newLv, animated: true })), /* @__PURE__ */ React.createElement("div", { style: {
      fontSize: 56,
      fontWeight: 900,
      lineHeight: 1,
      color: stage.primaryColor,
      textShadow: `0 0 30px ${stage.primaryColor}`,
      marginBottom: 4
    } }, "Lv.", newLv), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 18, color: "#1e1b2e", marginBottom: 6 } }, getTitle(newLv)), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "#78716c", marginBottom: 24 } }, "\u30B9\u30AD\u30EB\u30DD\u30A4\u30F3\u30C8 +1 \u7372\u5F97"), /* @__PURE__ */ React.createElement("button", { onClick: onClose, style: {
      padding: "12px 48px",
      borderRadius: 999,
      border: "none",
      cursor: "pointer",
      background: `linear-gradient(90deg,${stage.accentColor},${stage.primaryColor})`,
      color: "#fff",
      fontWeight: 700,
      fontSize: 14,
      letterSpacing: 2,
      boxShadow: `0 4px 24px ${stage.primaryColor}50`
    } }, "CONTINUE")));
  }
  const TABS = [
    { id: "home", label: "HOME", icon: "\u2B21" },
    { id: "character", label: "CHAR", icon: "\u25C8" },
    { id: "record", label: "LOG", icon: "\u2726" },
    { id: "skills", label: "SKILLS", icon: "\u274B" },
    { id: "gacha", label: "GACHA", icon: "\u{1F3B2}" },
    { id: "stats", label: "STATUS", icon: "\u25CE" }
  ];
  function LifeQuest() {
    const [logs, setLogs] = useState(() => JSON.parse(appStorage.getItem("lq2_logs") || "[]"));
    const [unlocked, setUnlocked] = useState(() => JSON.parse(appStorage.getItem("lq2_skills") || "[]"));
    const [spUsed, setSpUsed] = useState(() => JSON.parse(appStorage.getItem("lq2_spused") || "0"));
    const [healthChecks, setHealthChecks] = useState(() => JSON.parse(appStorage.getItem("lq2_health") || "{}"));
    const [healthItems, setHealthItems] = useState(() => {
      const saved = JSON.parse(appStorage.getItem("lq2_hitems") || "null");
      return migrateHealthItems(saved);
    });
    const [newHabit, setNewHabit] = useState("");
    const [newHabitDiff, setNewHabitDiff] = useState("normal");
    const [schedule, setSchedule] = useState(() => {
      const saved = appStorage.getItem("lq2_schedule");
      return saved ? JSON.parse(saved) : DEFAULT_SCHEDULE;
    });
    const [showScheduleModal, setShowScheduleModal] = useState(false);
    const [activities, setActivities] = useState(() => {
      const saved = JSON.parse(appStorage.getItem("lq2_activities") || "null") ?? DEFAULT_ACTIVITIES;
      return { ...DEFAULT_ACTIVITIES, ...saved };
    });
    const [newActivity, setNewActivity] = useState("");
    const [showAddActivity, setShowAddActivity] = useState(false);
    const [gems, setGems] = useState(() => JSON.parse(appStorage.getItem("lq2_gems") || "0"));
    const [inventory, setInventory] = useState(() => JSON.parse(appStorage.getItem("lq2_inv") || "[]"));
    const [lastLogin, setLastLogin] = useState(() => appStorage.getItem("lq2_lastlogin") || "");
    const [loginBonus, setLoginBonus] = useState(null);
    const [gachaModal, setGachaModal] = useState(null);
    const [gachaResult, setGachaResult] = useState(null);
    const [ownedChars, setOwnedChars] = useState(() => JSON.parse(appStorage.getItem("lq2_chars") || "[]"));
    const [shieldCharges, setShieldCharges] = useState(() => {
      const saved = appStorage.getItem("lq2_shieldcharges");
      if (saved !== null) return JSON.parse(saved);
      const fromSkills = calcStreakShields(JSON.parse(appStorage.getItem("lq2_skills") || "[]"));
      const fromItems = JSON.parse(appStorage.getItem("lq2_inv") || "[]").filter((i) => i.effect?.type === "streak_shield" && i.used).length;
      return fromSkills + fromItems;
    });
    const [shieldDates, setShieldDates] = useState(() => JSON.parse(appStorage.getItem("lq2_shielddates") || "[]"));
    const [bonusXP, setBonusXP] = useState(() => JSON.parse(appStorage.getItem("lq2_bonusxp") || "0"));
    const [equippedChar, setEquippedChar] = useState(() => appStorage.getItem("lq2_equip") || "");
    const [charXP, setCharXP] = useState(() => JSON.parse(appStorage.getItem("lq2_charxp") || "{}"));
    const [charDetail, setCharDetail] = useState(null);
    const [gachaAnim, setGachaAnim] = useState(false);
    const [magicDetail, setMagicDetail] = useState(null);
    const [tab, setTab] = useState("home");
    const [skillCat, setSkillCat] = useState("study");
    const [form, setForm] = useState({ cat: "study", min: 30, note: "", activity: "" });
    const [levelUp, setLevelUp] = useState(null);
    const [toast, setToast] = useState(null);
    const prevLv = useRef(null);
    const [syncCode, setSyncCode] = useState(() => appStorage.getItem("lq2_synccode") || "");
    const [syncStatus, setSyncStatus] = useState("idle");
    const [syncLastAt, setSyncLastAt] = useState(() => appStorage.getItem("lq2_syncat") || "");
    const [syncInput, setSyncInput] = useState("");
    const [syncBusy, setSyncBusy] = useState(false);
    const syncPushTimer = useRef(null);
    const syncFirstRun = useRef(true);
    useEffect(() => {
      appStorage.setItem("lq2_logs", JSON.stringify(logs));
    }, [logs]);
    useEffect(() => {
      appStorage.setItem("lq2_skills", JSON.stringify(unlocked));
    }, [unlocked]);
    useEffect(() => {
      appStorage.setItem("lq2_spused", JSON.stringify(spUsed));
    }, [spUsed]);
    useEffect(() => {
      appStorage.setItem("lq2_health", JSON.stringify(healthChecks));
    }, [healthChecks]);
    useEffect(() => {
      appStorage.setItem("lq2_hitems", JSON.stringify(healthItems));
    }, [healthItems]);
    useEffect(() => {
      appStorage.setItem("lq2_activities", JSON.stringify(activities));
    }, [activities]);
    useEffect(() => {
      appStorage.setItem("lq2_gems", JSON.stringify(gems));
    }, [gems]);
    useEffect(() => {
      appStorage.setItem("lq2_inv", JSON.stringify(inventory));
    }, [inventory]);
    useEffect(() => {
      appStorage.setItem("lq2_lastlogin", lastLogin);
    }, [lastLogin]);
    useEffect(() => {
      appStorage.setItem("lq2_chars", JSON.stringify(ownedChars));
    }, [ownedChars]);
    useEffect(() => {
      appStorage.setItem("lq2_shieldcharges", JSON.stringify(shieldCharges));
    }, [shieldCharges]);
    useEffect(() => {
      appStorage.setItem("lq2_shielddates", JSON.stringify(shieldDates));
    }, [shieldDates]);
    useEffect(() => {
      appStorage.setItem("lq2_bonusxp", JSON.stringify(bonusXP));
    }, [bonusXP]);
    useEffect(() => {
      if (appStorage.getItem("lq2_bonusxp_migrated")) return;
      appStorage.setItem("lq2_bonusxp_migrated", "1");
      const isBonusLog = (l) => l.min === 0 && l.cat === "study" && typeof l.note === "string" && l.note.endsWith("\u4F7F\u7528");
      const moved = logs.filter(isBonusLog).reduce((s, l) => s + l.xp, 0);
      if (moved > 0) {
        setLogs((prev) => prev.filter((l) => !isBonusLog(l)));
        setBonusXP((b) => b + moved);
      }
    }, []);
    useEffect(() => {
      appStorage.setItem("lq2_equip", equippedChar);
    }, [equippedChar]);
    useEffect(() => {
      appStorage.setItem("lq2_charxp", JSON.stringify(charXP));
    }, [charXP]);
    useEffect(() => {
      appStorage.setItem("lq2_schedule", JSON.stringify(schedule));
    }, [schedule]);
    useEffect(() => {
      appStorage.setItem("lq2_synccode", syncCode);
    }, [syncCode]);
    useEffect(() => {
      appStorage.setItem("lq2_syncat", syncLastAt);
    }, [syncLastAt]);
    useEffect(() => {
      if (syncFirstRun.current) {
        syncFirstRun.current = false;
        return;
      }
      if (!syncCode) return;
      if (syncPushTimer.current) clearTimeout(syncPushTimer.current);
      syncPushTimer.current = setTimeout(() => {
        doSyncPush();
      }, 2e3);
      return () => clearTimeout(syncPushTimer.current);
    }, [logs, unlocked, spUsed, healthChecks, healthItems, activities, gems, inventory, lastLogin, ownedChars, equippedChar, charXP, schedule, shieldCharges, shieldDates, bonusXP, syncCode]);
    function collectSyncData() {
      return { logs, unlocked, spUsed, healthChecks, healthItems, activities, gems, inventory, lastLogin, ownedChars, equippedChar, charXP, schedule, shieldCharges, shieldDates, bonusXP };
    }
    function applySyncData(data) {
      if (!data) return;
      if (data.logs) setLogs(data.logs);
      if (data.unlocked) setUnlocked(data.unlocked);
      if (data.spUsed !== void 0) setSpUsed(data.spUsed);
      if (data.healthChecks) setHealthChecks(data.healthChecks);
      if (data.healthItems) setHealthItems(migrateHealthItems(data.healthItems));
      if (data.activities) setActivities(data.activities);
      if (data.gems !== void 0) setGems(data.gems);
      if (data.inventory) setInventory(data.inventory);
      if (data.lastLogin !== void 0) setLastLogin(data.lastLogin);
      if (data.ownedChars) setOwnedChars(data.ownedChars);
      if (data.equippedChar !== void 0) setEquippedChar(data.equippedChar);
      if (data.charXP) setCharXP(data.charXP);
      if (data.schedule) setSchedule(data.schedule);
      if (data.shieldCharges !== void 0) setShieldCharges(data.shieldCharges);
      if (data.shieldDates) setShieldDates(data.shieldDates);
      if (data.bonusXP !== void 0) setBonusXP(data.bonusXP);
    }
    async function doSyncPush() {
      if (!syncCode) return;
      setSyncStatus("syncing");
      try {
        const remoteAt = await syncPeekUpdatedAt(syncCode);
        if (remoteAt && syncLastAt && remoteAt > syncLastAt) {
          const remote = await syncPull(syncCode);
          if (remote?.data) {
            applySyncData(remote.data);
            setSyncLastAt(remote.updatedAt || (/* @__PURE__ */ new Date()).toISOString());
            setSyncStatus("synced");
            showToast("\u4ED6\u306E\u30C7\u30D0\u30A4\u30B9\u306E\u66F4\u65B0\u3092\u53D6\u308A\u8FBC\u307F\u307E\u3057\u305F\u{1F504}", "#60a5fa");
            return;
          }
        }
        await syncPush(syncCode, collectSyncData());
        setSyncStatus("synced");
        setSyncLastAt((/* @__PURE__ */ new Date()).toISOString());
      } catch (e) {
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
        setSyncLastAt((/* @__PURE__ */ new Date()).toISOString());
        showToast(`\u540C\u671F\u30B3\u30FC\u30C9\u3092\u767A\u884C\u3057\u307E\u3057\u305F\uFF1A${code}`, "#4ade80");
      } catch (e) {
        showToast("\u540C\u671F\u30B3\u30FC\u30C9\u306E\u767A\u884C\u306B\u5931\u6557\u3057\u307E\u3057\u305F", "#ef4444");
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
          showToast("\u305D\u306E\u30B3\u30FC\u30C9\u306E\u30C7\u30FC\u30BF\u304C\u898B\u3064\u304B\u308A\u307E\u305B\u3093", "#ef4444");
          setSyncBusy(false);
          return;
        }
        applySyncData(remote.data);
        setSyncCode(code);
        setSyncStatus("synced");
        setSyncLastAt(remote.updatedAt || (/* @__PURE__ */ new Date()).toISOString());
        setSyncInput("");
        showToast("\u30C7\u30FC\u30BF\u3092\u8AAD\u307F\u8FBC\u307F\u307E\u3057\u305F\u{1F504}", "#60a5fa");
      } catch (e) {
        showToast("\u8AAD\u307F\u8FBC\u307F\u306B\u5931\u6557\u3057\u307E\u3057\u305F", "#ef4444");
      }
      setSyncBusy(false);
    }
    function handleUnlinkSync() {
      setSyncCode("");
      setSyncStatus("idle");
      setSyncLastAt("");
      showToast("\u540C\u671F\u3092\u89E3\u9664\u3057\u307E\u3057\u305F", "#a8a29e");
    }
    const today = getLocalDateString();
    const healthCat = CATEGORIES.find((c) => c.id === "health");
    const logXP = logs.reduce((s, l) => s + l.xp, 0);
    const healthXP = calcHealthXP(healthChecks, healthItems);
    const totalXP = logXP + healthXP + bonusXP;
    const lvInfo = calcLevel(totalXP);
    const stage = getCharStage(lvInfo.lv);
    const streak = calcStreak(logs, healthChecks, shieldDates);
    const ssrBonus = calcSSRBonus(unlocked, equippedChar);
    const confirmedHealthXP = calcHealthXP(healthChecks, healthItems, today);
    const confirmedTotalXP = logXP + confirmedHealthXP;
    const confirmedLvInfo = calcLevel(confirmedTotalXP);
    const totalSP = Math.floor(confirmedLvInfo.lv / 3) + 1;
    const skillPoints = totalSP - spUsed;
    useEffect(() => {
      (async () => {
        let base = { logs, healthChecks, shieldCharges, shieldDates, lastLogin };
        if (syncCode) {
          setSyncStatus("syncing");
          try {
            const remote = await syncPull(syncCode);
            if (remote?.data) {
              applySyncData(remote.data);
              setSyncLastAt(remote.updatedAt || (/* @__PURE__ */ new Date()).toISOString());
              const d = remote.data;
              base = {
                logs: d.logs ?? base.logs,
                healthChecks: d.healthChecks ?? base.healthChecks,
                shieldCharges: d.shieldCharges ?? base.shieldCharges,
                shieldDates: d.shieldDates ?? base.shieldDates,
                lastLogin: d.lastLogin !== void 0 ? d.lastLogin : base.lastLogin
              };
            }
            setSyncStatus("synced");
          } catch (e) {
            setSyncStatus("error");
          }
        }
        if (base.lastLogin === today) return;
        let effectiveShieldDates = base.shieldDates;
        const gaps = getStreakGapDates(base.logs, base.healthChecks, base.shieldDates);
        if (gaps.length > 0 && gaps.length <= base.shieldCharges) {
          effectiveShieldDates = [...base.shieldDates, ...gaps];
          setShieldDates(effectiveShieldDates);
          setShieldCharges((c) => Math.max(0, c - gaps.length));
          showToast(`\u{1F6E1}\uFE0F \u30B9\u30C8\u30EA\u30FC\u30AF\u5B88\u8B77\u304C\u767A\u52D5\uFF01\uFF08${gaps.length}\u65E5\u5206\u3092\u30AB\u30D0\u30FC\uFF09`, "#a78bfa");
        }
        const bridgedStreak = calcStreak(base.logs, base.healthChecks, effectiveShieldDates);
        const newStreak = bridgedStreak > 0 ? bridgedStreak : 1;
        const bonus = getLoginBonus(newStreak);
        setLastLogin(today);
        setGems((g) => g + bonus.gems);
        setLoginBonus({ bonus, streak: newStreak });
      })();
    }, []);
    useEffect(() => {
      if (prevLv.current !== null && lvInfo.lv > prevLv.current) {
        setLevelUp({ oldLv: prevLv.current, newLv: lvInfo.lv });
      }
      prevLv.current = lvInfo.lv;
    }, [lvInfo.lv]);
    function exportCSV() {
      const catLabel = (id) => CATEGORIES.find((c) => c.id === id)?.label ?? id;
      const header = ["\u65E5\u4ED8", "\u30AB\u30C6\u30B4\u30EA", "\u6D3B\u52D5\u5185\u5BB9", "\u6642\u9593(\u5206)", "EXP"];
      const rows = [...logs].sort((a2, b) => a2.date.localeCompare(b.date)).map((l) => [
        l.date,
        catLabel(l.cat),
        `"${(l.note || "").replace(/"/g, '""')}"`,
        l.min ?? "",
        l.xp
      ]);
      const bom = "\uFEFF";
      const csv = bom + [header, ...rows].map((r) => r.join(",")).join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `life-quest-log-${today}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      showToast("CSV\u3092\u30A8\u30AF\u30B9\u30DD\u30FC\u30C8\u3057\u307E\u3057\u305F\u{1F4C4}", "#4ade80");
    }
    function exportJSON() {
      const data = {
        exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
        logs,
        healthChecks,
        healthItems,
        gems,
        inventory,
        unlocked,
        skillPoints: spUsed
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `life-quest-backup-${today}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast("\u30D0\u30C3\u30AF\u30A2\u30C3\u30D7\u3092\u30A8\u30AF\u30B9\u30DD\u30FC\u30C8\u3057\u307E\u3057\u305F\u{1F4BE}", "#60a5fa");
    }
    function showToast(msg, color = "#4f6ef7") {
      setToast({ msg, color });
      setTimeout(() => setToast(null), 2500);
    }
    function grantCharXP(xp) {
      if (!equippedChar || xp <= 0) return;
      setCharXP((prev) => ({ ...prev, [equippedChar]: (prev[equippedChar] || 0) + xp }));
    }
    function addLog() {
      const cat = CATEGORIES.find((c) => c.id === form.cat);
      const xpBonus = calcXPBonus(form.cat, unlocked, Number(form.min));
      const gemBonus = calcGemBonus(form.cat, unlocked, equippedChar);
      const activeBuff = inventory.find((i) => i.effect?.type === "xp_mult" && i.effect.cat === form.cat && i.active && !i.used);
      const buffBonus = activeBuff ? activeBuff.effect.val - 1 : 0;
      if (activeBuff) {
        setInventory((prev) => prev.map((i) => i.uid === activeBuff.uid ? { ...i, used: true, active: false } : i));
        showToast(`${activeBuff.label}\u767A\u52D5\uFF01EXP\xD7${activeBuff.effect.val}\u500D\uFF01`, "#f0c060");
      }
      const externalBonus = calcExternalXPBonus(form.cat, equippedChar) + buffBonus;
      const totalMult = (1 + xpBonus) * (1 + externalBonus);
      if (cat.mode === "count") {
        const todayExploreCount = logs.filter((l) => l.cat === form.cat && l.date === today).length;
        if (todayExploreCount >= EXPLORE_DAILY_LIMIT) {
          const entry3 = { id: Date.now(), cat: form.cat, min: null, note: form.note, xp: 0, date: today, capped: true };
          setLogs((prev) => [entry3, ...prev]);
          setForm((f) => ({ ...f, note: "" }));
          showToast(`\u672C\u65E5\u306E\u63A2\u7D22\u306F\u4E0A\u9650\uFF08${EXPLORE_DAILY_LIMIT}\u56DE\uFF09\u306B\u9054\u3057\u307E\u3057\u305F\u3002\u8A18\u9332\u306E\u307F\u4FDD\u5B58\u3055\u308C\u307E\u3059`, "#a8a29e");
          return;
        }
        const xp2 = Math.floor(cat.baseXP * totalMult);
        const gemsEarned2 = 2 + gemBonus;
        const entry2 = { id: Date.now(), cat: form.cat, min: null, note: form.note, xp: xp2, date: today };
        setLogs((prev) => [entry2, ...prev]);
        setGems((g) => g + gemsEarned2);
        grantCharXP(xp2);
        setForm((f) => ({ ...f, note: "" }));
        showToast(`+${xp2} EXP / +${gemsEarned2}\u{1F48E}`, cat.color);
        return;
      }
      const dailyCap = calcDailyCapMinutes(schedule);
      const commuteCap = calcCommuteBonusMinutes(schedule);
      const isCommuteEligible = commuteCap > 0 && COMMUTE_ELIGIBLE_CATS.includes(form.cat);
      const todayTimeLogs = logs.filter((l) => l.date === today && CATEGORIES.find((c) => c.id === l.cat)?.mode === "time");
      const todayMainUsed = todayTimeLogs.reduce((s, l) => s + (l.creditMainMin ?? l.min ?? 0), 0);
      const todayCommuteUsed = todayTimeLogs.filter((l) => COMMUTE_ELIGIBLE_CATS.includes(l.cat)).reduce((s, l) => s + (l.creditCommuteMin ?? 0), 0);
      const mainRemaining = Math.max(0, dailyCap - todayMainUsed);
      const commuteRemaining = isCommuteEligible ? Math.max(0, commuteCap - todayCommuteUsed) : 0;
      const loggedMin = Number(form.min);
      const creditCommuteMin = isCommuteEligible ? Math.min(loggedMin, commuteRemaining) : 0;
      const leftoverAfterCommute = loggedMin - creditCommuteMin;
      const creditMainMin = Math.min(leftoverAfterCommute, mainRemaining);
      const creditedMin = creditMainMin + creditCommuteMin;
      const ratio = loggedMin > 0 ? creditedMin / loggedMin : 0;
      const baseXP = cat.xpRate * creditedMin;
      const xp = Math.floor(baseXP * totalMult);
      const gemsEarned = Math.floor(creditedMin / 15) + (ratio > 0 ? gemBonus : 0);
      const entry = {
        id: Date.now(),
        cat: form.cat,
        min: loggedMin,
        note: form.activity,
        xp,
        date: today,
        creditMainMin,
        creditCommuteMin,
        capped: ratio < 1
      };
      setLogs((prev) => [entry, ...prev]);
      setGems((g) => g + gemsEarned);
      grantCharXP(xp);
      setForm((f) => ({ ...f, min: 30 }));
      if (ratio <= 0) {
        showToast(`\u672C\u65E5\u306E\u8A18\u9332\u4E0A\u9650\u306B\u9054\u3057\u307E\u3057\u305F\u3002\u4F11\u606F\u3082\u5927\u5207\u3067\u3059\u{1F319}`, "#a8a29e");
      } else if (ratio < 1) {
        showToast(`\u4E0A\u9650\u306B\u8FD1\u3044\u305F\u3081\u4E00\u90E8\u306E\u307F\u52A0\u7B97\uFF1A+${xp} EXP / +${gemsEarned}\u{1F48E}`, "#f0a850");
      } else if (creditCommuteMin > 0) {
        showToast(`+${xp} EXP / +${gemsEarned}\u{1F48E}\uFF08\u901A\u52E4\u67A0\u3092\u4F7F\u7528\uFF09`, cat.color);
      } else if (!activeBuff) {
        showToast(`+${xp} EXP / +${gemsEarned}\u{1F48E}`, cat.color);
      }
    }
    function doGacha(poolId) {
      const pool = GACHA_POOLS[poolId];
      if (gems < pool.cost) {
        showToast("\u30EB\u30FC\u30F3\u77F3\u304C\u8DB3\u308A\u306A\u3044\uFF01", "#ef4444");
        return;
      }
      setGems((g) => g - pool.cost);
      setGachaAnim(true);
      setTimeout(() => {
        const item = drawGacha(poolId, ssrBonus, unlocked, ownedChars);
        if (item.type === "character") {
          setOwnedChars((prev) => prev.includes(item.id) ? prev : [...prev, item.id]);
          showToast(`\u65B0\u3057\u3044\u4EF2\u9593\u300C${item.name}\u300D\u3092\u4EF2\u9593\u306B\u3057\u305F\uFF01\u{1F389}`, "#f0c060");
        } else {
          setInventory((prev) => [...prev, { ...item, uid: Date.now() + Math.random(), used: false, active: false }]);
        }
        setGachaResult(item);
        setGachaAnim(false);
      }, 1200);
    }
    function useItem(uid) {
      const item = inventory.find((i) => i.uid === uid);
      if (!item || item.used) return;
      const eff = item.effect;
      if (!eff) {
        setInventory((prev) => prev.map((i) => i.uid === uid ? { ...i, used: true } : i));
        showToast(`\u300C${item.label}\u300D\u3092\u4F7F\u7528\uFF01\u697D\u3057\u3093\u3067\u304D\u3066\u304F\u3060\u3055\u3044\u{1F389}`, "#f0c060");
        return;
      }
      if (eff.type === "streak_shield") {
        setInventory((prev) => prev.map((i) => i.uid === uid ? { ...i, used: true } : i));
        setShieldCharges((c) => c + (eff.val || 1));
        showToast("\u{1F6E1}\uFE0F \u30B9\u30C8\u30EA\u30FC\u30AF\u5B88\u8B77\u3092\u30C1\u30E3\u30FC\u30B8\uFF01\u8A18\u9332\u3067\u304D\u306A\u3044\u65E5\u304C\u3042\u3063\u3066\u3082\u81EA\u52D5\u3067\u30AB\u30D0\u30FC\u3057\u307E\u3059", "#f0c060");
      } else if (eff.type === "gems") {
        setInventory((prev) => prev.map((i) => i.uid === uid ? { ...i, used: true } : i));
        setGems((g) => g + eff.val);
        showToast(`${item.label}\u3092\u4F7F\u7528\uFF01\u{1F48E}+${eff.val}`, "#f0c060");
      } else if (eff.type === "bonus_xp") {
        setInventory((prev) => prev.map((i) => i.uid === uid ? { ...i, used: true } : i));
        setBonusXP((b) => b + eff.val);
        showToast(`${item.label}\u3092\u4F7F\u7528\uFF01EXP+${eff.val}`, "#60a5fa");
      } else if (eff.type === "xp_mult") {
        setInventory((prev) => prev.map((i) => {
          if (i.uid === uid) return { ...i, active: true };
          if (i.effect?.type === "xp_mult" && i.effect.cat === eff.cat && !i.used) return { ...i, active: false };
          return i;
        }));
        showToast(`${item.label}\u3092\u30BB\u30C3\u30C8\uFF01\u6B21\u306E${CATEGORIES.find((c) => c.id === eff.cat)?.label}\u8A18\u9332\u3067EXP\xD7${eff.val}\u500D`, "#f0c060");
      }
    }
    function addActivity(catId) {
      const label = newActivity.trim();
      if (!label) return;
      setActivities((prev) => {
        const list = prev[catId] || [];
        if (list.includes(label)) return prev;
        return { ...prev, [catId]: [...list, label] };
      });
      setForm((f) => ({ ...f, activity: label }));
      setNewActivity("");
    }
    function toggleHealthItem(itemId) {
      const item = healthItems.find((i) => i.id === itemId);
      const itemXP = item?.xp ?? 12;
      setHealthChecks((prev) => {
        const todayList = prev[today] || [];
        const isChecked = todayList.includes(itemId);
        let updated;
        if (isChecked) {
          updated = todayList.filter((id) => id !== itemId);
        } else if (item?.group) {
          const others = healthItems.filter((i) => i.group === item.group && i.id !== itemId).map((i) => i.id);
          updated = [...todayList.filter((id) => !others.includes(id)), itemId];
          showToast(`+${itemXP} EXP \u7372\u5F97\uFF01`, healthCat.color);
          grantCharXP(itemXP);
        } else {
          updated = [...todayList, itemId];
          showToast(`+${itemXP} EXP \u7372\u5F97\uFF01`, healthCat.color);
          grantCharXP(itemXP);
        }
        return { ...prev, [today]: updated };
      });
    }
    function deleteHealthItem(itemId) {
      if (DEFAULT_HEALTH_ITEMS.some((d) => d.id === itemId)) return;
      setHealthItems((prev) => prev.filter((i) => i.id !== itemId));
      setHealthChecks((prev) => {
        const updated = {};
        for (const [date, ids] of Object.entries(prev)) updated[date] = ids.filter((id) => id !== itemId);
        return updated;
      });
    }
    function addHealthItem() {
      const label = newHabit.trim();
      if (!label) return;
      const id = "h" + Date.now();
      const diff = HEALTH_DIFFICULTY[newHabitDiff] ?? HEALTH_DIFFICULTY.normal;
      setHealthItems((prev) => [...prev, { id, label, icon: "\u2B50", difficulty: newHabitDiff, xp: diff.xp }]);
      setNewHabit("");
      setNewHabitDiff("normal");
    }
    function unlockSkill(nodeId) {
      if (skillPoints <= 0) return;
      const node = Object.values(SKILL_TREE).flat().find((n) => n.id === nodeId);
      setUnlocked((prev) => [...prev, nodeId]);
      setSpUsed((prev) => prev + 1);
      if (node?.type === "streak") {
        setShieldCharges((c) => c + (node.val || 1));
        showToast("\u30B9\u30AD\u30EB\u89E3\u653E\uFF01\u{1F6E1}\uFE0F \u30B9\u30C8\u30EA\u30FC\u30AF\u5B88\u8B77\u3092\u30C1\u30E3\u30FC\u30B8", "#f0c060");
      } else {
        showToast("\u30B9\u30AD\u30EB\u89E3\u653E\uFF01", "#f0c060");
      }
    }
    const todayLogs = logs.filter((l) => l.date === today);
    const todayMin = todayLogs.reduce((s, l) => s + (l.min || 0), 0);
    const todayHealthChecked = healthChecks[today] || [];
    const todayHealthXP = todayHealthChecked.reduce((s, id) => {
      const item = healthItems.find((i) => i.id === id);
      return s + (item?.xp ?? 12);
    }, 0);
    const todayXP = todayLogs.reduce((s, l) => s + l.xp, 0) + todayHealthXP;
    const catStats = CATEGORIES.filter((c) => c.mode !== "check").map((c) => ({
      ...c,
      total: logs.filter((l) => l.cat === c.id).reduce((s, l) => s + (l.min || 0), 0),
      count: logs.filter((l) => l.cat === c.id).length,
      xp: logs.filter((l) => l.cat === c.id).reduce((s, l) => s + l.xp, 0)
    }));
    const maxMin = Math.max(...catStats.filter((c) => c.mode === "time").map((c) => c.total), 1);
    const maxCount = Math.max(...catStats.filter((c) => c.mode === "count").map((c) => c.count), 1);
    const HIST_DAYS = 14;
    const histDates = Array.from({ length: HIST_DAYS }, (_, i) => {
      const d = /* @__PURE__ */ new Date();
      d.setDate(d.getDate() - (HIST_DAYS - 1 - i));
      return getLocalDateString(d);
    });
    const timeCats = CATEGORIES.filter((c) => c.mode === "time");
    const dailyHistory = histDates.map((date) => {
      const dayLogs = logs.filter((l) => l.date === date);
      const byCat = {};
      timeCats.forEach((c) => {
        byCat[c.id] = dayLogs.filter((l) => l.cat === c.id).reduce((s, l) => s + (l.min || 0), 0);
      });
      const dayTotal = Object.values(byCat).reduce((s, v) => s + v, 0);
      return { date, byCat, total: dayTotal };
    });
    const maxDayTotal = Math.max(...dailyHistory.map((d) => d.total), 1);
    const allTimeTotal = timeCats.reduce((s, c) => s + catStats.find((cs) => cs.id === c.id).total, 0);
    let donutCursor = 0;
    const donutSegments = timeCats.map((c) => {
      const val = catStats.find((cs) => cs.id === c.id).total;
      const pct2 = allTimeTotal > 0 ? val / allTimeTotal : 0;
      const startAngle = donutCursor * 360;
      donutCursor += pct2;
      const endAngle = donutCursor * 360;
      return { ...c, val, pct: pct2, startAngle, endAngle };
    });
    function polarToXY(cx, cy, r, angleDeg) {
      const a = (angleDeg - 90) * Math.PI / 180;
      return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    }
    function donutArcPath(cx, cy, rOuter, rInner, startAngle, endAngle) {
      if (endAngle - startAngle >= 359.99) endAngle = startAngle + 359.99;
      const large = endAngle - startAngle > 180 ? 1 : 0;
      const [x1, y1] = polarToXY(cx, cy, rOuter, startAngle);
      const [x2, y2] = polarToXY(cx, cy, rOuter, endAngle);
      const [x3, y3] = polarToXY(cx, cy, rInner, endAngle);
      const [x4, y4] = polarToXY(cx, cy, rInner, startAngle);
      return `M ${x1} ${y1} A ${rOuter} ${rOuter} 0 ${large} 1 ${x2} ${y2} L ${x3} ${y3} A ${rInner} ${rInner} 0 ${large} 0 ${x4} ${y4} Z`;
    }
    const pct = Math.min(lvInfo.current / lvInfo.needed * 100, 100);
    const BG = "#f0ede8";
    const PANEL = "rgba(255,252,248,0.96)";
    const BORDER = "rgba(99,102,241,0.18)";
    const CYAN = "#4f6ef7";
    const GOLD = "#c47f17";
    const glassCard = {
      background: PANEL,
      border: `1px solid ${BORDER}`,
      borderRadius: 16,
      backdropFilter: "blur(12px)",
      boxShadow: "0 2px 16px rgba(99,102,241,0.07)"
    };
    return /* @__PURE__ */ React.createElement("div", { style: {
      minHeight: "100vh",
      background: BG,
      color: "#1e1b2e",
      fontFamily: "'SF Pro Display',-apple-system,BlinkMacSystemFont,'Hiragino Sans',sans-serif",
      display: "flex",
      flexDirection: "column",
      maxWidth: 430,
      margin: "0 auto",
      position: "relative",
      overflow: "hidden"
    } }, /* @__PURE__ */ React.createElement("style", null, `
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
      `), /* @__PURE__ */ React.createElement("div", { style: {
      position: "fixed",
      inset: 0,
      pointerEvents: "none",
      zIndex: 0,
      overflow: "hidden"
    } }, /* @__PURE__ */ React.createElement("div", { style: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      height: "2px",
      background: `linear-gradient(transparent,${CYAN}18,transparent)`,
      animation: "scanline 8s linear infinite"
    } })), /* @__PURE__ */ React.createElement("div", { style: {
      position: "sticky",
      top: 0,
      zIndex: 50,
      background: `linear-gradient(180deg,${BG} 70%,transparent)`,
      padding: "16px 20px 10px"
    } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 } }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, letterSpacing: 5, color: CYAN, marginBottom: 2 } }, "LIFE QUEST"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 18, fontWeight: 800, letterSpacing: -0.3, lineHeight: 1 } }, getTitle(lvInfo.lv))), /* @__PURE__ */ React.createElement("div", { onClick: () => setTab("gacha"), style: {
      display: "flex",
      alignItems: "center",
      gap: 5,
      cursor: "pointer",
      background: "linear-gradient(135deg,#fef3c7,#fde68a)",
      border: "1px solid #f0c060",
      borderRadius: 999,
      padding: "5px 12px"
    } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 14 } }, "\u{1F48E}"), /* @__PURE__ */ React.createElement("span", { style: { fontWeight: 800, fontSize: 14, color: "#92400e" } }, gems)), /* @__PURE__ */ React.createElement("div", { style: { textAlign: "right" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, color: "#57534e", letterSpacing: 3 } }, "RANK"), /* @__PURE__ */ React.createElement("div", { style: {
      fontSize: 34,
      fontWeight: 900,
      lineHeight: 1,
      color: stage.primaryColor,
      textShadow: `0 0 20px ${stage.primaryColor}88`
    } }, lvInfo.lv))), /* @__PURE__ */ React.createElement("div", { style: { position: "relative", height: 4, background: "#e2ddd6", borderRadius: 999, overflow: "visible" } }, /* @__PURE__ */ React.createElement("div", { style: {
      position: "absolute",
      top: 0,
      left: 0,
      height: "100%",
      borderRadius: 999,
      width: `${pct}%`,
      background: `linear-gradient(90deg,${stage.accentColor},${stage.primaryColor})`,
      boxShadow: `0 0 12px ${stage.primaryColor}`,
      transition: "width .8s cubic-bezier(.4,0,.2,1)"
    } }), /* @__PURE__ */ React.createElement("div", { style: {
      position: "absolute",
      top: "50%",
      left: `${pct}%`,
      transform: "translate(-50%,-50%)",
      width: 8,
      height: 8,
      borderRadius: "50%",
      background: stage.primaryColor,
      boxShadow: `0 0 8px ${stage.primaryColor}`,
      transition: "left .8s cubic-bezier(.4,0,.2,1)"
    } })), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", fontSize: 9, color: "#78716c", marginTop: 4 } }, /* @__PURE__ */ React.createElement("span", null, "EXP ", lvInfo.current.toLocaleString()), /* @__PURE__ */ React.createElement("span", null, "SP ", skillPoints, " | NEXT ", lvInfo.needed.toLocaleString()))), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, overflowY: "auto", padding: "0 14px 100px", position: "relative", zIndex: 1 } }, tab === "home" && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 12, animation: "fadeup .3s ease" } }, /* @__PURE__ */ React.createElement("div", { style: {
      ...glassCard,
      background: equippedChar && GACHA_CHARACTERS.find((c) => c.id === equippedChar) ? "linear-gradient(160deg,#fffbeb 0%,#faf8f5 100%)" : `linear-gradient(160deg,${stage.primaryColor}14 0%,#faf8f5 100%)`,
      border: equippedChar && GACHA_CHARACTERS.find((c) => c.id === equippedChar) ? "1px solid #fbbf2455" : `1px solid ${stage.primaryColor}30`,
      padding: "20px",
      display: "flex",
      gap: 16,
      alignItems: "center"
    } }, /* @__PURE__ */ React.createElement("div", { style: { width: 96, height: 128, flexShrink: 0 } }, (() => {
      const eqData = GACHA_CHARACTERS.find((c) => c.id === equippedChar);
      if (eqData) {
        return /* @__PURE__ */ React.createElement("img", { src: getCharacterStageImage(eqData, calcCharLevel(charXP[eqData.id] || 0).lv), alt: eqData.name, style: {
          width: "100%",
          height: "100%",
          objectFit: "contain",
          filter: "drop-shadow(0 4px 12px #fbbf2455)"
        }, onError: (e) => {
          e.target.style.display = "none";
        } });
      }
      return /* @__PURE__ */ React.createElement(CharacterSVG, { stage, lv: lvInfo.lv, animated: true });
    })()), /* @__PURE__ */ React.createElement("div", { style: { flex: 1 } }, (() => {
      const eqData = GACHA_CHARACTERS.find((c) => c.id === equippedChar);
      if (eqData) {
        return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, color: "#a16207", letterSpacing: 3, marginBottom: 4 } }, "EQUIPPED"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 22, fontWeight: 800, marginBottom: 2 } }, eqData.name), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "#78716c", marginBottom: 12 } }, "\u2605\u2605\u2605 UR"));
      }
      return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, color: stage.primaryColor, letterSpacing: 3, marginBottom: 4 } }, stage.name.toUpperCase()), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 22, fontWeight: 800, marginBottom: 2 } }, stage.title_ja), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "#78716c", marginBottom: 12 } }, "\u2605".repeat(stage.rarity), "\u2606".repeat(5 - stage.rarity)));
    })(), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 } }, [
      { v: todayLogs.length, u: "\u672C\u65E5\u306E\u8A18\u9332" },
      { v: streak, u: "\u65E5\u9023\u7D9A" },
      { v: todayXP, u: "\u672C\u65E5EXP" }
    ].map(({ v, u }) => /* @__PURE__ */ React.createElement("div", { key: u }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 20, fontWeight: 800, color: stage.primaryColor } }, v), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, color: "#57534e" } }, u)))), shieldCharges > 0 && /* @__PURE__ */ React.createElement("div", { style: { marginTop: 8, fontSize: 10, color: "#8b5cf6", fontWeight: 700 } }, "\u{1F6E1}\uFE0F \u30B9\u30C8\u30EA\u30FC\u30AF\u5B88\u8B77 \xD7", shieldCharges, "\uFF08\u8A18\u9332\u3067\u304D\u306A\u3044\u65E5\u3092\u81EA\u52D5\u3067\u30AB\u30D0\u30FC\uFF09"))), /* @__PURE__ */ React.createElement("div", { style: { ...glassCard, padding: "16px" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, letterSpacing: 4, color: CYAN, marginBottom: 12 } }, "RECENT LOGS"), logs.length === 0 && /* @__PURE__ */ React.createElement("div", { style: { textAlign: "center", color: "#c5bfb8", padding: "32px 0", fontSize: 13 } }, "\u307E\u3060\u8A18\u9332\u306A\u3057", /* @__PURE__ */ React.createElement("br", null), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "#ddd8d0" } }, "LOG \u30BF\u30D6\u304B\u3089\u59CB\u3081\u3088\u3046")), logs.slice(0, 6).map((l) => {
      const cat = CATEGORIES.find((c) => c.id === l.cat);
      return /* @__PURE__ */ React.createElement("div", { key: l.id, style: {
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 0",
        borderBottom: "1px solid #e8e3db"
      } }, /* @__PURE__ */ React.createElement("div", { style: {
        width: 38,
        height: 38,
        borderRadius: 10,
        flexShrink: 0,
        background: `${cat.color}18`,
        border: `1px solid ${cat.color}40`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 16,
        color: cat.color
      } }, cat.icon), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 600, fontSize: 13, display: "flex", gap: 6, alignItems: "center" } }, /* @__PURE__ */ React.createElement("span", { style: { color: cat.color, fontSize: 9, letterSpacing: 2 } }, cat.en), l.note && /* @__PURE__ */ React.createElement("span", { style: { color: "#57534e", fontWeight: 400, fontSize: 12 } }, "\xB7 ", l.note)), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "#78716c", marginTop: 2 } }, l.date)), /* @__PURE__ */ React.createElement("div", { style: { textAlign: "right", flexShrink: 0 } }, l.min != null ? /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 700, fontSize: 13, color: cat.color } }, l.min, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 9, color: "#78716c" } }, "min")) : /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 700, fontSize: 13, color: cat.color } }, "1", /* @__PURE__ */ React.createElement("span", { style: { fontSize: 9, color: "#78716c" } }, "\u56DE")), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "#57534e" } }, "+", l.xp, " EXP")));
    }))), tab === "character" && (() => {
      const equippedData = GACHA_CHARACTERS.find((c) => c.id === equippedChar);
      return /* @__PURE__ */ React.createElement("div", { style: { animation: "fadeup .3s ease" } }, /* @__PURE__ */ React.createElement("div", { style: {
        ...glassCard,
        background: equippedData ? "linear-gradient(180deg,#fffbeb 0%,#faf8f5 60%)" : `linear-gradient(180deg,${stage.primaryColor}18 0%,#faf8f5 60%)`,
        border: equippedData ? "1px solid #fbbf2455" : `1px solid ${stage.primaryColor}40`,
        padding: "24px 20px",
        marginBottom: 12,
        position: "relative",
        overflow: "hidden"
      } }, /* @__PURE__ */ React.createElement("div", { style: {
        position: "absolute",
        inset: 0,
        opacity: 0.06,
        backgroundImage: `linear-gradient(${equippedData ? "#fbbf24" : stage.primaryColor} 1px,transparent 1px),linear-gradient(90deg,${equippedData ? "#fbbf24" : stage.primaryColor} 1px,transparent 1px)`,
        backgroundSize: "20px 20px"
      } }), equippedData ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: { textAlign: "center", fontSize: 14, marginBottom: 4, color: "#f0c060", textShadow: "0 0 8px #f0c060" } }, "\u2605\u2605\u2605 UR"), /* @__PURE__ */ React.createElement("div", { style: { height: 300, position: "relative", zIndex: 1, display: "flex", alignItems: "center", justifyContent: "center" } }, /* @__PURE__ */ React.createElement("img", { src: getCharacterStageImage(equippedData, calcCharLevel(charXP[equippedData.id] || 0).lv), alt: equippedData.name, style: {
        maxHeight: "100%",
        maxWidth: "100%",
        objectFit: "contain",
        filter: "drop-shadow(0 8px 24px #fbbf2455)"
      }, onError: (e) => {
        e.target.style.display = "none";
      } })), /* @__PURE__ */ React.createElement("div", { style: { textAlign: "center", position: "relative", zIndex: 1, marginTop: 8 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, letterSpacing: 5, color: "#a16207" } }, "EQUIPPED CHARACTER"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 28, fontWeight: 900, margin: "4px 0" } }, equippedData.name), (() => {
        const cLv = calcCharLevel(charXP[equippedData.id] || 0);
        return /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "#a16207", marginBottom: 6, fontWeight: 700 } }, "\u30AD\u30E3\u30E9Lv.", cLv.lv, cLv.isMax ? " (MAX)" : "");
      })(), /* @__PURE__ */ React.createElement("div", { style: {
        display: "inline-block",
        padding: "3px 16px",
        borderRadius: 999,
        background: "#fef3c722",
        border: "1px solid #fbbf2455",
        fontSize: 11,
        color: "#a16207"
      } }, equippedData.passiveDesc)), /* @__PURE__ */ React.createElement("div", { style: { textAlign: "center", marginTop: 14, position: "relative", zIndex: 1 } }, /* @__PURE__ */ React.createElement("button", { onClick: () => {
        setEquippedChar("");
        showToast("\u57FA\u672C\u30AD\u30E3\u30E9\u30AF\u30BF\u30FC\u306B\u623B\u3057\u307E\u3057\u305F", "#a8a29e");
      }, style: {
        padding: "8px 20px",
        borderRadius: 10,
        border: "1px solid #d6d3d1",
        cursor: "pointer",
        background: "#fff",
        color: "#78716c",
        fontWeight: 700,
        fontSize: 12
      } }, "\u57FA\u672C\u30AD\u30E3\u30E9\u30AF\u30BF\u30FC\u306B\u623B\u3059"))) : /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: {
        textAlign: "center",
        fontSize: 14,
        marginBottom: 4,
        color: GOLD,
        textShadow: `0 0 8px ${GOLD}`
      } }, "\u2605".repeat(stage.rarity)), /* @__PURE__ */ React.createElement("div", { style: { height: 300, position: "relative", zIndex: 1 } }, /* @__PURE__ */ React.createElement(CharacterSVG, { stage, lv: lvInfo.lv, animated: true })), /* @__PURE__ */ React.createElement("div", { style: { textAlign: "center", position: "relative", zIndex: 1, marginTop: 8 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, letterSpacing: 5, color: stage.primaryColor } }, stage.name.toUpperCase()), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 28, fontWeight: 900, margin: "4px 0" } }, stage.title_ja), /* @__PURE__ */ React.createElement("div", { style: {
        display: "inline-block",
        padding: "3px 16px",
        borderRadius: 999,
        background: `${stage.primaryColor}22`,
        border: `1px solid ${stage.primaryColor}55`,
        fontSize: 11,
        color: stage.primaryColor
      } }, "Lv.", lvInfo.lv, " \xB7 ", getTitle(lvInfo.lv))))), /* @__PURE__ */ React.createElement("div", { style: { ...glassCard, padding: "16px", marginBottom: 12 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, letterSpacing: 4, color: CYAN, marginBottom: 12 } }, "CHARACTER STATS"), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 } }, [
        { label: "\u7DCFEXP", v: totalXP.toLocaleString(), color: CYAN },
        { label: "\u7DCF\u6D3B\u52D5\u6642\u9593", v: `${logs.reduce((s, l) => s + (l.min || 0), 0)}min`, color: GOLD },
        { label: "\u8A18\u9332\u56DE\u6570", v: logs.length, color: "#a78bfa" },
        { label: "\u6700\u9AD8\u9023\u7D9A\u65E5\u6570", v: `${streak}\u65E5`, color: "#fb923c" },
        { label: "\u30B9\u30AD\u30EB\u89E3\u653E\u6570", v: `${unlocked.length}\u500B`, color: "#4ade80" },
        { label: "\u30B9\u30AD\u30EB\u30DD\u30A4\u30F3\u30C8", v: `${skillPoints}SP`, color: GOLD }
      ].map(({ label, v, color }) => /* @__PURE__ */ React.createElement("div", { key: label, style: {
        background: "#f5f2ee",
        borderRadius: 10,
        padding: "10px 12px",
        border: "1px solid #ddd8d0"
      } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, color: "#78716c", letterSpacing: 2, marginBottom: 4 } }, label), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 18, fontWeight: 800, color } }, v))))), (() => {
        const next = CHAR_STAGES.find((s) => s.minLv > lvInfo.lv);
        if (!next) return null;
        return /* @__PURE__ */ React.createElement("div", { style: { ...glassCard, padding: "14px 16px", border: `1px solid ${next.primaryColor}30`, marginBottom: 12 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, letterSpacing: 3, color: next.primaryColor, marginBottom: 8 } }, "NEXT ASCENSION"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center" } }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 700 } }, next.title_ja, " ", /* @__PURE__ */ React.createElement("span", { style: { fontSize: 9, color: "#78716c" } }, "(", next.name, ")")), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "#57534e", marginTop: 2 } }, "Lv.", next.minLv, " \u3067\u89E3\u653E")), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 22, color: next.primaryColor } }, "\u2605".repeat(next.rarity))), /* @__PURE__ */ React.createElement("div", { style: { marginTop: 10, height: 3, background: "#e2ddd6", borderRadius: 999, overflow: "hidden" } }, /* @__PURE__ */ React.createElement("div", { style: {
          height: "100%",
          background: `linear-gradient(90deg,${next.accentColor},${next.primaryColor})`,
          width: `${Math.min(lvInfo.lv / next.minLv * 100, 100)}%`,
          borderRadius: 999,
          transition: "width .6s ease"
        } })), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, color: "#78716c", marginTop: 4, textAlign: "right" } }, "Lv.", lvInfo.lv, " / ", next.minLv));
      })(), /* @__PURE__ */ React.createElement("div", { style: { ...glassCard, padding: "16px" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, letterSpacing: 3, color: "#a16207" } }, "CHARACTER COLLECTION"), /* @__PURE__ */ React.createElement("div", { style: {
        fontSize: 11,
        fontWeight: 700,
        color: "#a16207",
        background: "#fef3c7",
        padding: "3px 10px",
        borderRadius: 999
      } }, ownedChars.length, "/", GACHA_CHARACTERS.length)), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "#78716c", marginBottom: 14 } }, "\u30AC\u30C1\u30E3\u3067\u4F4E\u78BA\u7387\u5165\u624B\u3067\u304D\u308B\u7279\u5225\u306A\u4EF2\u9593\u305F\u3061\u3002\u88C5\u5099\u3059\u308B\u3068\u898B\u305F\u76EE\u3068\u30D1\u30C3\u30B7\u30D6\u52B9\u679C\u304C\u5207\u308A\u66FF\u308F\u308B\u3002"), GACHA_CHARACTERS.length === 0 ? /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "#a8a29e", textAlign: "center", padding: "16px 0" } }, "\u307E\u3060\u30AD\u30E3\u30E9\u30AF\u30BF\u30FC\u304C\u767B\u9332\u3055\u308C\u3066\u3044\u307E\u305B\u3093") : /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(88px, 1fr))", gap: 10 } }, GACHA_CHARACTERS.map((c) => {
        const owned = ownedChars.includes(c.id);
        const isEquipped = equippedChar === c.id;
        return /* @__PURE__ */ React.createElement(
          "div",
          {
            key: c.id,
            onClick: () => setCharDetail({ char: c, owned }),
            style: {
              aspectRatio: "0.8",
              borderRadius: 14,
              cursor: "pointer",
              padding: "8px 6px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "flex-end",
              position: "relative",
              overflow: "hidden",
              background: owned ? "linear-gradient(160deg,#fffbeb,#fef3c7)" : "#ece8e2",
              border: isEquipped ? "2px solid #fbbf24" : owned ? "1.5px solid #fbbf2466" : "1.5px solid #ddd8d0"
            }
          },
          owned ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("img", { src: getCharacterStageImage(c, calcCharLevel(charXP[c.id] || 0).lv), alt: c.name, style: {
            position: "absolute",
            top: 4,
            left: 0,
            right: 0,
            height: "65%",
            objectFit: "contain",
            margin: "0 auto"
          }, onError: (e) => {
            e.target.style.display = "none";
          } }), /* @__PURE__ */ React.createElement("span", { style: {
            position: "absolute",
            top: 4,
            left: 4,
            fontSize: 8,
            fontWeight: 800,
            color: "#78350f",
            background: "#fef3c7",
            padding: "1px 5px",
            borderRadius: 4
          } }, "Lv", calcCharLevel(charXP[c.id] || 0).lv)) : /* @__PURE__ */ React.createElement("span", { style: { position: "absolute", top: "25%", fontSize: 22, color: "#a8a29e" } }, "?"),
          /* @__PURE__ */ React.createElement("div", { style: {
            fontSize: 9,
            fontWeight: 700,
            textAlign: "center",
            color: owned ? "#78350f" : "#a8a29e",
            zIndex: 1
          } }, owned ? c.name : "\uFF1F\uFF1F\uFF1F"),
          isEquipped && /* @__PURE__ */ React.createElement("span", { style: {
            position: "absolute",
            top: 4,
            right: 4,
            fontSize: 8,
            fontWeight: 800,
            color: "#92400e",
            background: "#fde68a",
            padding: "1px 6px",
            borderRadius: 4
          } }, "\u88C5\u5099\u4E2D")
        );
      }))));
    })(), tab === "record" && (() => {
      const selCat = CATEGORIES.find((c) => c.id === form.cat);
      const dailyCap = calcDailyCapMinutes(schedule);
      const commuteCap = calcCommuteBonusMinutes(schedule);
      const todayTimeLogs = logs.filter((l) => l.date === today && CATEGORIES.find((c) => c.id === l.cat)?.mode === "time");
      const todayMinUsed = todayTimeLogs.reduce((s, l) => s + (l.creditMainMin ?? l.min ?? 0), 0);
      const todayCommuteUsed = todayTimeLogs.filter((l) => COMMUTE_ELIGIBLE_CATS.includes(l.cat)).reduce((s, l) => s + (l.creditCommuteMin ?? 0), 0);
      const remainingMin = Math.max(0, dailyCap - todayMinUsed);
      const commuteRemaining = Math.max(0, commuteCap - todayCommuteUsed);
      const capPct = Math.min(todayMinUsed / dailyCap * 100, 100);
      const commutePct = commuteCap > 0 ? Math.min(todayCommuteUsed / commuteCap * 100, 100) : 0;
      return /* @__PURE__ */ React.createElement("div", { style: { animation: "fadeup .3s ease" } }, /* @__PURE__ */ React.createElement("div", { style: { ...glassCard, padding: "10px 14px", marginBottom: 8 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 6 } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 9, letterSpacing: 2, color: "#78716c" } }, "\u672C\u65E5\u306E\u8A18\u9332\u53EF\u80FD\u6642\u9593"), /* @__PURE__ */ React.createElement("button", { onClick: () => setShowScheduleModal(true), style: {
        border: "none",
        background: "none",
        cursor: "pointer",
        padding: 0,
        fontSize: 10,
        color: CYAN,
        textDecoration: "underline"
      } }, "\u8A2D\u5B9A")), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, fontWeight: 700, color: remainingMin <= 0 ? "#ef4444" : "#57534e" } }, "\u6B8B\u308A", remainingMin, "\u5206 / ", dailyCap, "\u5206")), /* @__PURE__ */ React.createElement("div", { style: { height: 5, background: "#e8e3db", borderRadius: 999, overflow: "hidden" } }, /* @__PURE__ */ React.createElement("div", { style: {
        height: "100%",
        background: capPct >= 100 ? "#ef4444" : capPct >= 80 ? "#f0a850" : "linear-gradient(90deg,#4f6ef7,#7c93ff)",
        width: `${capPct}%`,
        borderRadius: 999,
        transition: "width .4s ease"
      } })), commuteCap > 0 && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", margin: "6px 0 4px" } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 9, letterSpacing: 2, color: "#78716c" } }, "\u901A\u52E4\u67A0\uFF08\u77E5\u529B\u30FB\u7CBE\u795E\uFF09"), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 10, fontWeight: 700, color: "#78716c" } }, "\u6B8B\u308A", commuteRemaining, "\u5206 / ", commuteCap, "\u5206")), /* @__PURE__ */ React.createElement("div", { style: { height: 5, background: "#e8e3db", borderRadius: 999, overflow: "hidden" } }, /* @__PURE__ */ React.createElement("div", { style: {
        height: "100%",
        background: commutePct >= 100 ? "#ef4444" : "linear-gradient(90deg,#a78bfa,#c4b5fd)",
        width: `${commutePct}%`,
        borderRadius: 999,
        transition: "width .4s ease"
      } }))), remainingMin <= 0 && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "#ef4444", marginTop: 5 } }, "\u672C\u65E5\u306E\u4E0A\u9650\u306B\u9054\u3057\u307E\u3057\u305F\u3002\u7121\u7406\u305B\u305A\u4F11\u606F\u3082\u5927\u5207\u306A\u6642\u9593\u3067\u3059\u{1F319}")), (() => {
        const setBuffs = inventory.filter((i) => i.effect?.type === "xp_mult" && i.active && !i.used);
        if (setBuffs.length === 0) return null;
        return /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 } }, setBuffs.map((b) => {
          const hit = b.effect.cat === form.cat;
          const catLabel = CATEGORIES.find((c) => c.id === b.effect.cat)?.label || b.effect.cat;
          return /* @__PURE__ */ React.createElement(
            "div",
            {
              key: b.uid,
              onClick: () => {
                if (!hit) setForm((f) => ({ ...f, cat: b.effect.cat }));
              },
              style: {
                ...glassCard,
                padding: "10px 14px",
                background: hit ? "linear-gradient(135deg,#ecfdf5,#d1fae5)" : PANEL,
                border: hit ? "1px solid #34d399" : `1px solid ${BORDER}`,
                display: "flex",
                alignItems: "center",
                gap: 8,
                cursor: hit ? "default" : "pointer",
                opacity: hit ? 1 : 0.8
              }
            },
            /* @__PURE__ */ React.createElement("span", { style: { fontSize: 18 } }, b.icon),
            /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12, fontWeight: 700, color: hit ? "#047857" : "#78716c" } }, hit ? `${b.label}\u30BB\u30C3\u30C8\u4E2D \u2014 \u3053\u306E\u8A18\u9332\u3067EXP\xD7${b.effect.val}\u500D\uFF01` : `${b.label}\u30BB\u30C3\u30C8\u4E2D\uFF08${catLabel}\u3067\u767A\u52D5\uFF09\u2014 \u30BF\u30C3\u30D7\u3067\u5207\u66FF`)
          );
        }));
      })(), /* @__PURE__ */ React.createElement("div", { style: { ...glassCard, padding: "16px", marginBottom: 12 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, letterSpacing: 4, color: CYAN, marginBottom: 10 } }, "NEW LOG"), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, marginBottom: 8 } }, CATEGORIES.map((c) => {
        const sel = form.cat === c.id;
        return /* @__PURE__ */ React.createElement("button", { key: c.id, onClick: () => setForm((f) => ({ ...f, cat: c.id, activity: "" })), style: {
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 3,
          padding: "8px 4px",
          borderRadius: 12,
          border: "none",
          cursor: "pointer",
          background: sel ? `${c.color}18` : "#faf8f5",
          outline: sel ? `1.5px solid ${c.color}` : "1.5px solid #e8e3db"
        } }, /* @__PURE__ */ React.createElement("span", { style: {
          width: 28,
          height: 28,
          borderRadius: 8,
          background: `${c.color}22`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 14,
          color: c.color
        } }, c.icon), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 10, fontWeight: 700, color: sel ? c.color : "#78716c" } }, c.label));
      })), (() => {
        const skillB = calcXPBonus(selCat.id, unlocked);
        const extB = calcExternalXPBonus(selCat.id, equippedChar);
        const bonus = (1 + skillB) * (1 + extB) - 1;
        const subtext = selCat.mode === "time" ? `\xD7${selCat.xpRate} EXP/min${bonus > 0 ? ` (+${Math.round(bonus * 100)}%)` : ""}` : selCat.mode === "count" ? `${selCat.baseXP} EXP/\u56DE${bonus > 0 ? ` (+${Math.round(bonus * 100)}%)` : ""}` : `\u9805\u76EE\u3054\u3068\u306BEXP\u304C\u5909\u52D5`;
        return /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "#a8a29e", marginBottom: 16, paddingLeft: 2 } }, subtext);
      })(), selCat.mode === "time" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: { marginBottom: 12 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 6, alignItems: "center" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 5, flexWrap: "wrap", flex: 1 } }, [15, 30, 45, 60, 90, 120].map((m) => /* @__PURE__ */ React.createElement("button", { key: m, onClick: () => setForm((f) => ({ ...f, min: m })), style: {
        padding: "6px 10px",
        borderRadius: 8,
        border: "none",
        cursor: "pointer",
        background: form.min === m ? selCat.color + "33" : "#f5f2ee",
        outline: form.min === m ? `1px solid ${selCat.color}` : "1px solid #ddd8d0",
        color: form.min === m ? "#1e1b2e" : "#57534e",
        fontSize: 12,
        fontWeight: 600
      } }, m))), /* @__PURE__ */ React.createElement(
        "input",
        {
          type: "number",
          value: form.min,
          min: 1,
          max: 480,
          onChange: (e) => setForm((f) => ({ ...f, min: Number(e.target.value) })),
          style: {
            width: 64,
            padding: "8px 8px",
            borderRadius: 9,
            textAlign: "center",
            border: "1px solid #ddd8d0",
            background: "#faf8f5",
            color: "#1e1b2e",
            fontSize: 14,
            outline: "none",
            flexShrink: 0
          }
        }
      ))), /* @__PURE__ */ React.createElement("div", { style: { marginBottom: 16 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 6 } }, /* @__PURE__ */ React.createElement(
        "select",
        {
          value: form.activity,
          onChange: (e) => setForm((f) => ({ ...f, activity: e.target.value })),
          style: {
            flex: 1,
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid #ddd8d0",
            background: "#faf8f5",
            color: form.activity ? "#1e1b2e" : "#a8a29e",
            fontSize: 14,
            outline: "none",
            appearance: "none",
            WebkitAppearance: "none"
          }
        },
        /* @__PURE__ */ React.createElement("option", { value: "" }, "\u6D3B\u52D5\u5185\u5BB9\u3092\u9078\u629E\u2026"),
        (activities[form.cat] || []).map((a) => /* @__PURE__ */ React.createElement("option", { key: a, value: a }, a))
      ), /* @__PURE__ */ React.createElement("button", { onClick: () => setShowAddActivity((v) => !v), style: {
        width: 40,
        flexShrink: 0,
        borderRadius: 10,
        border: "1px solid #ddd8d0",
        background: showAddActivity ? selCat.color + "22" : "#faf8f5",
        color: showAddActivity ? selCat.color : "#78716c",
        fontSize: 16,
        cursor: "pointer",
        fontWeight: 700
      } }, "+")), showAddActivity && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8, marginTop: 8 } }, /* @__PURE__ */ React.createElement(
        "input",
        {
          value: newActivity,
          onChange: (e) => setNewActivity(e.target.value),
          onKeyDown: (e) => {
            if (e.key === "Enter") {
              addActivity(form.cat);
              setShowAddActivity(false);
            }
          },
          placeholder: "\u65B0\u3057\u3044\u9805\u76EE\u3092\u8FFD\u52A0\u2026",
          autoFocus: true,
          style: {
            flex: 1,
            padding: "9px 12px",
            borderRadius: 9,
            border: "1px solid #ddd8d0",
            background: "#fff",
            color: "#1e1b2e",
            fontSize: 13,
            outline: "none"
          }
        }
      ), /* @__PURE__ */ React.createElement("button", { onClick: () => {
        addActivity(form.cat);
        setShowAddActivity(false);
      }, style: {
        padding: "9px 16px",
        borderRadius: 9,
        border: "none",
        cursor: "pointer",
        background: selCat.color,
        color: "#fff",
        fontWeight: 700,
        fontSize: 13
      } }, "\u8FFD\u52A0"))), (() => {
        const skillB = calcXPBonus(form.cat, unlocked, Number(form.min));
        const extB = calcExternalXPBonus(form.cat, equippedChar);
        const bonus = (1 + skillB) * (1 + extB) - 1;
        const baseXP = selCat.xpRate * form.min;
        const finalXP = Math.floor(baseXP * (1 + bonus));
        return /* @__PURE__ */ React.createElement("div", { style: {
          background: `${selCat.color}0d`,
          border: `1px solid ${selCat.color}30`,
          borderRadius: 12,
          padding: "9px 16px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 12
        } }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, color: "#57534e", letterSpacing: 2 } }, "BASE EXP"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, color: "#57534e", textDecoration: bonus > 0 ? "line-through" : "none" } }, baseXP)), bonus > 0 && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: selCat.color } }, "+", Math.round(bonus * 100), "% SKILL BONUS"), /* @__PURE__ */ React.createElement("div", { style: { textAlign: "right" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, color: selCat.color, letterSpacing: 2 } }, "GAIN EXP"), /* @__PURE__ */ React.createElement("div", { style: {
          fontSize: 24,
          fontWeight: 900,
          color: selCat.color,
          textShadow: `0 0 12px ${selCat.color}`
        } }, "+", finalXP)));
      })(), /* @__PURE__ */ React.createElement("button", { onClick: addLog, disabled: !form.activity, style: {
        width: "100%",
        padding: "15px",
        borderRadius: 12,
        border: "none",
        cursor: form.activity ? "pointer" : "not-allowed",
        opacity: form.activity ? 1 : 0.5,
        background: `linear-gradient(90deg,${selCat.glow},${selCat.color})`,
        color: "#fff",
        fontWeight: 800,
        fontSize: 14,
        letterSpacing: 3,
        boxShadow: `0 4px 24px ${selCat.color}40`
      } }, "SUBMIT LOG")), selCat.mode === "count" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: { marginBottom: 20 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, letterSpacing: 3, color: "#57534e", marginBottom: 8 } }, "\u3069\u3093\u306A\u4F53\u9A13\u3092\u3057\u305F\uFF1F"), /* @__PURE__ */ React.createElement(
        "input",
        {
          value: form.note,
          onChange: (e) => setForm((f) => ({ ...f, note: e.target.value })),
          placeholder: "\u65B0\u3057\u3044\u30AB\u30D5\u30A7\u306B\u884C\u3063\u305F\u3001\u521D\u5BFE\u9762\u306E\u4EBA\u3068\u8A71\u3057\u305F\u2026",
          style: {
            width: "100%",
            padding: "11px 14px",
            borderRadius: 10,
            border: "1px solid #ddd8d0",
            background: "#faf8f5",
            color: "#1e1b2e",
            fontSize: 14,
            outline: "none"
          }
        }
      )), (() => {
        const skillB = calcXPBonus(form.cat, unlocked);
        const extB = calcExternalXPBonus(form.cat, equippedChar);
        const bonus = (1 + skillB) * (1 + extB) - 1;
        const finalXP = Math.floor(selCat.baseXP * (1 + bonus));
        return /* @__PURE__ */ React.createElement("div", { style: {
          background: `${selCat.color}0d`,
          border: `1px solid ${selCat.color}30`,
          borderRadius: 12,
          padding: "12px 16px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16
        } }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, color: "#57534e", letterSpacing: 2 } }, "BASE EXP"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, color: "#57534e", textDecoration: bonus > 0 ? "line-through" : "none" } }, selCat.baseXP)), bonus > 0 && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: selCat.color } }, "+", Math.round(bonus * 100), "% SKILL BONUS"), /* @__PURE__ */ React.createElement("div", { style: { textAlign: "right" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, color: selCat.color, letterSpacing: 2 } }, "GAIN EXP"), /* @__PURE__ */ React.createElement("div", { style: {
          fontSize: 26,
          fontWeight: 900,
          color: selCat.color,
          textShadow: `0 0 12px ${selCat.color}`
        } }, "+", finalXP)));
      })(), /* @__PURE__ */ React.createElement("button", { onClick: addLog, disabled: !form.note.trim(), style: {
        width: "100%",
        padding: "15px",
        borderRadius: 12,
        border: "none",
        cursor: form.note.trim() ? "pointer" : "not-allowed",
        opacity: form.note.trim() ? 1 : 0.5,
        background: `linear-gradient(90deg,${selCat.glow},${selCat.color})`,
        color: "#fff",
        fontWeight: 800,
        fontSize: 14,
        letterSpacing: 3,
        boxShadow: `0 4px 24px ${selCat.color}40`
      } }, "\u8A18\u9332\u3059\u308B")), selCat.mode === "check" && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, letterSpacing: 3, color: "#57534e", marginBottom: 10 } }, "\u4ECA\u65E5\u306E\u7FD2\u6163\u30C1\u30A7\u30C3\u30AF"), /* @__PURE__ */ React.createElement("div", { style: {
        display: "flex",
        gap: 8,
        alignItems: "flex-start",
        background: "#f5f2ee",
        border: "1px solid #e8e3db",
        borderRadius: 10,
        padding: "10px 12px",
        marginBottom: 12
      } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 13, flexShrink: 0 } }, "\u2139\uFE0F"), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 10, color: "#78716c", lineHeight: 1.6 } }, "\u4F53\u529B\u306EEXP\u306F\u30EC\u30D9\u30EB\u30FB\u30AD\u30E3\u30E9\u80B2\u6210\u306B\u3059\u3050\u53CD\u6620\u3055\u308C\u307E\u3059\u304C\u3001", /* @__PURE__ */ React.createElement("b", null, "\u30B9\u30AD\u30EB\u30DD\u30A4\u30F3\u30C8\u3078\u306E\u53CD\u6620\u306E\u307F\u7FCC\u65E5\u306B\u78BA\u5B9A"), "\u3057\u307E\u3059\uFF08\u5F53\u65E5\u4E2D\u306E\u4ED8\u3051\u5916\u3057\u3067\u30B9\u30AD\u30EB\u30DD\u30A4\u30F3\u30C8\u3092\u5148\u53D6\u308A\u3067\u304D\u306A\u3044\u3088\u3046\u306B\u3059\u308B\u305F\u3081\u3067\u3059\uFF09\u3002")), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 } }, healthItems.map((item) => {
        const checked = todayHealthChecked.includes(item.id);
        const isCustom = !DEFAULT_HEALTH_ITEMS.some((d) => d.id === item.id);
        return /* @__PURE__ */ React.createElement("div", { key: item.id, style: { display: "flex", alignItems: "center", gap: 6 } }, /* @__PURE__ */ React.createElement("button", { onClick: () => toggleHealthItem(item.id), style: {
          flex: 1,
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "12px 14px",
          borderRadius: 12,
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          background: checked ? `${selCat.color}18` : "#faf8f5",
          outline: checked ? `1.5px solid ${selCat.color}` : "1.5px solid #e8e3db",
          transition: "all .15s"
        } }, /* @__PURE__ */ React.createElement("span", { style: {
          width: 28,
          height: 28,
          borderRadius: item.group ? 999 : 8,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 14,
          background: checked ? selCat.color : "#e8e3db",
          color: checked ? "#fff" : "#a8a29e"
        } }, checked ? "\u2713" : item.icon), /* @__PURE__ */ React.createElement("span", { style: {
          flex: 1,
          fontSize: 13,
          fontWeight: 600,
          color: checked ? selCat.color : "#44403c"
        } }, item.label), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: checked ? selCat.color : "#a8a29e", fontWeight: 700 } }, "+", item.xp ?? 12)), isCustom && /* @__PURE__ */ React.createElement("button", { onClick: () => deleteHealthItem(item.id), style: {
          width: 32,
          height: 32,
          flexShrink: 0,
          borderRadius: 10,
          border: "1px solid #e8e3db",
          background: "#faf8f5",
          color: "#a8a29e",
          cursor: "pointer",
          fontSize: 14
        } }, "\u{1F5D1}"));
      })), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, color: "#a8a29e", marginTop: -8, marginBottom: 16, lineHeight: 1.6 } }, "\u25CB\u4E38\u30A2\u30A4\u30B3\u30F3\u306E\u9805\u76EE\u306F\u300C\u305D\u306E\u65E5\u4E00\u756A\u53B3\u3057\u304F\u9054\u6210\u3057\u305F\u30EC\u30D9\u30EB\u300D\u30921\u3064\u3060\u3051\u9078\u3079\u307E\u3059"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 6, marginBottom: 8 } }, Object.entries(HEALTH_DIFFICULTY).map(([key, d]) => /* @__PURE__ */ React.createElement("button", { key, onClick: () => setNewHabitDiff(key), style: {
        flex: 1,
        padding: "7px 4px",
        borderRadius: 9,
        cursor: "pointer",
        border: newHabitDiff === key ? `1.5px solid ${d.color}` : "1.5px solid #e8e3db",
        background: newHabitDiff === key ? `${d.color}18` : "#faf8f5",
        color: newHabitDiff === key ? d.color : "#a8a29e",
        fontSize: 11,
        fontWeight: 700
      } }, d.label, /* @__PURE__ */ React.createElement("br", null), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 9, fontWeight: 600 } }, "+", d.xp)))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8, marginBottom: 8 } }, /* @__PURE__ */ React.createElement(
        "input",
        {
          value: newHabit,
          onChange: (e) => setNewHabit(e.target.value),
          onKeyDown: (e) => {
            if (e.key === "Enter") addHealthItem();
          },
          placeholder: "\u65B0\u3057\u3044\u7FD2\u6163\u3092\u8FFD\u52A0\u2026",
          style: {
            flex: 1,
            padding: "10px 14px",
            borderRadius: 10,
            border: "1px solid #ddd8d0",
            background: "#faf8f5",
            color: "#1e1b2e",
            fontSize: 13,
            outline: "none"
          }
        }
      ), /* @__PURE__ */ React.createElement("button", { onClick: addHealthItem, style: {
        padding: "10px 18px",
        borderRadius: 10,
        border: "none",
        cursor: "pointer",
        background: selCat.color,
        color: "#fff",
        fontWeight: 700,
        fontSize: 13
      } }, "\u8FFD\u52A0")), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "#a8a29e", textAlign: "center" } }, "\u4ECA\u65E5: ", todayHealthChecked.length, " / ", (() => {
        const groups = new Set(healthItems.filter((i) => i.group).map((i) => i.group));
        const ungroupedCount = healthItems.filter((i) => !i.group).length;
        return ungroupedCount + groups.size;
      })(), " \u5B8C\u4E86"))));
    })(), tab === "skills" && /* @__PURE__ */ React.createElement("div", { style: { animation: "fadeup .3s ease" } }, /* @__PURE__ */ React.createElement("div", { style: {
      display: "flex",
      gap: 6,
      padding: "0 0 12px",
      overflowX: "auto"
    } }, CATEGORIES.filter((c) => c.mode !== "check").map((c) => /* @__PURE__ */ React.createElement("button", { key: c.id, onClick: () => setSkillCat(c.id), style: {
      flexShrink: 0,
      padding: "7px 14px",
      borderRadius: 999,
      border: "none",
      cursor: "pointer",
      background: skillCat === c.id ? `${c.color}33` : "#f5f2ee",
      outline: skillCat === c.id ? `1px solid ${c.color}` : "1px solid #ddd8d0",
      color: skillCat === c.id ? c.color : "#57534e",
      fontSize: 12,
      fontWeight: 700,
      letterSpacing: 1
    } }, c.en))), /* @__PURE__ */ React.createElement("div", { style: { ...glassCard, padding: "16px", marginBottom: 12 } }, (() => {
      const cat = CATEGORIES.find((c) => c.id === skillCat);
      const xpB = calcXPBonus(skillCat, unlocked);
      const gemB = calcGemBonus(skillCat, unlocked, equippedChar);
      return /* @__PURE__ */ React.createElement("div", { style: { marginBottom: 16 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 } }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, color: cat.color, letterSpacing: 3, marginBottom: 2 } }, cat.en, " SKILL TREE"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 16, fontWeight: 700 } }, cat.label, "\u30B9\u30AD\u30EB"))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8 } }, /* @__PURE__ */ React.createElement("div", { style: { flex: 1, textAlign: "center", padding: "8px", borderRadius: 10, background: "#eff6ff", border: "1px solid #bfdbfe" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, color: "#1d4ed8", letterSpacing: 1 } }, "EXP BONUS"), /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 800, fontSize: 16, color: "#1d4ed8" } }, "+", Math.round(xpB * 100), "%")), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, textAlign: "center", padding: "8px", borderRadius: 10, background: "#fffbeb", border: "1px solid #fde68a" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, color: GOLD, letterSpacing: 1 } }, "GEM BONUS"), /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 800, fontSize: 16, color: "#92400e" } }, "+", gemB, "\u{1F48E}/\u56DE"))));
    })(), /* @__PURE__ */ React.createElement("div", { style: {
      display: "flex",
      justifyContent: "space-between",
      fontSize: 10,
      color: "#57534e",
      marginBottom: 16,
      padding: "8px 12px",
      background: "#faf8f5",
      borderRadius: 8
    } }, /* @__PURE__ */ React.createElement("span", null, "\u30B9\u30AD\u30EB\u30DD\u30A4\u30F3\u30C8\u6B8B\u308A"), /* @__PURE__ */ React.createElement("span", { style: { color: skillPoints > 0 ? GOLD : "#78716c", fontWeight: 700 } }, skillPoints, " SP")), /* @__PURE__ */ React.createElement(
      SkillTreeView,
      {
        catId: skillCat,
        lv: lvInfo.lv,
        unlocked,
        onUnlock: unlockSkill,
        skillPoints
      }
    )), /* @__PURE__ */ React.createElement("div", { style: { ...glassCard, padding: "14px 16px" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, letterSpacing: 3, color: "#57534e", marginBottom: 10 } }, "\u7FD2\u5F97\u6E08\u307F\u30B9\u30AD\u30EB"), SKILL_TREE[skillCat].filter((n) => unlocked.includes(n.id)).length === 0 && /* @__PURE__ */ React.createElement("div", { style: { color: "#c5bfb8", fontSize: 12, textAlign: "center", padding: "12px 0" } }, "\u306A\u3057"), SKILL_TREE[skillCat].filter((n) => unlocked.includes(n.id)).map((n) => /* @__PURE__ */ React.createElement("div", { key: n.id, style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      padding: "8px 0",
      borderBottom: "1px solid #e8e3db"
    } }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("span", { style: { color: CATEGORIES.find((c) => c.id === skillCat)?.color, fontSize: 12, fontWeight: 700 } }, n.label), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 10, color: "#78716c", marginLeft: 8 } }, n.desc)), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 10, color: "#4ade80", flexShrink: 0 } }, "\u2713")))), (() => {
      const elem = ELEMENT_INFO[skillCat];
      if (!elem) return null;
      const magicCount = calcMagicCount(skillCat, logs);
      const allMagic = MAGIC_GRIMOIRE[skillCat] || [];
      const unlockedCount = allMagic.filter((m) => magicCount >= m.req).length;
      const nextMagic = allMagic.find((m) => magicCount < m.req);
      return /* @__PURE__ */ React.createElement("div", { style: { ...glassCard, padding: "16px", marginTop: 12 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 } }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, color: elem.color, letterSpacing: 3, marginBottom: 2 } }, "MAGIC GRIMOIRE"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 16, fontWeight: 700 } }, elem.name, "\u5C5E\u6027 \u9B54\u6CD5\u56F3\u9451")), /* @__PURE__ */ React.createElement("div", { style: {
        fontSize: 11,
        fontWeight: 700,
        color: elem.dark,
        background: elem.light,
        padding: "4px 10px",
        borderRadius: 999
      } }, unlockedCount, "/", allMagic.length)), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "#78716c", marginBottom: 14 } }, "\u7D2F\u8A08\u8A18\u9332\u56DE\u6570\uFF1A", magicCount, "\u56DE", nextMagic && ` \u2014 \u6B21\u306F\u300C${nextMagic.label}\u300D\u307E\u3067\u3042\u3068${nextMagic.req - magicCount}\u56DE`), /* @__PURE__ */ React.createElement("div", { style: {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(78px, 1fr))",
        gap: 8
      } }, allMagic.map((m) => {
        const isUnlocked = magicCount >= m.req;
        const effInfo = EFFECT_TYPE_INFO[m.type];
        return /* @__PURE__ */ React.createElement(
          "div",
          {
            key: m.id,
            onClick: () => setMagicDetail({ magic: m, elem, isUnlocked }),
            style: {
              aspectRatio: "1",
              borderRadius: 12,
              cursor: "pointer",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              padding: "6px 4px",
              position: "relative",
              background: isUnlocked ? `linear-gradient(160deg, ${elem.light}, ${elem.color}33)` : "#ece8e2",
              border: isUnlocked ? `1.5px solid ${elem.color}88` : "1.5px solid #ddd8d0",
              boxShadow: isUnlocked && m.tier === 3 ? `0 4px 14px ${elem.color}55` : "none"
            }
          },
          /* @__PURE__ */ React.createElement("span", { style: {
            position: "absolute",
            top: 4,
            left: 6,
            fontSize: 8,
            fontWeight: 800,
            color: isUnlocked ? elem.dark : "#a8a29e"
          } }, isUnlocked ? `\xD7${m.req}` : "?"),
          isUnlocked && /* @__PURE__ */ React.createElement("span", { style: {
            position: "absolute",
            top: 3,
            right: 5,
            fontSize: 10
          } }, effInfo.icon),
          /* @__PURE__ */ React.createElement(MagicGlyph, { catId: skillCat, tier: m.tier, color: elem.color, locked: !isUnlocked }),
          /* @__PURE__ */ React.createElement("div", { style: {
            fontSize: 9,
            fontWeight: 700,
            textAlign: "center",
            marginTop: 2,
            color: isUnlocked ? "#1c1917" : "#a8a29e"
          } }, isUnlocked ? m.label : "\u672A\u89E3\u653E")
        );
      })));
    })()), tab === "gacha" && /* @__PURE__ */ React.createElement("div", { style: { animation: "fadeup .3s ease", display: "flex", flexDirection: "column", gap: 12 } }, /* @__PURE__ */ React.createElement("div", { style: {
      ...glassCard,
      padding: "16px 20px",
      background: "linear-gradient(135deg,#fffbeb,#fef3c7)",
      border: "1px solid #f0c060",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between"
    } }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, letterSpacing: 3, color: GOLD, marginBottom: 4 } }, "RUNE STONES"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8 } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 28 } }, "\u{1F48E}"), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 32, fontWeight: 900, color: "#92400e" } }, gems)), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "#78716c", marginTop: 4 } }, "\u8A18\u9332\u3059\u308B\u305F\u3073\u306B\u7372\u5F97\uFF0815\u5206\u21921\u77F3\uFF09")), /* @__PURE__ */ React.createElement("div", { style: { textAlign: "right", fontSize: 10, color: "#78716c" } }, /* @__PURE__ */ React.createElement("div", null, "SSR\u30DC\u30FC\u30CA\u30B9"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 16, fontWeight: 700, color: GOLD } }, "+", Math.round(ssrBonus * 100), "%"))), /* @__PURE__ */ React.createElement("div", { style: {
      ...glassCard,
      padding: "14px 16px",
      background: "linear-gradient(135deg,#fff7e0,#ffe9a8)",
      border: "1px solid #f0c06066",
      display: "flex",
      alignItems: "center",
      gap: 12
    } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 24 } }, "\u{1F3B4}"), /* @__PURE__ */ React.createElement("div", { style: { flex: 1 } }, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 800, fontSize: 12, color: "#92400e" } }, "\u30AD\u30E3\u30E9\u30AF\u30BF\u30FC\u3082\u51FA\u73FE\u4E2D"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "#78716c", marginTop: 2, lineHeight: 1.5 } }, "\u4E0B\u306E2\u7A2E\u3069\u3061\u3089\u306E\u30AC\u30C1\u30E3\u304B\u3089\u3082", Math.round(CHARACTER_DROP_RATE * 100), "%\u306E\u78BA\u7387\u3067\u4EF2\u9593\u304C\u51FA\u73FE\uFF08\u672A\u6240\u6301\u30AD\u30E3\u30E9\u306E\u307F\u5BFE\u8C61\uFF09")), /* @__PURE__ */ React.createElement("div", { style: { textAlign: "right", fontSize: 11, color: "#92400e", fontWeight: 800, whiteSpace: "nowrap" } }, ownedChars.length, "/", GACHA_CHARACTERS.length)), Object.entries(GACHA_POOLS).map(([poolId, pool]) => /* @__PURE__ */ React.createElement("div", { key: poolId, style: { ...glassCard, padding: "18px" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10, marginBottom: 12 } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 28 } }, pool.icon), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 800, fontSize: 15 } }, pool.name), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "#78716c" } }, pool.desc)), /* @__PURE__ */ React.createElement("div", { style: { marginLeft: "auto", textAlign: "right" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, color: GOLD, letterSpacing: 2 } }, "COST"), /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 800, fontSize: 16, color: "#92400e" } }, "\u{1F48E}", pool.cost))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 } }, pool.items.map((item) => /* @__PURE__ */ React.createElement("div", { key: item.id, style: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "8px 10px",
      borderRadius: 10,
      background: item.rarity === "SSR" ? "#fffbeb" : item.rarity === "SR" ? "#f5f3ff" : "#f8faff",
      border: `1px solid ${item.color}44`
    } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 18 } }, item.icon), /* @__PURE__ */ React.createElement("div", { style: { flex: 1 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 6 } }, /* @__PURE__ */ React.createElement("span", { style: {
      fontSize: 9,
      fontWeight: 700,
      letterSpacing: 1,
      color: item.rarity === "SSR" ? "#92400e" : item.rarity === "SR" ? "#5b21b6" : "#1e40af",
      background: item.rarity === "SSR" ? "#fde68a" : item.rarity === "SR" ? "#ede9fe" : "#dbeafe",
      padding: "1px 6px",
      borderRadius: 4
    } }, item.rarity), /* @__PURE__ */ React.createElement("span", { style: { fontWeight: 600, fontSize: 12 } }, item.label)), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "#78716c", marginTop: 2 } }, item.desc)), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "#94a3b8", fontWeight: 600 } }, Math.round(item.prob * 100), "%")))), /* @__PURE__ */ React.createElement("button", { onClick: () => doGacha(poolId), disabled: gems < pool.cost || gachaAnim, style: {
      width: "100%",
      padding: "13px",
      borderRadius: 12,
      border: "none",
      cursor: gems >= pool.cost && !gachaAnim ? "pointer" : "not-allowed",
      opacity: gems >= pool.cost ? 1 : 0.5,
      background: gems >= pool.cost ? "linear-gradient(90deg,#f59e0b,#f0c060)" : "#e2ddd6",
      color: gems >= pool.cost ? "#1c1917" : "#78716c",
      fontWeight: 800,
      fontSize: 14,
      letterSpacing: 2,
      boxShadow: gems >= pool.cost ? "0 4px 16px #f0c06044" : "none",
      transition: "all .2s"
    } }, gachaAnim ? "\u2728 \u7948\u9858\u4E2D\u2026" : `\u{1F48E}${pool.cost} \u3067\u5F15\u304F`))), inventory.length > 0 && /* @__PURE__ */ React.createElement("div", { style: { ...glassCard, padding: "16px" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, letterSpacing: 3, color: CYAN, marginBottom: 12 } }, "INVENTORY"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 8 } }, inventory.slice().sort((a, b) => a.used === b.used ? 0 : a.used ? 1 : -1).map((item) => /* @__PURE__ */ React.createElement("div", { key: item.uid, style: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "10px 12px",
      borderRadius: 10,
      background: item.used ? "#f5f5f4" : item.active ? "#ecfdf5" : item.rarity === "SSR" ? "#fffbeb" : item.rarity === "SR" ? "#f5f3ff" : "#f8faff",
      border: `1px solid ${item.used ? "#e2ddd6" : item.active ? "#34d399" : item.color + "44"}`,
      opacity: item.used ? 0.5 : 1
    } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 20 } }, item.icon), /* @__PURE__ */ React.createElement("div", { style: { flex: 1 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement("span", { style: {
      fontSize: 9,
      fontWeight: 700,
      color: item.rarity === "SSR" ? "#92400e" : item.rarity === "SR" ? "#5b21b6" : "#1e40af",
      background: item.rarity === "SSR" ? "#fde68a" : item.rarity === "SR" ? "#ede9fe" : "#dbeafe",
      padding: "1px 6px",
      borderRadius: 4
    } }, item.rarity), /* @__PURE__ */ React.createElement("span", { style: { fontWeight: 700, fontSize: 12 } }, item.label), item.active && /* @__PURE__ */ React.createElement("span", { style: { fontSize: 9, fontWeight: 700, color: "#047857", background: "#a7f3d0", padding: "1px 6px", borderRadius: 4 } }, "\u30BB\u30C3\u30C8\u4E2D")), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "#78716c", marginTop: 1 } }, item.desc)), !item.used && !item.active && /* @__PURE__ */ React.createElement("button", { onClick: () => useItem(item.uid), style: {
      padding: "6px 12px",
      borderRadius: 8,
      border: "none",
      cursor: "pointer",
      background: CYAN,
      color: "#fff",
      fontSize: 11,
      fontWeight: 700,
      flexShrink: 0
    } }, item.effect?.type === "xp_mult" ? "\u30BB\u30C3\u30C8" : "\u4F7F\u7528"), item.active && /* @__PURE__ */ React.createElement("span", { style: { fontSize: 10, color: "#059669", fontWeight: 700, flexShrink: 0 } }, "\u5F85\u6A5F\u4E2D"), item.used && /* @__PURE__ */ React.createElement("span", { style: { fontSize: 10, color: "#a8a29e", flexShrink: 0 } }, "\u4F7F\u7528\u6E08")))))), tab === "stats" && /* @__PURE__ */ React.createElement("div", { style: { animation: "fadeup .3s ease", display: "flex", flexDirection: "column", gap: 12 } }, /* @__PURE__ */ React.createElement("div", { style: { ...glassCard, padding: "16px" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, letterSpacing: 3, color: CYAN, marginBottom: 4 } }, "ALL-TIME TOTAL"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, fontWeight: 700, marginBottom: 16 } }, "\u5168\u671F\u9593\u306E\u7D2F\u8A08\u8A18\u9332\u6642\u9593"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 18 } }, /* @__PURE__ */ React.createElement("div", { style: { position: "relative", flexShrink: 0, width: 120, height: 120 } }, /* @__PURE__ */ React.createElement("svg", { viewBox: "0 0 120 120", width: "120", height: "120" }, allTimeTotal > 0 ? donutSegments.filter((s) => s.val > 0).map((s) => /* @__PURE__ */ React.createElement(
      "path",
      {
        key: s.id,
        d: donutArcPath(60, 60, 56, 38, s.startAngle, s.endAngle),
        fill: s.color,
        opacity: 0.92
      }
    )) : /* @__PURE__ */ React.createElement("circle", { cx: "60", cy: "60", r: "47", fill: "none", stroke: "#f0ede8", strokeWidth: "18" })), /* @__PURE__ */ React.createElement("div", { style: {
      position: "absolute",
      inset: 0,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center"
    } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 20, fontWeight: 900, color: "#1c1917", lineHeight: 1 } }, allTimeTotal >= 60 ? Math.round(allTimeTotal / 60 * 10) / 10 : allTimeTotal), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 8, color: "#78716c", letterSpacing: 1 } }, allTimeTotal >= 60 ? "\u6642\u9593" : "\u5206"))), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, display: "flex", flexDirection: "column", gap: 8 } }, donutSegments.filter((s) => s.val > 0).sort((a, b) => b.val - a.val).map((s) => /* @__PURE__ */ React.createElement("div", { key: s.id, style: { display: "flex", alignItems: "center", gap: 8 } }, /* @__PURE__ */ React.createElement("span", { style: { width: 9, height: 9, borderRadius: 3, background: s.color, flexShrink: 0 } }), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "#44403c", flex: 1 } }, s.label), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, fontWeight: 700, color: s.color } }, Math.round(s.pct * 100), "%"), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 9, color: "#a8a29e", width: 48, textAlign: "right" } }, s.val >= 60 ? `${Math.round(s.val / 60 * 10) / 10}h` : `${s.val}min`))), allTimeTotal === 0 && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "#a8a29e" } }, "\u8A18\u9332\u3059\u308B\u3068\u3053\u3053\u306B\u8868\u793A\u3055\u308C\u307E\u3059")))), /* @__PURE__ */ React.createElement("div", { style: { ...glassCard, padding: "16px" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, letterSpacing: 3, color: CYAN, marginBottom: 4 } }, "RECENT ACTIVITY"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, fontWeight: 700, marginBottom: 14 } }, "\u76F4\u8FD114\u65E5\u9593\u306E\u8A18\u9332\u6642\u9593"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "flex-end", gap: 4, height: 140, marginBottom: 8 } }, dailyHistory.map((d, i) => {
      const dateObj = /* @__PURE__ */ new Date(d.date + "T00:00:00");
      const isToday = d.date === today;
      const barH = Math.max(d.total / maxDayTotal * 120, d.total > 0 ? 4 : 0);
      return /* @__PURE__ */ React.createElement("div", { key: d.date, style: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", height: "100%", justifyContent: "flex-end" } }, /* @__PURE__ */ React.createElement("div", { style: {
        width: "100%",
        maxWidth: 18,
        height: barH,
        borderRadius: "4px 4px 2px 2px",
        display: "flex",
        flexDirection: "column-reverse",
        overflow: "hidden",
        outline: isToday ? `1.5px solid ${CYAN}` : "none",
        outlineOffset: 2
      } }, timeCats.map((c) => {
        const v = d.byCat[c.id];
        if (!v) return null;
        const segH = d.total > 0 ? v / d.total * barH : 0;
        return /* @__PURE__ */ React.createElement("div", { key: c.id, style: { width: "100%", height: segH, background: c.color } });
      }), d.total === 0 && /* @__PURE__ */ React.createElement("div", { style: { width: "100%", height: 3, background: "#e8e3db" } })));
    })), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 4 } }, dailyHistory.map((d) => {
      const dateObj = /* @__PURE__ */ new Date(d.date + "T00:00:00");
      const isToday = d.date === today;
      return /* @__PURE__ */ React.createElement("div", { key: d.date, style: { flex: 1, textAlign: "center" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 8, color: isToday ? CYAN : "#a8a29e", fontWeight: isToday ? 800 : 500 } }, dateObj.getDate()));
    })), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: "6px 12px", marginTop: 14, paddingTop: 12, borderTop: "1px solid #f0ede8" } }, timeCats.map((c) => /* @__PURE__ */ React.createElement("div", { key: c.id, style: { display: "flex", alignItems: "center", gap: 4 } }, /* @__PURE__ */ React.createElement("span", { style: { width: 8, height: 8, borderRadius: 2, background: c.color, display: "inline-block" } }), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 10, color: "#57534e" } }, c.label))))), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, letterSpacing: 3, color: CYAN, marginTop: 4, marginLeft: 4 } }, "TOTAL BY CATEGORY"), catStats.map((c) => {
      const isCount = c.mode === "count";
      const barPct = isCount ? c.count / maxCount * 100 : c.total / maxMin * 100;
      return /* @__PURE__ */ React.createElement("div", { key: c.id, style: { ...glassCard, padding: "14px 16px" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8 } }, /* @__PURE__ */ React.createElement("span", { style: {
        width: 32,
        height: 32,
        borderRadius: 8,
        flexShrink: 0,
        background: `${c.color}18`,
        border: `1px solid ${c.color}30`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 16,
        color: c.color
      } }, c.icon), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 700, fontSize: 13 } }, c.label), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, color: "#57534e", letterSpacing: 2 } }, c.en))), /* @__PURE__ */ React.createElement("div", { style: { textAlign: "right" } }, isCount ? /* @__PURE__ */ React.createElement("div", { style: { fontSize: 16, fontWeight: 800, color: c.color } }, c.count, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 9, color: "#57534e" } }, "\u56DE")) : /* @__PURE__ */ React.createElement("div", { style: { fontSize: 16, fontWeight: 800, color: c.color } }, c.total, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 9, color: "#57534e" } }, "min")), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "#78716c" } }, isCount ? `${c.xp}EXP` : `${c.count}\u56DE \xB7 ${c.xp}EXP`))), /* @__PURE__ */ React.createElement("div", { style: { height: 4, background: "#f5f2ee", borderRadius: 999, overflow: "hidden" } }, /* @__PURE__ */ React.createElement("div", { style: {
        height: "100%",
        borderRadius: 999,
        width: `${barPct}%`,
        background: `linear-gradient(90deg,${c.glow},${c.color})`,
        boxShadow: `0 0 8px ${c.color}88`,
        transition: "width .8s cubic-bezier(.4,0,.2,1)"
      } })), calcXPBonus(c.id, unlocked) > 0 && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, color: c.color, marginTop: 6, letterSpacing: 1 } }, "\u30B9\u30AD\u30EB\u30DC\u30FC\u30CA\u30B9 +", Math.round(calcXPBonus(c.id, unlocked) * 100), "% \u9069\u7528\u4E2D"));
    }), /* @__PURE__ */ React.createElement("div", { style: { ...glassCard, padding: "14px 16px" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8 } }, /* @__PURE__ */ React.createElement("span", { style: {
      width: 32,
      height: 32,
      borderRadius: 8,
      flexShrink: 0,
      background: `${healthCat.color}18`,
      border: `1px solid ${healthCat.color}30`,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: 16,
      color: healthCat.color
    } }, healthCat.icon), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 700, fontSize: 13 } }, healthCat.label), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, color: "#57534e", letterSpacing: 2 } }, healthCat.en))), /* @__PURE__ */ React.createElement("div", { style: { textAlign: "right" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 16, fontWeight: 800, color: healthCat.color } }, Object.values(healthChecks).reduce((s, a) => s + (a?.length || 0), 0), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 9, color: "#57534e" } }, "\u56DE")), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "#78716c" } }, healthXP, "EXP"))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 6, marginTop: 4 } }, healthItems.map((item) => {
      const doneDays = Object.values(healthChecks).filter((arr) => arr?.includes(item.id)).length;
      const totalDays = Object.keys(healthChecks).length || 1;
      const rate = Math.round(doneDays / totalDays * 100);
      return /* @__PURE__ */ React.createElement("div", { key: item.id, style: { display: "flex", alignItems: "center", gap: 8 } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "#44403c", flex: 1 } }, item.icon, " ", item.label), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 10, color: healthCat.color, fontWeight: 700 } }, doneDays, "\u65E5"));
    }))), /* @__PURE__ */ React.createElement("div", { style: { ...glassCard, padding: "16px" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, letterSpacing: 3, color: CYAN, marginBottom: 4 } }, "SYNC"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, fontWeight: 700, marginBottom: 4 } }, "\u30C7\u30D0\u30A4\u30B9\u9593\u540C\u671F"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "#78716c", marginBottom: 16 } }, "\u540C\u671F\u30B3\u30FC\u30C9\u3067\u5225\u306E\u30B9\u30DE\u30DB\u30FBPC\u3068\u30C7\u30FC\u30BF\u3092\u5171\u6709\u3067\u304D\u307E\u3059\u3002"), syncCode ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: {
      padding: "14px 16px",
      borderRadius: 12,
      marginBottom: 10,
      background: "linear-gradient(135deg,#eff6ff,#dbeafe)",
      border: "1px solid #60a5fa66"
    } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, color: "#1d4ed8", letterSpacing: 2, marginBottom: 4 } }, "\u540C\u671F\u30B3\u30FC\u30C9"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 20, fontWeight: 900, color: "#1e3a8a", letterSpacing: 1, fontFamily: "monospace" } }, syncCode), /* @__PURE__ */ React.createElement("button", { onClick: () => {
      navigator.clipboard?.writeText(syncCode);
      showToast("\u30B3\u30FC\u30C9\u3092\u30B3\u30D4\u30FC\u3057\u307E\u3057\u305F", "#60a5fa");
    }, style: {
      padding: "6px 12px",
      borderRadius: 8,
      border: "none",
      cursor: "pointer",
      background: "#3b82f6",
      color: "#fff",
      fontSize: 11,
      fontWeight: 700,
      flexShrink: 0
    } }, "\u30B3\u30D4\u30FC")), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "#1d4ed8", marginTop: 8, display: "flex", alignItems: "center", gap: 6 } }, syncStatus === "syncing" && /* @__PURE__ */ React.createElement(React.Fragment, null, "\u{1F504} \u540C\u671F\u4E2D..."), syncStatus === "synced" && /* @__PURE__ */ React.createElement(React.Fragment, null, "\u2713 \u540C\u671F\u6E08\u307F", syncLastAt && ` (${new Date(syncLastAt).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })})`), syncStatus === "error" && /* @__PURE__ */ React.createElement("span", { style: { color: "#dc2626" } }, "\u26A0 \u540C\u671F\u30A8\u30E9\u30FC\uFF08\u901A\u4FE1\u3092\u78BA\u8A8D\u3057\u3066\u304F\u3060\u3055\u3044\uFF09"), syncStatus === "idle" && /* @__PURE__ */ React.createElement(React.Fragment, null, "\u5F85\u6A5F\u4E2D"))), /* @__PURE__ */ React.createElement("button", { onClick: doSyncPush, disabled: syncBusy, style: {
      width: "100%",
      padding: "10px",
      borderRadius: 10,
      border: "1px solid #d6d3d1",
      cursor: "pointer",
      background: "#fff",
      color: "#57534e",
      fontWeight: 700,
      fontSize: 12,
      marginBottom: 8
    } }, "\u4ECA\u3059\u3050\u540C\u671F"), /* @__PURE__ */ React.createElement("button", { onClick: handleUnlinkSync, style: {
      width: "100%",
      padding: "9px",
      borderRadius: 10,
      border: "none",
      cursor: "pointer",
      background: "none",
      color: "#a8a29e",
      fontWeight: 600,
      fontSize: 11
    } }, "\u540C\u671F\u3092\u89E3\u9664")) : /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("button", { onClick: handleIssueSyncCode, disabled: syncBusy, style: {
      width: "100%",
      padding: "13px 16px",
      borderRadius: 12,
      border: "none",
      cursor: "pointer",
      background: "linear-gradient(135deg,#eff6ff,#dbeafe)",
      border: "1px solid #60a5fa66",
      display: "flex",
      alignItems: "center",
      gap: 12,
      textAlign: "left",
      marginBottom: 14,
      opacity: syncBusy ? 0.6 : 1
    } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 24 } }, "\u{1F517}"), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 700, fontSize: 13, color: "#1e3a8a" } }, syncBusy ? "\u767A\u884C\u4E2D..." : "\u540C\u671F\u30B3\u30FC\u30C9\u3092\u767A\u884C"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "#1d4ed8", marginTop: 2 } }, "\u3053\u306E\u30C7\u30D0\u30A4\u30B9\u306E\u30C7\u30FC\u30BF\u3092\u30AF\u30E9\u30A6\u30C9\u306B\u4FDD\u5B58\u3057\u307E\u3059"))), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "#a8a29e", marginBottom: 8 } }, "\u307E\u305F\u306F\u3001\u5225\u306E\u30C7\u30D0\u30A4\u30B9\u3067\u767A\u884C\u3057\u305F\u30B3\u30FC\u30C9\u3092\u5165\u529B\uFF1A"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8 } }, /* @__PURE__ */ React.createElement(
      "input",
      {
        value: syncInput,
        onChange: (e) => setSyncInput(e.target.value),
        placeholder: "a3f9-2k1p",
        style: {
          flex: 1,
          padding: "10px 12px",
          borderRadius: 10,
          border: "1px solid #d6d3d1",
          fontSize: 13,
          fontFamily: "monospace",
          background: "#faf8f5"
        }
      }
    ), /* @__PURE__ */ React.createElement("button", { onClick: handlePullSyncCode, disabled: syncBusy || !syncInput.trim(), style: {
      padding: "10px 16px",
      borderRadius: 10,
      border: "none",
      cursor: "pointer",
      background: syncInput.trim() ? "#3b82f6" : "#d6d3d1",
      color: "#fff",
      fontWeight: 700,
      fontSize: 12,
      flexShrink: 0
    } }, "\u8AAD\u8FBC")), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "#a8a29e", marginTop: 10, lineHeight: 1.6 } }, "\u203B \u30B3\u30FC\u30C9\u3092\u5165\u529B\u3059\u308B\u3068\u3001\u3053\u306E\u30C7\u30D0\u30A4\u30B9\u306E\u30C7\u30FC\u30BF\u306F\u4E0A\u66F8\u304D\u3055\u308C\u307E\u3059\u3002"))), /* @__PURE__ */ React.createElement("div", { style: { ...glassCard, padding: "16px" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, letterSpacing: 3, color: CYAN, marginBottom: 4 } }, "EXPORT"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, fontWeight: 700, marginBottom: 4 } }, "\u30C7\u30FC\u30BF\u306E\u30A8\u30AF\u30B9\u30DD\u30FC\u30C8"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "#78716c", marginBottom: 16 } }, "\u8A18\u9332\u30C7\u30FC\u30BF\u3092\u30D5\u30A1\u30A4\u30EB\u3068\u3057\u3066\u66F8\u304D\u51FA\u3057\u307E\u3059\u3002"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 10 } }, /* @__PURE__ */ React.createElement("button", { onClick: exportCSV, style: {
      padding: "13px 16px",
      borderRadius: 12,
      border: "none",
      cursor: "pointer",
      background: "linear-gradient(135deg,#ecfdf5,#d1fae5)",
      border: "1px solid #34d39966",
      display: "flex",
      alignItems: "center",
      gap: 12,
      textAlign: "left"
    } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 24 } }, "\u{1F4CA}"), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 700, fontSize: 13, color: "#14532d" } }, "CSV\u3067\u30A8\u30AF\u30B9\u30DD\u30FC\u30C8"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "#166534", marginTop: 2 } }, "Excel\u30FBGoogle\u30B9\u30D7\u30EC\u30C3\u30C9\u30B7\u30FC\u30C8\u3067\u958B\u3051\u307E\u3059"))), /* @__PURE__ */ React.createElement("button", { onClick: exportJSON, style: {
      padding: "13px 16px",
      borderRadius: 12,
      border: "none",
      cursor: "pointer",
      background: "linear-gradient(135deg,#eff6ff,#dbeafe)",
      border: "1px solid #60a5fa66",
      display: "flex",
      alignItems: "center",
      gap: 12,
      textAlign: "left"
    } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 24 } }, "\u{1F4BE}"), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 700, fontSize: 13, color: "#1e3a8a" } }, "JSON\u3067\u30D0\u30C3\u30AF\u30A2\u30C3\u30D7"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "#1d4ed8", marginTop: 2 } }, "\u30EB\u30FC\u30F3\u77F3\u30FB\u30A4\u30F3\u30D9\u30F3\u30C8\u30EA\u30FB\u30B9\u30AD\u30EB\u3082\u542B\u3080\u5B8C\u5168\u30D0\u30C3\u30AF\u30A2\u30C3\u30D7")))), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "#a8a29e", marginTop: 12, lineHeight: 1.6 } }, "\u203B CSV\u306F\u30ED\u30B0\u8A18\u9332\u306E\u307F\u3002JSON\u306F\u5168\u30C7\u30FC\u30BF\u3092\u542B\u307F\u307E\u3059\u3002")))), /* @__PURE__ */ React.createElement("div", { style: {
      position: "fixed",
      bottom: 0,
      left: "50%",
      transform: "translateX(-50%)",
      width: "100%",
      maxWidth: 430,
      zIndex: 50,
      background: `rgba(240,237,232,0.97)`,
      borderTop: `1px solid ${BORDER}`,
      backdropFilter: "blur(20px)",
      display: "grid",
      gridTemplateColumns: `repeat(${TABS.length},1fr)`,
      padding: "10px 0 20px"
    } }, TABS.map((t) => /* @__PURE__ */ React.createElement("button", { key: t.id, onClick: () => setTab(t.id), style: {
      background: "none",
      border: "none",
      cursor: "pointer",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 3,
      padding: "4px 0"
    } }, /* @__PURE__ */ React.createElement("span", { style: {
      fontSize: 18,
      color: tab === t.id ? CYAN : "#9c9087",
      textShadow: tab === t.id ? `0 0 10px ${CYAN}44` : "none",
      transition: "all .2s"
    } }, t.icon), /* @__PURE__ */ React.createElement("span", { style: {
      fontSize: 8,
      letterSpacing: 2,
      fontWeight: 700,
      color: tab === t.id ? CYAN : "#9c9087"
    } }, t.label), tab === t.id && /* @__PURE__ */ React.createElement("div", { style: {
      width: 16,
      height: 1.5,
      borderRadius: 999,
      background: `linear-gradient(90deg,transparent,${CYAN},transparent)`
    } })))), showScheduleModal && (() => {
      const previewCap = calcDailyCapMinutes(schedule);
      return /* @__PURE__ */ React.createElement("div", { onClick: () => setShowScheduleModal(false), style: {
        position: "fixed",
        inset: 0,
        background: "rgba(30,20,10,0.6)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 200,
        padding: 20
      } }, /* @__PURE__ */ React.createElement("div", { onClick: (e) => e.stopPropagation(), style: {
        background: "#fff",
        borderRadius: 20,
        padding: "24px 22px",
        width: 340,
        maxWidth: "100%",
        animation: "resultPop .35s cubic-bezier(.34,1.56,.64,1)"
      } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, letterSpacing: 3, color: CYAN, marginBottom: 4 } }, "SCHEDULE"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 15, fontWeight: 800, marginBottom: 4 } }, "\u751F\u6D3B\u30B9\u30B1\u30B8\u30E5\u30FC\u30EB\u8A2D\u5B9A"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "#78716c", marginBottom: 18, lineHeight: 1.6 } }, "\u8D77\u5E8A\u30FB\u5C31\u5BDD\u30FB\u52E4\u52D9/\u901A\u5B66\u6642\u9593\u304B\u3089\u30011\u65E5\u306B\u8A18\u9332\u3067\u304D\u308B\u6642\u9593\u306E\u4E0A\u9650\u3092\u7B97\u51FA\u3057\u307E\u3059\u3002"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 12, marginBottom: 16 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 10 } }, /* @__PURE__ */ React.createElement("label", { style: { flex: 1 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "#78716c", marginBottom: 4 } }, "\u8D77\u5E8A\u6642\u523B"), /* @__PURE__ */ React.createElement(
        "input",
        {
          type: "time",
          value: schedule.wake,
          onChange: (e) => setSchedule((s) => ({ ...s, wake: e.target.value })),
          style: { width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #d6d3d1", fontSize: 13 }
        }
      )), /* @__PURE__ */ React.createElement("label", { style: { flex: 1 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "#78716c", marginBottom: 4 } }, "\u5C31\u5BDD\u6642\u523B"), /* @__PURE__ */ React.createElement(
        "input",
        {
          type: "time",
          value: schedule.sleep,
          onChange: (e) => setSchedule((s) => ({ ...s, sleep: e.target.value })),
          style: { width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #d6d3d1", fontSize: 13 }
        }
      ))), /* @__PURE__ */ React.createElement("label", { style: { display: "flex", alignItems: "center", gap: 8, cursor: "pointer" } }, /* @__PURE__ */ React.createElement(
        "input",
        {
          type: "checkbox",
          checked: schedule.hasWork,
          onChange: (e) => setSchedule((s) => ({ ...s, hasWork: e.target.checked }))
        }
      ), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12, color: "#44403c" } }, "\u4ED5\u4E8B\u30FB\u5B66\u6821\u304C\u3042\u308B")), schedule.hasWork && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 10 } }, /* @__PURE__ */ React.createElement("label", { style: { flex: 1 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "#78716c", marginBottom: 4 } }, "\u958B\u59CB\u6642\u523B"), /* @__PURE__ */ React.createElement(
        "input",
        {
          type: "time",
          value: schedule.workStart,
          onChange: (e) => setSchedule((s) => ({ ...s, workStart: e.target.value })),
          style: { width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #d6d3d1", fontSize: 13 }
        }
      )), /* @__PURE__ */ React.createElement("label", { style: { flex: 1 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "#78716c", marginBottom: 4 } }, "\u7D42\u4E86\u6642\u523B"), /* @__PURE__ */ React.createElement(
        "input",
        {
          type: "time",
          value: schedule.workEnd,
          onChange: (e) => setSchedule((s) => ({ ...s, workEnd: e.target.value })),
          style: { width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #d6d3d1", fontSize: 13 }
        }
      ))), /* @__PURE__ */ React.createElement("div", { style: { height: 1, background: "#f0ede8", margin: "4px 0" } }), /* @__PURE__ */ React.createElement("label", { style: { display: "flex", alignItems: "center", gap: 8, cursor: "pointer" } }, /* @__PURE__ */ React.createElement(
        "input",
        {
          type: "checkbox",
          checked: schedule.hasCommute,
          onChange: (e) => setSchedule((s) => ({ ...s, hasCommute: e.target.checked }))
        }
      ), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12, color: "#44403c" } }, "\u901A\u52E4\u30FB\u901A\u5B66\u304C\u3042\u308B")), schedule.hasCommute && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8 } }, [
        { id: "transit", label: "\u96FB\u8ECA\u30FB\u30D0\u30B9" },
        { id: "car", label: "\u8ECA\u30FB\u81EA\u8EE2\u8ECA\u7B49" }
      ].map((m) => /* @__PURE__ */ React.createElement(
        "button",
        {
          key: m.id,
          type: "button",
          onClick: () => setSchedule((s) => ({ ...s, commuteMode: m.id })),
          style: {
            flex: 1,
            padding: "7px 4px",
            borderRadius: 8,
            cursor: "pointer",
            border: schedule.commuteMode === m.id ? "1.5px solid #a78bfa" : "1.5px solid #e8e3db",
            background: schedule.commuteMode === m.id ? "#f5f3ff" : "#faf8f5",
            color: schedule.commuteMode === m.id ? "#6d28d9" : "#a8a29e",
            fontSize: 11,
            fontWeight: 700
          }
        },
        m.label
      ))), /* @__PURE__ */ React.createElement("label", null, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "#78716c", marginBottom: 4 } }, "\u7247\u9053\u306E\u6240\u8981\u6642\u9593\uFF08\u5206\uFF09"), /* @__PURE__ */ React.createElement(
        "input",
        {
          type: "number",
          min: "0",
          value: schedule.commuteOneWayMin,
          onChange: (e) => setSchedule((s) => ({ ...s, commuteOneWayMin: e.target.value })),
          style: { width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #d6d3d1", fontSize: 13 }
        }
      )), schedule.commuteMode === "car" && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "#a8a29e", lineHeight: 1.5 } }, "\u8ECA\u30FB\u81EA\u8EE2\u8ECA\u7B49\u306F\u5B89\u5168\u306E\u305F\u3081\u3001\u901A\u52E4\u4E2D\u306E\u8A18\u9332\u67A0\u306F\u4ED8\u4E0E\u3055\u308C\u307E\u305B\u3093\u3002"))), /* @__PURE__ */ React.createElement("div", { style: {
        padding: "12px 14px",
        borderRadius: 12,
        marginBottom: 10,
        background: "#eff6ff",
        border: "1px solid #bfdbfe"
      } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "#1d4ed8", marginBottom: 2 } }, "\u7B97\u51FA\u3055\u308C\u305F1\u65E5\u306E\u8A18\u9332\u4E0A\u9650"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 22, fontWeight: 800, color: "#1e3a8a" } }, previewCap, "\u5206"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, color: "#3b82f6", marginTop: 2 } }, "\u203B\u98DF\u4E8B\u30FB\u8EAB\u652F\u5EA6\u7B49\u3068\u3057\u3066", LIFE_BUFFER_MIN, "\u5206\u3092\u81EA\u52D5\u3067\u78BA\u4FDD\u3057\u3066\u3044\u307E\u3059")), calcCommuteBonusMinutes(schedule) > 0 && /* @__PURE__ */ React.createElement("div", { style: {
        padding: "12px 14px",
        borderRadius: 12,
        marginBottom: 16,
        background: "#f5f3ff",
        border: "1px solid #ddd6fe"
      } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "#6d28d9", marginBottom: 2 } }, "\u901A\u52E4\u4E2D\u306E\u5B66\u7FD2\u67A0\uFF08\u5225\u67A0\u30FB\u77E5\u529B/\u7CBE\u795E\u306E\u307F\uFF09"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 22, fontWeight: 800, color: "#5b21b6" } }, calcCommuteBonusMinutes(schedule), "\u5206")), /* @__PURE__ */ React.createElement("button", { onClick: () => setShowScheduleModal(false), style: {
        width: "100%",
        padding: "12px",
        borderRadius: 12,
        border: "none",
        cursor: "pointer",
        background: CYAN,
        color: "#fff",
        fontWeight: 800,
        fontSize: 13
      } }, "\u4FDD\u5B58\u3057\u3066\u9589\u3058\u308B")));
    })(), charDetail && (() => {
      const { char, owned } = charDetail;
      const isEquipped = equippedChar === char.id;
      return /* @__PURE__ */ React.createElement("div", { onClick: () => setCharDetail(null), style: {
        position: "fixed",
        inset: 0,
        background: "rgba(30,20,10,0.78)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 200,
        padding: 20
      } }, /* @__PURE__ */ React.createElement("div", { onClick: (e) => e.stopPropagation(), style: {
        background: "#fff",
        borderRadius: 22,
        padding: "28px 24px",
        width: 320,
        maxWidth: "100%",
        animation: "resultPop .4s cubic-bezier(.34,1.56,.64,1)",
        border: "1.5px solid #fbbf2455"
      } }, owned ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "center", marginBottom: 14 } }, /* @__PURE__ */ React.createElement("img", { src: getCharacterStageImage(char, calcCharLevel(charXP[char.id] || 0).lv), alt: char.name, style: {
        width: 140,
        height: 140,
        objectFit: "contain",
        filter: "drop-shadow(0 4px 16px #fbbf2455)"
      }, onError: (e) => {
        e.target.style.display = "none";
      } })), /* @__PURE__ */ React.createElement("div", { style: { textAlign: "center", marginBottom: 4 } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 9, letterSpacing: 3, color: "#a16207", fontWeight: 700 } }, "UR \u2605\u2605\u2605")), /* @__PURE__ */ React.createElement("div", { style: { textAlign: "center", fontSize: 20, fontWeight: 800, marginBottom: 6 } }, char.name), (() => {
        const cLv = calcCharLevel(charXP[char.id] || 0);
        return /* @__PURE__ */ React.createElement("div", { style: { marginBottom: 14 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", fontSize: 10, color: "#a16207", marginBottom: 3 } }, /* @__PURE__ */ React.createElement("span", { style: { fontWeight: 800 } }, "Lv.", cLv.lv, cLv.isMax ? " (MAX)" : ""), !cLv.isMax && /* @__PURE__ */ React.createElement("span", null, cLv.current, "/", cLv.needed)), /* @__PURE__ */ React.createElement("div", { style: { height: 6, background: "#f5e9c8", borderRadius: 999, overflow: "hidden" } }, /* @__PURE__ */ React.createElement("div", { style: {
          height: "100%",
          background: "linear-gradient(90deg,#f59e0b,#fbbf24)",
          width: cLv.isMax ? "100%" : `${Math.min(cLv.current / cLv.needed * 100, 100)}%`,
          borderRadius: 999,
          transition: "width .4s ease"
        } })));
      })(), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "center", marginBottom: 14 } }, /* @__PURE__ */ React.createElement("div", { style: {
        padding: "5px 14px",
        borderRadius: 999,
        background: "#fef3c7",
        border: "1px solid #fbbf2455"
      } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, fontWeight: 700, color: "#a16207" } }, char.passiveDesc))), /* @__PURE__ */ React.createElement("div", { style: {
        padding: "12px 14px",
        borderRadius: 12,
        marginBottom: 16,
        background: "#faf8f5",
        border: "1px solid #f0ede8"
      } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "#44403c", lineHeight: 1.7, fontStyle: "italic" } }, '"', char.flavor, '"')), isEquipped ? /* @__PURE__ */ React.createElement("button", { onClick: () => {
        setEquippedChar("");
        setCharDetail(null);
        showToast("\u57FA\u672C\u30AD\u30E3\u30E9\u30AF\u30BF\u30FC\u306B\u623B\u3057\u307E\u3057\u305F", "#a8a29e");
      }, style: {
        width: "100%",
        padding: "11px",
        borderRadius: 12,
        border: "1px solid #d6d3d1",
        cursor: "pointer",
        background: "#fff",
        color: "#78716c",
        fontWeight: 700,
        fontSize: 13
      } }, "\u88C5\u5099\u3092\u89E3\u9664\u3059\u308B") : /* @__PURE__ */ React.createElement("button", { onClick: () => {
        setEquippedChar(char.id);
        setCharDetail(null);
        showToast(`${char.name}\u3092\u88C5\u5099\u3057\u305F\uFF01`, "#f0c060");
      }, style: {
        width: "100%",
        padding: "11px",
        borderRadius: 12,
        border: "none",
        cursor: "pointer",
        background: "linear-gradient(90deg,#f59e0b,#fbbf24)",
        color: "#fff",
        fontWeight: 800,
        fontSize: 13
      } }, "\u3053\u306E\u30AD\u30E3\u30E9\u30AF\u30BF\u30FC\u3092\u88C5\u5099\u3059\u308B")) : /* @__PURE__ */ React.createElement("div", { style: {
        padding: "24px 16px",
        borderRadius: 12,
        textAlign: "center",
        background: "#f5f5f4",
        border: "1px solid #e7e5e4"
      } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 32, marginBottom: 10, color: "#a8a29e" } }, "\uFF1F"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "#78716c" } }, "\u307E\u3060\u5165\u624B\u3057\u3066\u3044\u307E\u305B\u3093\u3002\u30AC\u30C1\u30E3\u3067\u4F4E\u78BA\u7387\u306B\u6392\u51FA\u3055\u308C\u307E\u3059\u3002")), /* @__PURE__ */ React.createElement("button", { onClick: () => setCharDetail(null), style: {
        width: "100%",
        marginTop: 12,
        padding: "10px",
        borderRadius: 12,
        border: "none",
        cursor: "pointer",
        background: "#f5f2ee",
        color: "#57534e",
        fontWeight: 700,
        fontSize: 12
      } }, "\u9589\u3058\u308B")));
    })(), magicDetail && (() => {
      const { magic, elem, isUnlocked } = magicDetail;
      const effInfo = EFFECT_TYPE_INFO[magic.type];
      return /* @__PURE__ */ React.createElement("div", { onClick: () => setMagicDetail(null), style: {
        position: "fixed",
        inset: 0,
        background: "rgba(30,20,10,0.78)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 200,
        padding: 20
      } }, /* @__PURE__ */ React.createElement("div", { onClick: (e) => e.stopPropagation(), style: {
        background: "#fff",
        borderRadius: 22,
        padding: "28px 24px",
        width: 320,
        maxWidth: "100%",
        animation: "resultPop .4s cubic-bezier(.34,1.56,.64,1)",
        border: `1.5px solid ${elem.color}55`
      } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "center", marginBottom: 14 } }, /* @__PURE__ */ React.createElement("div", { style: {
        width: 84,
        height: 84,
        borderRadius: 18,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: isUnlocked ? `linear-gradient(160deg, ${elem.light}, ${elem.color}33)` : "#ece8e2",
        border: isUnlocked ? `1.5px solid ${elem.color}88` : "1.5px solid #ddd8d0",
        boxShadow: isUnlocked && magic.tier === 3 ? `0 4px 18px ${elem.color}55` : "none"
      } }, /* @__PURE__ */ React.createElement(MagicGlyph, { catId: skillCat, tier: magic.tier, color: elem.color, locked: !isUnlocked }))), /* @__PURE__ */ React.createElement("div", { style: { textAlign: "center", marginBottom: 4 } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 9, letterSpacing: 3, color: elem.color, fontWeight: 700 } }, elem.name, "\u5C5E\u6027 \u30FB Tier ", magic.tier)), /* @__PURE__ */ React.createElement("div", { style: { textAlign: "center", fontSize: 20, fontWeight: 800, marginBottom: 14 } }, isUnlocked ? magic.label : "\uFF1F\uFF1F\uFF1F"), isUnlocked ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "center", gap: 6, marginBottom: 14, flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement("div", { style: {
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: "4px 10px",
        borderRadius: 999,
        background: effInfo.color + "1a",
        border: `1px solid ${effInfo.color}55`
      } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12 } }, effInfo.icon), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, fontWeight: 700, color: effInfo.color } }, effInfo.label)), magic.power > 0 && /* @__PURE__ */ React.createElement("div", { style: {
        padding: "4px 10px",
        borderRadius: 999,
        background: "#f5f5f4",
        border: "1px solid #d6d3d1"
      } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, fontWeight: 700, color: "#57534e" } }, "\u5A01\u529B ", magic.power)), /* @__PURE__ */ React.createElement("div", { style: {
        padding: "4px 10px",
        borderRadius: 999,
        background: "#f5f5f4",
        border: "1px solid #d6d3d1"
      } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, fontWeight: 700, color: "#57534e" } }, "\u5BFE\u8C61\uFF1A", magic.target))), /* @__PURE__ */ React.createElement("div", { style: {
        padding: "12px 14px",
        borderRadius: 12,
        marginBottom: 10,
        background: "#faf8f5",
        border: "1px solid #f0ede8"
      } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "#44403c", lineHeight: 1.7, fontStyle: "italic" } }, '"', magic.flavor, '"')), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "#a8a29e", textAlign: "center" } }, magic.desc)) : /* @__PURE__ */ React.createElement("div", { style: {
        padding: "16px",
        borderRadius: 12,
        textAlign: "center",
        background: "#f5f5f4",
        border: "1px solid #e7e5e4"
      } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "#78716c", marginBottom: 8 } }, "\u7D2F\u8A08\u8A18\u9332 \xD7", magic.req, " \u3067\u89E3\u653E\u3055\u308C\u307E\u3059"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "#a8a29e" } }, "\u3042\u3068", Math.max(0, magic.req - calcMagicCount(skillCat, logs)), "\u56DE\u306E\u8A18\u9332\u3067\u7FD2\u5F97\u3067\u304D\u307E\u3059")), /* @__PURE__ */ React.createElement("button", { onClick: () => setMagicDetail(null), style: {
        width: "100%",
        marginTop: 18,
        padding: "11px",
        borderRadius: 12,
        border: "none",
        cursor: "pointer",
        background: "#f5f2ee",
        color: "#57534e",
        fontWeight: 700,
        fontSize: 13
      } }, "\u9589\u3058\u308B")));
    })(), loginBonus && /* @__PURE__ */ React.createElement("div", { style: {
      position: "fixed",
      inset: 0,
      background: "rgba(200,195,188,0.75)",
      backdropFilter: "blur(8px)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 200
    } }, /* @__PURE__ */ React.createElement("div", { style: {
      background: "#fff",
      borderRadius: 24,
      padding: "36px 28px",
      width: 300,
      textAlign: "center",
      animation: "bonusIn .4s cubic-bezier(.34,1.56,.64,1)",
      boxShadow: "0 8px 40px rgba(0,0,0,0.15)"
    } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 48, marginBottom: 8 } }, loginBonus.bonus.icon), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 9, letterSpacing: 4, color: GOLD, marginBottom: 6 } }, "LOGIN BONUS"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 20, fontWeight: 800, marginBottom: 4 } }, loginBonus.bonus.label), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, color: "#78716c", marginBottom: 20 } }, loginBonus.streak, "\u65E5\u9023\u7D9A\u30ED\u30B0\u30A4\u30F3\u4E2D\uFF01"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "center", gap: 16, marginBottom: 24 } }, /* @__PURE__ */ React.createElement("div", { style: { textAlign: "center", padding: "12px 20px", borderRadius: 12, background: "#fffbeb", border: "1px solid #f0c060" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 22 } }, "\u{1F48E}"), /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 800, fontSize: 20, color: "#92400e" } }, "+", loginBonus.bonus.gems), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "#78716c" } }, "\u30EB\u30FC\u30F3\u77F3")), loginBonus.bonus.xp > 0 && /* @__PURE__ */ React.createElement("div", { style: { textAlign: "center", padding: "12px 20px", borderRadius: 12, background: "#eff6ff", border: "1px solid #93c5fd" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 22 } }, "\u26A1"), /* @__PURE__ */ React.createElement("div", { style: { fontWeight: 800, fontSize: 20, color: "#1d4ed8" } }, "+", loginBonus.bonus.xp), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 10, color: "#78716c" } }, "EXP"))), loginBonus.streak < 7 && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "#78716c", marginBottom: 16 } }, "\u3042\u3068", 7 - loginBonus.streak, "\u65E5\u30677\u65E5\u9023\u7D9A\u30DC\u30FC\u30CA\u30B9\uFF01\u{1F48E}15\u7372\u5F97"), /* @__PURE__ */ React.createElement("button", { onClick: () => setLoginBonus(null), style: {
      width: "100%",
      padding: "12px",
      borderRadius: 12,
      border: "none",
      cursor: "pointer",
      background: "linear-gradient(90deg,#f59e0b,#f0c060)",
      color: "#1c1917",
      fontWeight: 800,
      fontSize: 14,
      letterSpacing: 2
    } }, "\u53D7\u3051\u53D6\u308B\uFF01"))), (gachaAnim || gachaResult) && /* @__PURE__ */ React.createElement("div", { style: {
      position: "fixed",
      inset: 0,
      background: "rgba(10,0,30,0.88)",
      backdropFilter: "blur(6px)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 200
    }, onClick: gachaResult && !gachaAnim ? () => setGachaResult(null) : void 0 }, gachaAnim ? /* @__PURE__ */ React.createElement("div", { style: { textAlign: "center" } }, /* @__PURE__ */ React.createElement("div", { style: {
      fontSize: 72,
      animation: "gachaSpin 1.2s ease-in-out",
      display: "inline-block"
    } }, "\u2728"), /* @__PURE__ */ React.createElement("div", { style: { color: "#fff", fontSize: 14, marginTop: 16, letterSpacing: 3 } }, "\u7948\u9858\u4E2D\u2026")) : gachaResult && gachaResult.type === "character" ? /* @__PURE__ */ React.createElement("div", { style: {
      background: "linear-gradient(180deg,#fffbeb,#fff)",
      borderRadius: 24,
      padding: "36px 28px",
      width: 300,
      textAlign: "center",
      animation: "resultPop .5s cubic-bezier(.34,1.56,.64,1)",
      border: "2px solid #fbbf24",
      boxShadow: "0 0 40px #fbbf2455"
    } }, /* @__PURE__ */ React.createElement("div", { style: {
      fontSize: 9,
      letterSpacing: 4,
      marginBottom: 8,
      fontWeight: 800,
      color: "#92400e"
    } }, "UR \u2014 \u65B0\u3057\u3044\u4EF2\u9593\uFF01\u2605\u2605\u2605"), /* @__PURE__ */ React.createElement("img", { src: getCharacterStageImage(gachaResult, calcCharLevel(charXP[gachaResult.id] || 0).lv), alt: gachaResult.name, style: {
      width: 140,
      height: 140,
      objectFit: "contain",
      margin: "0 auto 12px",
      display: "block",
      filter: "drop-shadow(0 0 20px #fbbf2488)"
    }, onError: (e) => {
      e.target.style.display = "none";
    } }), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 20, fontWeight: 800, marginBottom: 6, color: "#92400e" } }, gachaResult.name), /* @__PURE__ */ React.createElement("div", { style: {
      display: "inline-block",
      fontSize: 11,
      fontWeight: 700,
      color: "#a16207",
      background: "#fef3c7",
      padding: "4px 12px",
      borderRadius: 999,
      marginBottom: 14
    } }, gachaResult.passiveDesc), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "#78716c", marginBottom: 24, fontStyle: "italic" } }, '"', gachaResult.flavor, '"'), /* @__PURE__ */ React.createElement("button", { onClick: () => setGachaResult(null), style: {
      width: "100%",
      padding: "12px",
      borderRadius: 12,
      border: "none",
      cursor: "pointer",
      background: "linear-gradient(90deg,#f59e0b,#fbbf24)",
      color: "#fff",
      fontWeight: 800,
      fontSize: 14,
      letterSpacing: 2
    } }, "\u9589\u3058\u308B")) : gachaResult && /* @__PURE__ */ React.createElement("div", { style: {
      background: "#fff",
      borderRadius: 24,
      padding: "36px 28px",
      width: 300,
      textAlign: "center",
      animation: "resultPop .5s cubic-bezier(.34,1.56,.64,1)"
    } }, /* @__PURE__ */ React.createElement("div", { style: {
      fontSize: 9,
      letterSpacing: 4,
      marginBottom: 8,
      fontWeight: 700,
      color: gachaResult.rarity === "SSR" ? "#92400e" : gachaResult.rarity === "SR" ? "#5b21b6" : "#1e40af"
    } }, gachaResult.rarity, " \u2014 ", gachaResult.rarity === "SSR" ? "\u8D85\u7D76\uFF01\uFF01" : gachaResult.rarity === "SR" ? "\u30EC\u30A2\uFF01" : "GOOD"), /* @__PURE__ */ React.createElement("div", { style: {
      fontSize: 64,
      marginBottom: 12,
      filter: `drop-shadow(0 0 16px ${gachaResult.color})`
    } }, gachaResult.icon), /* @__PURE__ */ React.createElement("div", { style: {
      fontSize: 20,
      fontWeight: 800,
      marginBottom: 8,
      color: gachaResult.color
    } }, gachaResult.label), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "#78716c", marginBottom: 24 } }, gachaResult.desc), /* @__PURE__ */ React.createElement("button", { onClick: () => setGachaResult(null), style: {
      width: "100%",
      padding: "12px",
      borderRadius: 12,
      border: "none",
      cursor: "pointer",
      background: gachaResult.rarity === "SSR" ? "linear-gradient(90deg,#f59e0b,#f0c060)" : gachaResult.rarity === "SR" ? "linear-gradient(90deg,#8b5cf6,#a78bfa)" : "linear-gradient(90deg,#3b82f6,#60a5fa)",
      color: "#fff",
      fontWeight: 800,
      fontSize: 14,
      letterSpacing: 2
    } }, "\u9589\u3058\u308B"))), levelUp && /* @__PURE__ */ React.createElement(
      LevelUpModal,
      {
        oldLv: levelUp.oldLv,
        newLv: levelUp.newLv,
        stage: getCharStage(levelUp.newLv),
        onClose: () => setLevelUp(null)
      }
    ), toast && /* @__PURE__ */ React.createElement("div", { style: {
      position: "fixed",
      bottom: 110,
      right: 16,
      zIndex: 300,
      background: "#f5f2ee",
      border: `1px solid ${toast.color}55`,
      borderRadius: 10,
      padding: "10px 16px",
      fontSize: 13,
      fontWeight: 700,
      color: toast.color,
      animation: "toastIn .3s ease",
      boxShadow: `0 4px 20px ${toast.color}30`
    } }, toast.msg));
  }
  if (typeof ReactDOM !== "undefined" && typeof document !== "undefined" && document.getElementById("root")) {
    ReactDOM.createRoot(document.getElementById("root")).render(/* @__PURE__ */ React.createElement(LifeQuest, null));
  }
  var life_quest_default = LifeQuest;
})();
