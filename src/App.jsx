import { useState, useEffect, useCallback, useRef } from "react";

const DAYS = ["週一","週二","週三","週四","週五","週六","週日"];
const DAY_KEYS = ["mon","tue","wed","thu","fri","sat","sun"];

// ── Storage helpers (localStorage for web deployment) ───────────
async function storageGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
async function storageSet(key, val) {
  try { localStorage.setItem(key, val); } catch {}
}



// ── Date helpers ─────────────────────────────────────────────────
function todayDayKey() {
  const d = new Date().getDay(); // 0=Sun
  return DAY_KEYS[d === 0 ? 6 : d - 1];
}
function deadlineLabel(dl) {
  if (!dl) return { text: "無期限", color: "#94a3b8" };
  const diff = (new Date(dl) - Date.now()) / 86400000;
  if (diff < 0)  return { text: "已過期", color: "#ef4444" };
  if (diff < 1)  return { text: "今天截止", color: "#ef4444" };
  if (diff < 3)  return { text: "非常緊急", color: "#f97316" };
  if (diff < 7)  return { text: "本週內", color: "#eab308" };
  if (diff < 14) return { text: "兩週內", color: "#3b82f6" };
  return { text: "不急", color: "#22c55e" };
}
function fmtDeadline(dl) {
  if (!dl) return null;
  const d = new Date(dl);
  return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}

// ── Timeline helpers ─────────────────────────────────────────────
const HOUR_H = 56; // px per hour
const DAY_START = 7;  // 7am
const DAY_END = 22;   // 10pm

function timeToY(timeStr) {
  const [h, m] = timeStr.split(":").map(Number);
  return (h - DAY_START + m / 60) * HOUR_H;
}
function durationToH(start, end) {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  return ((eh * 60 + em) - (sh * 60 + sm)) / 60;
}
function totalH() { return DAY_END - DAY_START; }

// ── Main App ─────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState("timeline");
  const [selectedDay, setSelectedDay] = useState(todayDayKey());

  // Persistent state
  const [weeklyEvents, setWeeklyEvents] = useState({}); // { mon: [{id,label,start,end,type:'weekly'}] }
  const [onceEvents, setOnceEvents] = useState({});     // { mon: [{id,label,start,end,type:'once'}] }
  const [tasks, setTasks] = useState([]);
  const [arranged, setArranged] = useState([]);         // [{taskId,day,start,end,taskName}]

  const [loaded, setLoaded] = useState(false);
  const [toast, setToast] = useState(null);
  const [loading, setLoading] = useState(false);

  // Schedule input form
  const [schedInput, setSchedInput] = useState("");
  const [schedType, setSchedType] = useState("weekly"); // weekly | once
  const [schedLoading, setSchedLoading] = useState(false);

  // Task form
  const [taskForm, setTaskForm] = useState({ name: "", duration: "", deadline: "", noDeadline: false, notes: "" });

  // ── Load from storage ────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const we = await storageGet("v3_weekly");
      const oe = await storageGet("v3_once");
      const tk = await storageGet("v3_tasks");
      const ar = await storageGet("v3_arranged");
      if (we) setWeeklyEvents(JSON.parse(we));
      if (oe) setOnceEvents(JSON.parse(oe));
      if (tk) setTasks(JSON.parse(tk));
      if (ar) setArranged(JSON.parse(ar));
      setLoaded(true);
    })();
  }, []);

  const saveWeekly = useCallback(async (v) => { setWeeklyEvents(v); await storageSet("v3_weekly", JSON.stringify(v)); }, []);
  const saveOnce   = useCallback(async (v) => { setOnceEvents(v);   await storageSet("v3_once",   JSON.stringify(v)); }, []);
  const saveTasks  = useCallback(async (v) => { setTasks(v);        await storageSet("v3_tasks",  JSON.stringify(v)); }, []);
  const saveArr    = useCallback(async (v) => { setArranged(v);     await storageSet("v3_arranged",JSON.stringify(v)); }, []);

  const showToast = (msg, type = "ok") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2800);
  };

  // ── Get events for a day (weekly + once) ────────────────────
  function eventsForDay(dayKey) {
    return [
      ...(weeklyEvents[dayKey] || []),
      ...(onceEvents[dayKey] || []),
    ].sort((a, b) => a.start.localeCompare(b.start));
  }

  function arrangedForDay(dayKey) {
    const dayName = DAYS[DAY_KEYS.indexOf(dayKey)];
    return arranged.filter(a => a.day === dayName)
      .sort((a, b) => a.start.localeCompare(b.start));
  }

  // ── Parse schedule locally (no AI needed) ───────────────────
  // Accepts lines like: "8:10-13:20 上課" or "8.10-13.20 上課"
  // Also auto-detects day if first line is e.g. "禮拜一" / "週三"
  function parseScheduleLocal(text) {
    const normalise = t => t.replace(/\./g, ":").replace(/：/g, ":").trim();
    const timeRe = /^(\d{1,2}[:]\d{2})\s*[-－~～]\s*(\d{1,2}[:]\d{2})\s+(.+)$/;
    const dayMap = { "週一":0,"周一":0,"禮拜一":0,"星期一":0, "週二":1,"周二":1,"禮拜二":1,"星期二":1, "週三":2,"周三":2,"禮拜三":2,"星期三":2, "週四":3,"周四":3,"禮拜四":3,"星期四":3, "週五":4,"周五":4,"禮拜五":4,"星期五":4, "週六":5,"周六":5,"禮拜六":5,"星期六":5, "週日":6,"周日":6,"禮拜日":6,"星期日":6,"週天":6,"禮拜天":6 };

    let detectedDay = null;
    const events = [];
    const errors = [];

    text.split("\n").forEach((rawLine, idx) => {
      const line = normalise(rawLine);
      if (!line) return;

      // Day header?
      const dayIdx = dayMap[line.trim()];
      if (dayIdx !== undefined) { detectedDay = DAY_KEYS[dayIdx]; return; }

      const m = line.match(timeRe);
      if (m) {
        const [, start, end, label] = m;
        // pad to HH:MM
        const pad = s => { const [h,min] = s.split(":"); return `${h.padStart(2,"0")}:${min}`; };
        events.push({ label: label.trim(), start: pad(start), end: pad(end), id: Date.now() + Math.random(), type: schedType });
      } else {
        errors.push(`第 ${idx+1} 行看不懂：「${rawLine.trim()}」`);
      }
    });

    return { events, detectedDay, errors };
  }

  const parseSchedule = async () => {
    if (!schedInput.trim()) return showToast("請先輸入行程", "err");
    const { events, detectedDay, errors } = parseScheduleLocal(schedInput);

    if (events.length === 0) {
      return showToast("沒有解析到任何事件，請用「時間-時間 名稱」格式", "err");
    }

    // Auto switch day if detected
    const targetDay = detectedDay || selectedDay;
    if (detectedDay && detectedDay !== selectedDay) setSelectedDay(detectedDay);

    if (schedType === "weekly") {
      const updated = { ...weeklyEvents, [targetDay]: [...(weeklyEvents[targetDay] || []), ...events] };
      await saveWeekly(updated);
    } else {
      const updated = { ...onceEvents, [targetDay]: [...(onceEvents[targetDay] || []), ...events] };
      await saveOnce(updated);
    }
    setSchedInput("");
    const errMsg = errors.length > 0 ? `（${errors.length} 行略過）` : "";
    showToast(`已新增 ${events.length} 個事件 ✓ ${errMsg}`);
    setTab("timeline");
  };

  // ── Delete event ─────────────────────────────────────────────
  const deleteEvent = async (dayKey, id, type) => {
    if (type === "weekly") {
      const updated = { ...weeklyEvents, [dayKey]: (weeklyEvents[dayKey]||[]).filter(e=>e.id!==id) };
      await saveWeekly(updated);
    } else {
      const updated = { ...onceEvents, [dayKey]: (onceEvents[dayKey]||[]).filter(e=>e.id!==id) };
      await saveOnce(updated);
    }
  };

  // ── Add task ─────────────────────────────────────────────────
  const addTask = async () => {
    if (!taskForm.name.trim()) return showToast("請填任務名稱", "err");
    if (!taskForm.duration)    return showToast("請填預估時間", "err");
    if (!taskForm.noDeadline && !taskForm.deadline) return showToast("請選截止日期或勾「沒有期限」", "err");
    const task = {
      id: Date.now(),
      name: taskForm.name.trim(),
      duration: Number(taskForm.duration),
      deadline: taskForm.noDeadline ? null : taskForm.deadline,
      noDeadline: taskForm.noDeadline,
      notes: taskForm.notes.trim(),
      done: false,
    };
    await saveTasks([...tasks, task]);
    setTaskForm({ name: "", duration: "", deadline: "", noDeadline: false, notes: "" });
    showToast("任務已新增 ✓");
  };

  const toggleDone = async (taskId) => {
    await saveTasks(tasks.map(t => t.id === taskId ? { ...t, done: !t.done } : t));
    await saveArr(arranged.map(a => a.taskId === taskId ? { ...a, done: !a.done } : a));
  };

  const deleteTask = async (taskId) => {
    await saveTasks(tasks.filter(t => t.id !== taskId));
    await saveArr(arranged.filter(a => a.taskId !== taskId));
  };

  // ── Pure-logic arrange (no network) ─────────────────────────
  // Converts "HH:MM" to minutes-since-midnight
  const toMin = (t) => { const [h,m] = t.split(":").map(Number); return h*60+m; };
  const toHHMM = (mins) => { const h=Math.floor(mins/60); const m=mins%60; return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`; };

  const arrangeAll = async (forceRearrange = false) => {
    const pending = tasks.filter(t => !t.done);
    if (pending.length === 0) return showToast("沒有待辦任務", "err");
    setLoading(true);

    // Keep done items, re-arrange everything pending
    const keptDone = arranged.filter(a => a.done);

    // Sort tasks: deadline asc, no-deadline last
    const sorted = [...pending].sort((a, b) => {
      if (!a.deadline && !b.deadline) return 0;
      if (!a.deadline) return 1;
      if (!b.deadline) return -1;
      return new Date(a.deadline) - new Date(b.deadline);
    });

    // Build free slots per day, starting from TODAY
    // todayDi = index in DAY_KEYS for today (0=Mon..6=Sun)
    const SLOT_START = 7 * 60 + 30;  // 07:30
    const SLOT_END   = 21 * 60;       // 21:00
    const MIN_SLOT   = 15;

    const now = new Date();
    const jsDay = now.getDay(); // 0=Sun,1=Mon..6=Sat
    const todayDi = jsDay === 0 ? 6 : jsDay - 1; // convert to Mon=0..Sun=6
    const nowMin = now.getHours() * 60 + now.getMinutes(); // current time in minutes

    // orderedDayIdxs: [todayDi, todayDi+1, ..., wrapping around the week]
    const orderedDayIdxs = Array.from({length: 7}, (_, i) => (todayDi + i) % 7);

    const freeSlotsPerDay = DAY_KEYS.map((k, di) => {
      // For today, slots must start no earlier than now+5min
      const effectiveStart = di === todayDi
        ? Math.max(SLOT_START, nowMin + 5)
        : SLOT_START;

      const evs = eventsForDay(k)
        .map(e => ({ s: toMin(e.start), e: toMin(e.end) }))
        .sort((a, b) => a.s - b.s);
      const slots = [];
      let cursor = effectiveStart;
      for (const ev of evs) {
        if (ev.s > cursor + MIN_SLOT) slots.push({ s: cursor, e: ev.s });
        cursor = Math.max(cursor, ev.e);
      }
      if (cursor < SLOT_END - MIN_SLOT) slots.push({ s: cursor, e: SLOT_END });
      return slots;
    });

    // occupied[dayIdx] = [{s,e}] already taken by assigned tasks
    const occupied = DAY_KEYS.map(() => []);
    const result = [];

    for (const task of sorted) {
      const durMin = task.duration;
      let placed = false;

      // How many days from today until deadline?
      let maxOffset = 6; // default: anywhere this week
      if (task.deadline) {
        const diffDays = Math.floor((new Date(task.deadline) - new Date()) / 86400000);
        maxOffset = Math.min(6, Math.max(0, diffDays));
      }

      // Try days in order: today, today+1, ... up to maxOffset
      for (let offset = 0; offset <= maxOffset && !placed; offset++) {
        const di = orderedDayIdxs[offset];
        for (const slot of freeSlotsPerDay[di]) {
          const taken = occupied[di]
            .filter(o => o.e > slot.s && o.s < slot.e)
            .sort((a, b) => a.s - b.s);
          let cursor = slot.s;
          for (const t of taken) {
            if (t.s - cursor >= durMin) break;
            cursor = Math.max(cursor, t.e);
          }
          if (cursor + durMin <= slot.e) {
            occupied[di].push({ s: cursor, e: cursor + durMin });
            result.push({
              taskId: task.id,
              taskName: task.name,
              day: DAYS[di],
              start: toHHMM(cursor),
              end: toHHMM(cursor + durMin),
              done: false,
            });
            placed = true;
            break;
          }
        }
      }

      if (!placed) {
        // No slot found — mark as unscheduled
        result.push({
          taskId: task.id,
          taskName: task.name,
          day: null,
          start: null,
          end: null,
          done: false,
          unscheduled: true,
          reason: task.deadline
            ? `截止日前（${fmtDeadline(task.deadline)}）找不到 ${durMin} 分鐘的空檔`
            : `本週找不到 ${durMin} 分鐘的空檔`,
        });
      }
    }

    const scheduled = result.filter(r => !r.unscheduled);
    const unscheduled = result.filter(r => r.unscheduled);
    const final = [...keptDone, ...scheduled, ...unscheduled];
    await saveArr(final);

    if (unscheduled.length > 0) {
      showToast(`${scheduled.length} 個已安排，${unscheduled.length} 個排不下 ⚠️`, "warn");
    } else {
      showToast(`全部 ${scheduled.length} 個任務安排完成 ✓`);
    }
    setLoading(false);
    setTab("timeline");
  };

  // ── Timeline render ──────────────────────────────────────────
  function Timeline({ dayKey }) {
    const events = eventsForDay(dayKey);
    const arranged_ = arrangedForDay(dayKey);
    const totalHeight = totalH() * HOUR_H;

    return (
      <div style={{ position: "relative", height: totalHeight, marginLeft: 44 }}>
        {/* Hour lines */}
        {Array.from({ length: DAY_END - DAY_START + 1 }, (_, i) => {
          const h = DAY_START + i;
          return (
            <div key={h} style={{ position: "absolute", top: i * HOUR_H, left: 0, right: 0 }}>
              <div style={{ position: "absolute", left: -44, top: -9, fontSize: 11, color: "#64748b", width: 38, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                {h < 10 ? `0${h}:00` : `${h}:00`}
              </div>
              <div style={{ height: 1, background: h % 6 === 0 ? "#334155" : "#1e293b", width: "100%" }} />
            </div>
          );
        })}

        {/* Fixed events */}
        {events.map(ev => {
          const top = timeToY(ev.start);
          const height = Math.max(durationToH(ev.start, ev.end) * HOUR_H, 28);
          return (
            <div key={ev.id} style={{
              position: "absolute", top, left: 0, right: 0, height,
              background: ev.type === "weekly" ? "#1e3a5f" : "#2d1b4e",
              border: `1px solid ${ev.type === "weekly" ? "#3b82f6" : "#8b5cf6"}`,
              borderRadius: 8, padding: "4px 8px", overflow: "hidden",
              display: "flex", alignItems: "center", justifyContent: "space-between",
            }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: ev.type === "weekly" ? "#93c5fd" : "#c4b5fd" }}>{ev.label}</div>
                <div style={{ fontSize: 10, color: "#64748b" }}>{ev.start}–{ev.end} {ev.type === "weekly" ? "每週" : "單次"}</div>
              </div>
              <button onClick={() => deleteEvent(dayKey, ev.id, ev.type)}
                style={{ background: "none", border: "none", color: "#475569", cursor: "pointer", fontSize: 14, padding: "0 2px", flexShrink: 0 }}>×</button>
            </div>
          );
        })}

        {/* Now line (only for today) */}
        {dayKey === todayDayKey() && (() => {
          const now = new Date();
          const nowMins = now.getHours() * 60 + now.getMinutes();
          const top = (nowMins / 60 - DAY_START) * HOUR_H;
          if (top < 0 || top > totalHeight) return null;
          return (
            <div style={{ position: "absolute", top, left: -44, right: 0, zIndex: 10, pointerEvents: "none" }}>
              <div style={{ position: "absolute", left: 0, top: -5, fontSize: 10, color: "#f87171", fontWeight: 700, width: 38, textAlign: "right" }}>
                {String(now.getHours()).padStart(2,"0")}:{String(now.getMinutes()).padStart(2,"0")}
              </div>
              <div style={{ height: 2, background: "#ef4444", width: "100%", marginLeft: 44, boxShadow: "0 0 6px #ef4444" }} />
            </div>
          );
        })()}

        {/* Arranged tasks */}
        {arranged_.map((item, i) => {
          const top = timeToY(item.start);
          const height = Math.max(durationToH(item.start, item.end) * HOUR_H, 28);
          const task = tasks.find(t => t.id === item.taskId);
          const dl = deadlineLabel(task?.deadline);
          return (
            <div key={i} style={{
              position: "absolute", top, left: "52%", right: 0, height,
              background: item.done ? "#1a2a1a" : "#0f2d1a",
              border: `1px solid ${item.done ? "#374151" : dl.color}`,
              borderRadius: 8, padding: "4px 8px", overflow: "hidden",
              opacity: item.done ? 0.5 : 1,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <button onClick={() => toggleDone(item.taskId)}
                  style={{ width: 14, height: 14, borderRadius: 3, border: `1.5px solid ${item.done ? dl.color : "#4b5563"}`, background: item.done ? dl.color : "none", cursor: "pointer", flexShrink: 0, color: "#fff", fontSize: 9, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {item.done ? "✓" : ""}
                </button>
                <div style={{ fontSize: 11, fontWeight: 600, color: item.done ? "#4b5563" : "#86efac", textDecoration: item.done ? "line-through" : "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.taskName}</div>
              </div>
              {height > 36 && <div style={{ fontSize: 10, color: "#4b5563", marginTop: 2 }}>{item.start}–{item.end}</div>}
            </div>
          );
        })}
      </div>
    );
  }

  if (!loaded) return (
    <div style={{ background: "#0a0f1a", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b", fontFamily: "sans-serif" }}>
      載入中...
    </div>
  );

  const pendingCount = tasks.filter(t => !t.done).length;

  return (
    <div style={{ fontFamily: "'Noto Sans TC', sans-serif", minHeight: "100vh", background: "#0a0f1a", color: "#e2e8f0" }}>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@300;400;500;700&display=swap" rel="stylesheet" />
      <style>{`
        *{box-sizing:border-box;margin:0;padding:0;}
        ::-webkit-scrollbar{width:4px;}
        ::-webkit-scrollbar-thumb{background:#1e293b;border-radius:2px;}
        .inp{width:100%;background:#0f172a;border:1.5px solid #1e293b;border-radius:10px;padding:10px 13px;font-size:14px;font-family:inherit;color:#e2e8f0;outline:none;transition:border .2s;}
        .inp:focus{border-color:#3b82f6;}
        .inp::placeholder{color:#334155;}
        .btn{border:none;cursor:pointer;font-family:inherit;font-size:14px;border-radius:10px;transition:all .18s;font-weight:500;}
        .btn-blue{background:#1d4ed8;color:#fff;padding:10px 20px;}
        .btn-blue:hover{background:#1e40af;}
        .btn-blue:disabled{opacity:.4;cursor:not-allowed;}
        .btn-dim{background:#1e293b;color:#94a3b8;padding:8px 14px;}
        .btn-dim:hover{background:#273548;color:#cbd5e1;}
        .card{background:#0f172a;border:1.5px solid #1e293b;border-radius:14px;padding:14px;}
        .nav-tab{background:none;border:none;cursor:pointer;padding:10px 14px;font-size:13px;font-family:inherit;color:#475569;border-bottom:2px solid transparent;transition:all .2s;white-space:nowrap;}
        .nav-tab.act{color:#38bdf8;border-bottom-color:#38bdf8;font-weight:600;}
        .day-chip{padding:7px 14px;border-radius:20px;font-size:13px;cursor:pointer;border:1.5px solid #1e293b;background:none;color:#475569;transition:all .18s;font-family:inherit;}
        .day-chip.sel{background:#1d4ed8;color:#fff;border-color:#1d4ed8;}
        .day-chip:hover:not(.sel){border-color:#334155;color:#94a3b8;}
        @keyframes fu{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
        .fu{animation:fu .25s ease;}
        @keyframes spin{to{transform:rotate(360deg)}}
        .spin{width:15px;height:15px;border:2px solid #1e293b;border-top-color:#3b82f6;border-radius:50%;animation:spin .7s linear infinite;display:inline-block;}
        textarea.inp{resize:vertical;line-height:1.6;}
      `}</style>

      {toast && (
        <div style={{ position:"fixed", top:16, left:"50%", transform:"translateX(-50%)", zIndex:9999, background: toast.type==="err"?"#1a0a0a":toast.type==="warn"?"#1c1008":"#0a1a10", border:`1.5px solid ${toast.type==="err"?"#7f1d1d":toast.type==="warn"?"#c2410c":"#14532d"}`, padding:"9px 18px", borderRadius:10, fontSize:13, color: toast.type==="err"?"#fca5a5":toast.type==="warn"?"#fed7aa":"#86efac", boxShadow:"0 8px 32px rgba(0,0,0,.4)", animation:"fu .2s" }}>
          {toast.msg}
        </div>
      )}

      <div style={{ maxWidth: 640, margin: "0 auto", padding: "20px 14px 80px" }}>

        {/* Header */}
        <div style={{ marginBottom: 20 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "#f1f5f9", letterSpacing: "-0.3px" }}>行程規劃</h1>
          <p style={{ fontSize: 12, color: "#475569", marginTop: 2 }}>智慧安排，讓你專注在重要的事</p>
        </div>

        {/* Nav */}
        <div style={{ display: "flex", borderBottom: "1.5px solid #1e293b", marginBottom: 20, overflowX: "auto" }}>
          {[["timeline","時刻表"],["schedule","新增行程"],["tasks",`任務${pendingCount>0?` (${pendingCount})`:""}`]].map(([id,lbl]) => (
            <button key={id} className={`nav-tab ${tab===id?"act":""}`} onClick={() => setTab(id)}>{lbl}</button>
          ))}
        </div>

        {/* ── TIMELINE TAB ── */}
        {tab === "timeline" && (
          <div className="fu">
            {/* Day selector */}
            <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 12, marginBottom: 16 }}>
              {DAY_KEYS.map((k, i) => {
                const hasEvents = eventsForDay(k).length > 0 || arrangedForDay(k).length > 0;
                return (
                  <button key={k} className={`day-chip ${selectedDay===k?"sel":""}`} onClick={() => setSelectedDay(k)}>
                    {DAYS[i]}{hasEvents ? " ·" : ""}
                  </button>
                );
              })}
            </div>

            {/* Legend */}
            <div style={{ display: "flex", gap: 14, marginBottom: 14, fontSize: 11, color: "#475569" }}>
              <span><span style={{ display:"inline-block", width:10, height:10, background:"#1e3a5f", border:"1px solid #3b82f6", borderRadius:2, marginRight:4 }} />每週固定</span>
              <span><span style={{ display:"inline-block", width:10, height:10, background:"#2d1b4e", border:"1px solid #8b5cf6", borderRadius:2, marginRight:4 }} />單次活動</span>
              <span><span style={{ display:"inline-block", width:10, height:10, background:"#0f2d1a", border:"1px solid #22c55e", borderRadius:2, marginRight:4 }} />待辦任務</span>
            </div>

            {/* Timeline */}
            <div style={{ overflowY: "auto", maxHeight: "65vh", paddingRight: 4 }}>
              <Timeline dayKey={selectedDay} />
            </div>

            {/* Arrange / rearrange buttons */}
            <div style={{ display:"flex", gap:8, marginTop:16 }}>
              {pendingCount > 0 && (
                <button className="btn btn-blue" onClick={() => arrangeAll(false)} disabled={loading}
                  style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}>
                  {loading ? <><div className="spin" />安排中...</> : `⚡ 安排 ${pendingCount} 個任務`}
                </button>
              )}
              {arranged.filter(a => !a.done).length > 0 && (
                <button className="btn btn-dim" onClick={() => arrangeAll(true)} disabled={loading}
                  style={{ flex: pendingCount > 0 ? "0 0 auto" : 1, padding:"10px 16px", display:"flex", alignItems:"center", gap:6 }}>
                  🔄 重新安排
                </button>
              )}
            </div>

            {eventsForDay(selectedDay).length === 0 && arrangedForDay(selectedDay).length === 0 && (
              <div style={{ textAlign: "center", color: "#334155", padding: "30px 0", fontSize: 13 }}>
                這天還沒有行程<br />
                <button className="btn btn-dim" onClick={() => setTab("schedule")} style={{ marginTop: 10, fontSize: 12 }}>＋ 新增行程</button>
              </div>
            )}

            {/* Unscheduled tasks */}
            {arranged.filter(a => a.unscheduled && !a.done).length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 12, color: "#f97316", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 8 }}>
                  ⚠️ 排不下的任務
                </div>
                {arranged.filter(a => a.unscheduled && !a.done).map((item, i) => (
                  <div key={i} style={{ background: "#1c1008", border: "1.5px solid #f97316", borderRadius: 10, padding: "10px 12px", marginBottom: 8 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, color: "#fed7aa", marginBottom: 4 }}>{item.taskName}</div>
                    <div style={{ fontSize: 12, color: "#92400e" }}>{item.reason}</div>
                    <div style={{ fontSize: 11, color: "#78350f", marginTop: 4 }}>→ 請新增更多空閒時段或調整任務時間</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── SCHEDULE TAB ── */}
        {tab === "schedule" && (
          <div className="fu">
            {/* Day selector */}
            <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4, marginBottom: 14 }}>
              {DAY_KEYS.map((k, i) => (
                <button key={k} className={`day-chip ${selectedDay===k?"sel":""}`} onClick={() => setSelectedDay(k)}>{DAYS[i]}</button>
              ))}
            </div>

            <div className="card" style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: "#475569", marginBottom: 10, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase" }}>
                {DAYS[DAY_KEYS.indexOf(selectedDay)]} 行程輸入
              </div>

              {/* Type toggle */}
              <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                {[["weekly","每週重複"],["once","單次"]].map(([v,lbl]) => (
                  <button key={v} className="btn" onClick={() => setSchedType(v)}
                    style={{ flex: 1, padding: "8px", background: schedType===v ? "#1d4ed8" : "#1e293b", color: schedType===v ? "#fff" : "#64748b", borderRadius: 8 }}>
                    {lbl}
                  </button>
                ))}
              </div>

              <textarea className="inp" rows={5}
                placeholder="格式：時間-時間 名稱（一行一個）
第一行可打星期幾自動選天

範例：
禮拜一
08:10-13:20 上課
14:25-15:15 上課
16:10-16:40 回家"
                value={schedInput}
                onChange={e => setSchedInput(e.target.value)}
                style={{ marginBottom: 12 }} />

              <button className="btn btn-blue" onClick={parseSchedule} 
                style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                ✦ 加入時刻表
              </button>
            </div>

            {/* Existing events for this day */}
            {eventsForDay(selectedDay).length > 0 && (
              <div className="card">
                <div style={{ fontSize: 12, color: "#475569", marginBottom: 10, fontWeight: 600, letterSpacing:"0.05em", textTransform:"uppercase" }}>
                  {DAYS[DAY_KEYS.indexOf(selectedDay)]} 現有行程
                </div>
                {eventsForDay(selectedDay).map(ev => (
                  <div key={ev.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderBottom: "1px solid #1e293b" }}>
                    <div>
                      <span style={{ fontSize: 13, color: "#e2e8f0" }}>{ev.label}</span>
                      <span style={{ fontSize: 11, color: "#475569", marginLeft: 8 }}>{ev.start}–{ev.end}</span>
                      <span style={{ fontSize: 10, color: ev.type==="weekly"?"#3b82f6":"#8b5cf6", marginLeft: 6 }}>{ev.type==="weekly"?"每週":"單次"}</span>
                    </div>
                    <button onClick={() => deleteEvent(selectedDay, ev.id, ev.type)}
                      style={{ background:"none", border:"none", color:"#334155", cursor:"pointer", fontSize:16 }}>×</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── TASKS TAB ── */}
        {tab === "tasks" && (
          <div className="fu">
            <div className="card" style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, color: "#475569", marginBottom: 12, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase" }}>新增任務</div>

              <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                <input className="inp" placeholder="任務名稱" value={taskForm.name} onChange={e=>setTaskForm(p=>({...p,name:e.target.value}))} style={{ flex:3 }} onKeyDown={e=>e.key==="Enter"&&addTask()} />
                <div style={{ position:"relative", flex:1, minWidth:80 }}>
                  <input className="inp" type="number" placeholder="分鐘" value={taskForm.duration} onChange={e=>setTaskForm(p=>({...p,duration:e.target.value}))} />
                </div>
              </div>

              <div style={{ marginBottom: 10 }}>
                <label style={{ display:"flex", alignItems:"center", gap:8, cursor:"pointer", marginBottom: taskForm.noDeadline?0:8, fontSize:13, color:"#94a3b8" }}>
                  <input type="checkbox" checked={taskForm.noDeadline} onChange={e=>setTaskForm(p=>({...p,noDeadline:e.target.checked,deadline:""}))}
                    style={{ width:15, height:15, accentColor:"#3b82f6", cursor:"pointer" }} />
                  沒有期限（AI 排在空閒時段）
                </label>
                {!taskForm.noDeadline && (
                  <input className="inp" type="datetime-local" value={taskForm.deadline} onChange={e=>setTaskForm(p=>({...p,deadline:e.target.value}))} />
                )}
              </div>

              <input className="inp" placeholder="備註（選填）" value={taskForm.notes} onChange={e=>setTaskForm(p=>({...p,notes:e.target.value}))} style={{ marginBottom:12 }} />
              <button className="btn btn-blue" onClick={addTask} style={{ width:"100%" }}>＋ 新增任務</button>
            </div>

            {tasks.length === 0 ? (
              <div style={{ textAlign:"center", color:"#334155", padding:"32px 0", fontSize:13 }}>還沒有任務</div>
            ) : (
              <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                {[...tasks]
                  .sort((a,b) => {
                    if (a.done !== b.done) return a.done - b.done;
                    if (!a.deadline && !b.deadline) return 0;
                    if (!a.deadline) return 1;
                    if (!b.deadline) return -1;
                    return new Date(a.deadline)-new Date(b.deadline);
                  })
                  .map(task => {
                    const dl = deadlineLabel(task.deadline);
                    return (
                      <div key={task.id} className="card fu" style={{ opacity:task.done?.45:1, borderLeft:`3px solid ${dl.color}` }}>
                        <div style={{ display:"flex", alignItems:"flex-start", gap:10 }}>
                          <button onClick={()=>toggleDone(task.id)}
                            style={{ width:19,height:19,borderRadius:5,border:`1.5px solid ${task.done?dl.color:"#334155"}`,background:task.done?dl.color:"none",cursor:"pointer",flexShrink:0,marginTop:2,display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontSize:10 }}>
                            {task.done?"✓":""}
                          </button>
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap", marginBottom:3 }}>
                              <span style={{ fontWeight:500, fontSize:14, textDecoration:task.done?"line-through":"none", color:task.done?"#475569":"#e2e8f0" }}>{task.name}</span>
                              <span style={{ fontSize:11, padding:"2px 7px", borderRadius:20, background:dl.color+"20", color:dl.color, fontWeight:500 }}>{dl.text}</span>
                            </div>
                            <div style={{ display:"flex", gap:10, fontSize:11, color:"#475569", flexWrap:"wrap" }}>
                              <span>⏱ {task.duration} 分鐘</span>
                              {!task.noDeadline && task.deadline && <span>📅 {fmtDeadline(task.deadline)}</span>}
                              {task.notes && <span>💬 {task.notes}</span>}
                            </div>
                          </div>
                          <button onClick={()=>deleteTask(task.id)}
                            style={{ background:"none",border:"none",color:"#334155",cursor:"pointer",fontSize:17,padding:"0 2px",flexShrink:0 }}>×</button>
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}

            {pendingCount > 0 && (
              <button className="btn btn-blue" onClick={arrangeAll} disabled={loading}
                style={{ width:"100%",marginTop:14,display:"flex",alignItems:"center",justifyContent:"center",gap:8 }}>
                {loading?<><div className="spin"/>安排中...</>:`⚡ 安排 ${pendingCount} 個任務`}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
