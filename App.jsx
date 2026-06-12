import { useState, useEffect, useCallback, useRef } from "react";

// ── Constants ────────────────────────────────────────────────────────────────
const VIEWS = { TODAY:"today", UPCOMING:"upcoming", INBOX:"inbox", PROJECTS:"projects", CALENDAR:"calendar", STATS:"stats" };
const P = { HIGH:"high", MED:"med", LOW:"low", NONE:"none" };
const P_LABEL = { high:"Терміново", med:"Середній", low:"Низький", none:"Без пріоритету" };
const P_CLASS = { high:"tag-priority-high", med:"tag-priority-med", low:"tag-priority-low", none:"" };
const P_CHECK = { high:"p-high", med:"p-med", low:"p-low", none:"" };
const REPEAT = { none:"Без повтору", daily:"Щодня", weekly:"Щотижня", monthly:"Щомісяця" };
const PROJ_COLORS = ["#7C3AED","#DC2626","#2563EB","#16A34A","#D97706","#DB2777","#0891B2","#65A30D"];

const gid = () => `${Date.now()}_${Math.random().toString(36).slice(2)}`;
const todayStr = () => new Date().toISOString().split("T")[0];
const fmtDate = (d) => { if(!d) return ""; const dt=new Date(d+"T00:00:00"); return dt.toLocaleDateString("uk-UA",{day:"numeric",month:"short"}); };
const isToday = d => d===todayStr();
const isPast = d => d && d<todayStr();
const isFuture = d => d && d>todayStr();
const load = () => { try { const s=localStorage.getItem("vikaplan_v2"); return s?JSON.parse(s):{tasks:[],projects:[],tags:[],focusId:null}; } catch { return {tasks:[],projects:[],tags:[],focusId:null}; } };
const persist = s => { try { localStorage.setItem("vikaplan_v2",JSON.stringify(s)); } catch {} };

// ── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [st, setSt] = useState(load);
  const [view, setView] = useState(VIEWS.TODAY);
  const [selProj, setSelProj] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [addingTo, setAddingTo] = useState(null);
  const [editingTask, setEditingTask] = useState(null);
  const [editingProj, setEditingProj] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);
  const [toast, setToast] = useState(null);
  const [voiceModal, setVoiceModal] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [filterPriority, setFilterPriority] = useState("all");
  const [filterTag, setFilterTag] = useState("all");
  const [calDate, setCalDate] = useState(new Date());
  const [taskDetail, setTaskDetail] = useState(null);
  const recogRef = useRef(null);
  const addInputRef = useRef(null);

  const upd = useCallback(next => { setSt(next); persist(next); }, []);
  const showToast = msg => { setToast(msg); setTimeout(()=>setToast(null),2500); };

  // ── Task ops ───────────────────────────────────────────────────────────────
  const addTask = fields => {
    const t = { id:gid(), text:"", done:false, priority:P.NONE, date:null, projectId:null, repeat:"none", tags:[], note:"", createdAt:Date.now(), ...fields };
    upd({...st, tasks:[...st.tasks,t]});
  };
  const updTask = (id,fields) => upd({...st, tasks:st.tasks.map(t=>t.id===id?{...t,...fields}:t)});
  const delTask = id => { upd({...st, tasks:st.tasks.filter(t=>t.id!==id), focusId:st.focusId===id?null:st.focusId}); setConfirmDel(null); showToast("Задачу видалено"); };
  const toggleDone = id => {
    const t = st.tasks.find(t=>t.id===id);
    if(t.repeat && t.repeat!=="none" && !t.done){
      const next = {...t, done:false};
      const d = new Date(t.date||todayStr()+"T00:00:00");
      if(t.repeat==="daily") d.setDate(d.getDate()+1);
      if(t.repeat==="weekly") d.setDate(d.getDate()+7);
      if(t.repeat==="monthly") d.setMonth(d.getMonth()+1);
      next.date = d.toISOString().split("T")[0];
      upd({...st, tasks:st.tasks.map(tk=>tk.id===id?{...tk,done:true}:tk).concat({...next,id:gid()})});
    } else {
      updTask(id,{done:!t.done});
    }
  };
  const setFocus = id => upd({...st, focusId:st.focusId===id?null:id});

  // ── Project ops ────────────────────────────────────────────────────────────
  const addProj = () => {
    const p = {id:gid(),name:"Новий проєкт",color:PROJ_COLORS[st.projects.length%PROJ_COLORS.length]};
    upd({...st,projects:[...st.projects,p]});
    setSelProj(p.id); setView(VIEWS.PROJECTS); setEditingProj(p.id); setSidebarOpen(false);
  };
  const updProj = (id,fields) => upd({...st,projects:st.projects.map(p=>p.id===id?{...p,...fields}:p)});
  const delProj = id => { upd({...st,projects:st.projects.filter(p=>p.id!==id),tasks:st.tasks.map(t=>t.projectId===id?{...t,projectId:null}:t)}); setConfirmDel(null); if(selProj===id){setSelProj(null);setView(VIEWS.PROJECTS);} showToast("Проєкт видалено"); };

  // ── Tag ops ────────────────────────────────────────────────────────────────
  const allTags = [...new Set(st.tasks.flatMap(t=>t.tags||[]))];

  // ── Voice ──────────────────────────────────────────────────────────────────
  const startVoice = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if(!SR){ showToast("Браузер не підтримує голосовий ввід"); return; }
    setVoiceModal(true); setTranscript(""); setRecording(true);
    const r = new SR();
    r.lang="uk-UA"; r.continuous=false; r.interimResults=true;
    r.onresult = e => { const t=Array.from(e.results).map(r=>r[0].transcript).join(" "); setTranscript(t); };
    r.onend = () => setRecording(false);
    r.onerror = () => { setRecording(false); showToast("Помилка мікрофону"); };
    r.start();
    recogRef.current = r;
  };
  const stopVoice = () => { recogRef.current?.stop(); setRecording(false); };
  const processVoice = async () => {
    if(!transcript.trim()) return;
    setAiLoading(true);
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages",{
        method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({ model:"claude-sonnet-4-6", max_tokens:1000,
          system:`Ти — AI-планувальник. Аналізуй текст і витягни задачі. Повернути ТІЛЬКИ JSON масив без жодного іншого тексту. Кожен елемент: text (назва, українською, коротко), priority ("high"|"med"|"low"|"none"), date ("YYYY-MM-DD" або null, сьогодні=${todayStr()}). Мінімум 1, максимум 8.`,
          messages:[{role:"user",content:transcript}]
        })
      });
      const data = await res.json();
      const raw = data.content?.[0]?.text?.trim()||"[]";
      let tasks; try { tasks=JSON.parse(raw); } catch { tasks=[]; }
      if(tasks.length){
        const newTasks = tasks.map(t=>({id:gid(),text:t.text||"Задача",done:false,priority:t.priority||P.NONE,date:t.date||null,projectId:null,repeat:"none",tags:[],note:"",createdAt:Date.now()}));
        upd({...st,tasks:[...st.tasks,...newTasks]});
        showToast(`Додано ${newTasks.length} задач${newTasks.length===1?"у":newTasks.length<5?"и":""}`);
        setView(VIEWS.INBOX); setVoiceModal(false); setTranscript("");
      } else { showToast("Не вдалось розпізнати задачі"); }
    } catch { showToast("Помилка AI"); }
    setAiLoading(false);
  };

  // ── Filtering ──────────────────────────────────────────────────────────────
  const filterTasks = tasks => {
    let res = tasks;
    if(filterPriority!=="all") res=res.filter(t=>t.priority===filterPriority);
    if(filterTag!=="all") res=res.filter(t=>(t.tags||[]).includes(filterTag));
    return res;
  };

  const todayTasks = filterTasks(st.tasks.filter(t=>isToday(t.date)||(!t.done&&isPast(t.date))));
  const upcomingTasks = filterTasks(st.tasks.filter(t=>isFuture(t.date)));
  const inboxTasks = filterTasks(st.tasks.filter(t=>!t.date&&!t.projectId));
  const focusTask = st.focusId ? st.tasks.find(t=>t.id===st.focusId) : null;

  // ── Stats ──────────────────────────────────────────────────────────────────
  const total = st.tasks.length;
  const done = st.tasks.filter(t=>t.done).length;
  const overdue = st.tasks.filter(t=>!t.done&&isPast(t.date)).length;
  const todayCount = st.tasks.filter(t=>isToday(t.date)&&!t.done).length;
  const pct = total>0?Math.round(done/total*100):0;

  const nav = (v,proj=null) => { setView(v); setSelProj(proj); setSidebarOpen(false); };

  // ── Calendar helpers ───────────────────────────────────────────────────────
  const calDays = () => {
    const y=calDate.getFullYear(), m=calDate.getMonth();
    const first=new Date(y,m,1).getDay();
    const days=[];
    const offset = first===0?6:first-1;
    for(let i=0;i<offset;i++) days.push({date:null});
    const dcount=new Date(y,m+1,0).getDate();
    for(let d=1;d<=dcount;d++) days.push({date:`${y}-${String(m+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`});
    while(days.length%7!==0) days.push({date:null});
    return days;
  };

  // ── Render task ────────────────────────────────────────────────────────────
  const renderTask = (task, opts={}) => {
    const proj = st.projects.find(p=>p.id===task.projectId);
    const isFocused = st.focusId===task.id;
    return (
      <div key={task.id} className={`task-card${task.done?" done":""}${isFocused?" is-focus":""}`}>
        <button className={`task-check-btn${task.done?" checked":""} ${P_CHECK[task.priority]}`} onClick={()=>toggleDone(task.id)} aria-label="Виконано">
          {task.done && <i className="ti ti-check" />}
        </button>
        <div className="task-body" onClick={()=>setTaskDetail(task)}>
          {editingTask===task.id
            ? <input className="task-edit-input" autoFocus defaultValue={task.text} onBlur={e=>{updTask(task.id,{text:e.target.value});setEditingTask(null);}} onKeyDown={e=>{if(e.key==="Enter")e.target.blur();if(e.key==="Escape")setEditingTask(null);}} onClick={e=>e.stopPropagation()} />
            : <span className={`task-text${task.done?" done":""}`}>{task.text||"Без назви"}</span>
          }
          <div className="task-meta">
            {task.priority!==P.NONE && <span className={`task-tag ${P_CLASS[task.priority]}`}><i className={`ti ti-flag`} style={{fontSize:10}} /> {P_LABEL[task.priority]}</span>}
            {task.date && <span className={`task-tag tag-date${!task.done&&isPast(task.date)?" overdue":""}`}><i className="ti ti-calendar" style={{fontSize:10}} /> {fmtDate(task.date)}</span>}
            {task.repeat&&task.repeat!=="none" && <span className="task-tag tag-repeat"><i className="ti ti-refresh" style={{fontSize:10}} /> {REPEAT[task.repeat]}</span>}
            {proj && <span className="task-tag tag-project" style={{background:proj.color}}>{proj.name}</span>}
            {(task.tags||[]).map(tag=><span key={tag} className="task-tag tag-custom">#{tag}</span>)}
          </div>
        </div>
        <div className="task-actions">
          <button className="task-action-btn" title={isFocused?"Прибрати фокус":"Фокус дня"} onClick={e=>{e.stopPropagation();setFocus(task.id);}}>
            <i className={`ti ${isFocused?"ti-bolt-off":"ti-bolt"}`} style={{fontSize:14}} />
          </button>
          <button className="task-action-btn" title="Редагувати" onClick={e=>{e.stopPropagation();setEditingTask(task.id);}}>
            <i className="ti ti-edit" style={{fontSize:14}} />
          </button>
          <TaskMenu task={task} projects={st.projects} tags={allTags} onUpdate={f=>updTask(task.id,f)} onDelete={()=>setConfirmDel({type:"task",id:task.id})} onFocus={()=>setFocus(task.id)} isFocused={isFocused} />
        </div>
      </div>
    );
  };

  const renderAdd = (defaults={}) => {
    const key = JSON.stringify(defaults);
    if(addingTo!==key) return (
      <button className="add-task-btn" onClick={()=>{setAddingTo(key);setTimeout(()=>addInputRef.current?.focus(),50);}}>
        <i className="ti ti-plus" style={{fontSize:15}} /> Додати задачу
      </button>
    );
    return <AddForm ref={addInputRef} defaults={defaults} projects={st.projects} tags={allTags} onAdd={f=>{addTask(f);setAddingTo(null);}} onCancel={()=>setAddingTo(null)} />;
  };

  const filterBar = () => (
    <div className="filter-bar">
      {["all","high","med","low"].map(p=>(
        <button key={p} className={`filter-chip${filterPriority===p?" active":""}`} onClick={()=>setFilterPriority(p)}>
          {p==="all"?"Всі":P_LABEL[p]}
        </button>
      ))}
      {allTags.map(tag=>(
        <button key={tag} className={`filter-chip${filterTag===tag?" active":""}`} onClick={()=>setFilterTag(filterTag===tag?"all":tag)}>#{tag}</button>
      ))}
    </div>
  );

  return (
    <div className="app">
      <div className="mobile-header">
        <button className="hamburger" onClick={()=>setSidebarOpen(v=>!v)} aria-label="Меню"><i className="ti ti-menu-2" style={{fontSize:20}} /></button>
        <span style={{fontSize:15,fontWeight:700,letterSpacing:"-0.3px"}}>Vika Plan</span>
      </div>
      {sidebarOpen && <div className="overlay" onClick={()=>setSidebarOpen(false)} />}

      {/* SIDEBAR */}
      <aside className={`sidebar${sidebarOpen?" open":""}`}>
        <div className="sidebar-logo">
          <div className="logo-mark"><i className="ti ti-bolt" /></div>
          <span className="logo-text">Vika Plan</span>
        </div>
        <div className="nav-section">
          {[
            {id:VIEWS.TODAY,icon:"ti-sun",label:"Сьогодні",count:todayTasks.filter(t=>!t.done).length},
            {id:VIEWS.UPCOMING,icon:"ti-calendar",label:"Заплановано",count:upcomingTasks.filter(t=>!t.done).length},
            {id:VIEWS.INBOX,icon:"ti-inbox",label:"Inbox",count:inboxTasks.filter(t=>!t.done).length},
            {id:VIEWS.CALENDAR,icon:"ti-calendar-month",label:"Календар"},
            {id:VIEWS.STATS,icon:"ti-chart-bar",label:"Прогрес"},
          ].map(item=>(
            <button key={item.id} className={`nav-item${view===item.id&&!selProj?" active":""}`} onClick={()=>nav(item.id)}>
              <i className={`ti ${item.icon}`} aria-hidden="true" />
              <span className="nav-item-label">{item.label}</span>
              {item.count>0 && <span className="nav-count">{item.count}</span>}
            </button>
          ))}
        </div>
        <div className="sidebar-projects">
          <div className="sidebar-projects-header">
            <span>Проєкти</span>
            <button className="icon-btn" onClick={addProj} title="Новий проєкт"><i className="ti ti-plus" style={{fontSize:14}} /></button>
          </div>
          {st.projects.map(p=>(
            <button key={p.id} className={`proj-nav-item${selProj===p.id?" active":""}`} onClick={()=>nav(VIEWS.PROJECTS,p.id)}>
              <div className="proj-dot" style={{background:p.color}} />
              <span className="proj-nav-label">
                {editingProj===p.id
                  ? <input autoFocus defaultValue={p.name} onBlur={e=>{updProj(p.id,{name:e.target.value});setEditingProj(null);}} onKeyDown={e=>{if(e.key==="Enter"||e.key==="Escape")e.target.blur();}} style={{background:"transparent",border:"none",outline:"none",fontSize:13,fontWeight:500,color:"var(--ink)",width:"100%",padding:0}} onClick={e=>e.stopPropagation()} />
                  : p.name
                }
              </span>
              <span className="nav-count" style={{opacity:0.6}}>{st.tasks.filter(t=>t.projectId===p.id&&!t.done).length||""}</span>
            </button>
          ))}
          {st.projects.length===0 && <div style={{padding:"4px 10px",fontSize:12,color:"var(--ink4)"}}>Натисни + щоб додати</div>}
        </div>
      </aside>

      {/* MAIN */}
      <div className="main">
        <div className="topbar">
          <div>
            <h1 className="page-title">{
              view===VIEWS.TODAY?"Сьогодні":
              view===VIEWS.UPCOMING?"Заплановано":
              view===VIEWS.INBOX?"Inbox":
              view===VIEWS.CALENDAR?"Календар":
              view===VIEWS.STATS?"Прогрес":
              selProj?st.projects.find(p=>p.id===selProj)?.name||"Проєкт":"Проєкти"
            }</h1>
            {view===VIEWS.TODAY && <p className="page-sub">{new Date().toLocaleDateString("uk-UA",{weekday:"long",day:"numeric",month:"long"})}</p>}
          </div>
          <div className="topbar-actions">
            {view===VIEWS.PROJECTS&&selProj&&(
              <>
                <button className="icon-btn" onClick={()=>setEditingProj(selProj)} title="Перейменувати"><i className="ti ti-edit" style={{fontSize:15}} /></button>
                <button className="icon-btn" style={{color:"var(--high)"}} onClick={()=>setConfirmDel({type:"project",id:selProj})} title="Видалити"><i className="ti ti-trash" style={{fontSize:15}} /></button>
              </>
            )}
          </div>
        </div>

        <div className="content">
          {/* Focus card — show everywhere except stats/calendar */}
          {view!==VIEWS.STATS&&view!==VIEWS.CALENDAR&&(
            <div className="focus-card">
              <div className="focus-card-icon"><i className="ti ti-bolt" /></div>
              <div className="focus-card-body">
                <div className="focus-card-label">Фокус дня</div>
                {focusTask ? <div className="focus-task-text">{focusTask.text}</div> : <div className="focus-empty">Не вибрано — натисни ⚡ на задачі</div>}
              </div>
              {focusTask && <button className="focus-set-btn" onClick={()=>setFocus(focusTask.id)}>Зняти</button>}
            </div>
          )}

          {/* TODAY */}
          {view===VIEWS.TODAY&&<>
            {filterBar()}
            <TaskListView tasks={todayTasks} renderTask={renderTask} renderAdd={()=>renderAdd({date:todayStr()})} emptyMsg="Сьогодні все виконано 🎉" />
          </>}

          {/* UPCOMING */}
          {view===VIEWS.UPCOMING&&<>
            {filterBar()}
            <UpcomingView tasks={upcomingTasks} renderTask={renderTask} renderAdd={()=>renderAdd({})} />
          </>}

          {/* INBOX */}
          {view===VIEWS.INBOX&&<>
            {filterBar()}
            <TaskListView tasks={inboxTasks} renderTask={renderTask} renderAdd={()=>renderAdd({})} emptyMsg="Inbox порожній ✓" />
          </>}

          {/* PROJECT */}
          {view===VIEWS.PROJECTS&&selProj&&(()=>{
            const proj=st.projects.find(p=>p.id===selProj);
            if(!proj) return null;
            const ptasks=filterTasks(st.tasks.filter(t=>t.projectId===selProj));
            return <>
              <div style={{display:"flex",gap:8,marginBottom:20,flexWrap:"wrap"}}>
                {PROJ_COLORS.map(c=>(
                  <button key={c} onClick={()=>updProj(selProj,{color:c})} style={{width:22,height:22,borderRadius:"50%",background:c,border:proj.color===c?"3px solid var(--ink)":"none",padding:0,outline:"none"}} />
                ))}
              </div>
              {filterBar()}
              <TaskListView tasks={ptasks} renderTask={renderTask} renderAdd={()=>renderAdd({projectId:selProj})} emptyMsg="Задач немає — додай першу" />
            </>;
          })()}

          {/* PROJECTS LIST */}
          {view===VIEWS.PROJECTS&&!selProj&&(
            <div style={{display:"grid",gap:10,marginTop:8}}>
              {st.projects.length===0&&<div className="empty-state"><i className="ti ti-folders" /><p>Проєктів немає. Натисни + в бічному меню.</p></div>}
              {st.projects.map(p=>{
                const count=st.tasks.filter(t=>t.projectId===p.id&&!t.done).length;
                return <div key={p.id} style={{display:"flex",alignItems:"center",gap:12,padding:"14px 16px",background:"var(--white)",border:"1px solid var(--border)",borderRadius:"var(--r-lg)",cursor:"pointer",boxShadow:"var(--shadow-sm)"}} onClick={()=>nav(VIEWS.PROJECTS,p.id)}>
                  <div style={{width:10,height:10,borderRadius:"50%",background:p.color}} />
                  <span style={{flex:1,fontSize:15,fontWeight:600}}>{p.name}</span>
                  {count>0&&<span style={{fontSize:12,color:"var(--ink4)",fontWeight:500}}>{count} задач</span>}
                  <i className="ti ti-chevron-right" style={{fontSize:14,color:"var(--ink4)"}} />
                </div>;
              })}
              <button style={{display:"flex",alignItems:"center",gap:8,padding:"14px 16px",background:"transparent",border:"1.5px dashed var(--border2)",borderRadius:"var(--r-lg)",color:"var(--ink4)",fontSize:14,fontWeight:500}} onClick={addProj}>
                <i className="ti ti-plus" style={{fontSize:15}} /> Новий проєкт
              </button>
            </div>
          )}

          {/* CALENDAR */}
          {view===VIEWS.CALENDAR&&<CalendarView tasks={st.tasks} calDate={calDate} setCalDate={setCalDate} calDays={calDays} renderTask={renderTask} renderAdd={renderAdd} />}

          {/* STATS */}
          {view===VIEWS.STATS&&<StatsView tasks={st.tasks} projects={st.projects} total={total} done={done} overdue={overdue} todayCount={todayCount} pct={pct} />}
        </div>
      </div>

      {/* Voice FAB */}
      <button className={`voice-fab${recording?" recording":""}`} onClick={recording?stopVoice:startVoice} title="Голосовий ввід" aria-label="Голосовий ввід">
        <i className={`ti ${recording?"ti-microphone-off":"ti-microphone"}`} />
      </button>

      {/* Voice Modal */}
      {voiceModal&&<div className="voice-modal-backdrop" onClick={()=>{stopVoice();setVoiceModal(false);}}>
        <div className="voice-modal" onClick={e=>e.stopPropagation()}>
          <div className="voice-modal-title">🎙 Голосовий ввід</div>
          <div className="voice-modal-sub">Говори — AI розбере на задачі</div>
          {recording&&<div className="voice-wave">{[1,2,3,4,5].map(i=><div key={i} className="voice-bar" style={{animationDelay:`${i*0.1}s`}} />)}</div>}
          {transcript&&<div className="voice-transcript">{transcript}</div>}
          {!recording&&!transcript&&<div className="voice-transcript" style={{color:"var(--ink4)",fontStyle:"italic"}}>Натисни мікрофон і говори...</div>}
          <div className="voice-actions">
            <button className="btn-ghost" onClick={()=>{stopVoice();setVoiceModal(false);}}>Скасувати</button>
            {!recording&&<button className="btn-ghost" onClick={startVoice}><i className="ti ti-microphone" style={{fontSize:14,marginRight:6}} />Ще раз</button>}
            {transcript&&<button className="btn-primary" onClick={processVoice} disabled={aiLoading}>{aiLoading?"Аналізую...":"Розбити на задачі"}</button>}
          </div>
        </div>
      </div>}

      {/* Task Detail Modal */}
      {taskDetail&&<TaskDetailModal task={taskDetail} projects={st.projects} tags={allTags} onUpdate={f=>{updTask(taskDetail.id,f);setTaskDetail({...taskDetail,...f});}} onClose={()=>setTaskDetail(null)} onDelete={()=>{delTask(taskDetail.id);setTaskDetail(null);}} />}

      {/* Confirm Delete */}
      {confirmDel&&<div className="modal-backdrop" onClick={()=>setConfirmDel(null)}>
        <div className="modal" onClick={e=>e.stopPropagation()}>
          <div className="modal-title">Видалити?</div>
          <div className="modal-sub">{confirmDel.type==="project"?"Проєкт буде видалено. Задачі залишаться в Inbox.":"Цю задачу буде видалено назавжди."}</div>
          <div className="modal-actions">
            <button className="btn-ghost" onClick={()=>setConfirmDel(null)}>Скасувати</button>
            <button className="btn-danger" onClick={()=>confirmDel.type==="project"?delProj(confirmDel.id):delTask(confirmDel.id)}>Видалити</button>
          </div>
        </div>
      </div>}

      {toast&&<div className="toast">{toast}</div>}
    </div>
  );
}

// ── AddForm ──────────────────────────────────────────────────────────────────
import { forwardRef } from "react";
const AddForm = forwardRef(({defaults,projects,tags,onAdd,onCancel},ref) => {
  const [text,setText]=useState("");
  const [priority,setPriority]=useState(P.NONE);
  const [date,setDate]=useState(defaults.date||"");
  const [projId,setProjId]=useState(defaults.projectId||"");
  const [repeat,setRepeat]=useState("none");
  const [tag,setTag]=useState("");
  const submit=()=>{if(text.trim()){onAdd({text:text.trim(),priority,date:date||null,projectId:projId||null,repeat,tags:tag?[tag]:[],...defaults});setText("");}else onCancel();};
  return (
    <div className="add-task-form">
      <input ref={ref} value={text} onChange={e=>setText(e.target.value)} placeholder="Назва задачі..." onKeyDown={e=>{if(e.key==="Enter"&&text.trim())submit();if(e.key==="Escape")onCancel();}} />
      <div className="add-form-row">
        <select className="add-form-select" value={priority} onChange={e=>setPriority(e.target.value)}>
          {Object.entries(P_LABEL).map(([k,v])=><option key={k} value={k}>{v}</option>)}
        </select>
        <input className="add-form-date" type="date" value={date} onChange={e=>setDate(e.target.value)} />
        {projects.length>0&&<select className="add-form-select" value={projId} onChange={e=>setProjId(e.target.value)}>
          <option value="">Без проєкту</option>
          {projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
        </select>}
        <select className="add-form-select" value={repeat} onChange={e=>setRepeat(e.target.value)}>
          {Object.entries(REPEAT).map(([k,v])=><option key={k} value={k}>{v}</option>)}
        </select>
        <input className="add-form-select" value={tag} onChange={e=>setTag(e.target.value)} placeholder="#тег" style={{width:80}} />
        <div className="add-form-actions">
          <button className="btn-ghost" onClick={onCancel}>Скасувати</button>
          <button className="btn-primary" onClick={submit} disabled={!text.trim()}>Додати</button>
        </div>
      </div>
    </div>
  );
});

// ── TaskMenu ─────────────────────────────────────────────────────────────────
function TaskMenu({task,projects,tags,onUpdate,onDelete,onFocus,isFocused}){
  const [open,setOpen]=useState(false);
  const ref=useRef(null);
  useEffect(()=>{
    if(!open)return;
    const h=e=>{if(!ref.current?.contains(e.target))setOpen(false);};
    document.addEventListener("mousedown",h);
    return()=>document.removeEventListener("mousedown",h);
  },[open]);
  const tomorrow=()=>{const d=new Date();d.setDate(d.getDate()+1);return d.toISOString().split("T")[0];};
  const nextWeek=()=>{const d=new Date();d.setDate(d.getDate()+7);return d.toISOString().split("T")[0];};
  return(
    <div className="dropdown-wrap" ref={ref}>
      <button className="task-action-btn" onClick={e=>{e.stopPropagation();setOpen(v=>!v);}} aria-label="Ще">
        <i className="ti ti-dots" style={{fontSize:14}} />
      </button>
      {open&&<div className="dropdown-menu" onClick={e=>e.stopPropagation()}>
        <div className="dd-section-label">Пріоритет</div>
        {Object.entries(P_LABEL).map(([k,v])=>(
          <button key={k} className={`dd-item${task.priority===k?" active":""}`} onClick={()=>{onUpdate({priority:k});setOpen(false);}}>
            <i className="ti ti-flag" style={{fontSize:13,color:k==="high"?"var(--high)":k==="med"?"var(--med)":k==="low"?"var(--low)":"var(--ink4)"}} />{v}
            {task.priority===k&&<i className="ti ti-check" style={{fontSize:12,marginLeft:"auto"}} />}
          </button>
        ))}
        <div className="dd-divider" />
        <div className="dd-section-label">Дата</div>
        <button className="dd-item" onClick={()=>{onUpdate({date:todayStr()});setOpen(false);}}><i className="ti ti-sun" style={{fontSize:13}} />Сьогодні</button>
        <button className="dd-item" onClick={()=>{onUpdate({date:tomorrow()});setOpen(false);}}><i className="ti ti-calendar" style={{fontSize:13}} />Завтра</button>
        <button className="dd-item" onClick={()=>{onUpdate({date:nextWeek()});setOpen(false);}}><i className="ti ti-calendar-week" style={{fontSize:13}} />Наступний тиждень</button>
        {task.date&&<button className="dd-item" onClick={()=>{onUpdate({date:null});setOpen(false);}}><i className="ti ti-x" style={{fontSize:13}} />Прибрати дату</button>}
        <div className="dd-divider" />
        <div className="dd-section-label">Повтор</div>
        {Object.entries(REPEAT).map(([k,v])=>(
          <button key={k} className={`dd-item${task.repeat===k?" active":""}`} onClick={()=>{onUpdate({repeat:k});setOpen(false);}}>
            <i className="ti ti-refresh" style={{fontSize:13}} />{v}
          </button>
        ))}
        {projects.length>0&&<><div className="dd-divider" /><div className="dd-section-label">Проєкт</div>
        {projects.map(p=>(
          <button key={p.id} className={`dd-item${task.projectId===p.id?" active":""}`} onClick={()=>{onUpdate({projectId:task.projectId===p.id?null:p.id});setOpen(false);}}>
            <div style={{width:8,height:8,borderRadius:"50%",background:p.color,flexShrink:0}} />{p.name}
            {task.projectId===p.id&&<i className="ti ti-check" style={{fontSize:12,marginLeft:"auto"}} />}
          </button>
        ))}</>}
        <div className="dd-divider" />
        <button className="dd-item danger" onClick={()=>{onDelete();setOpen(false);}}><i className="ti ti-trash" style={{fontSize:13}} />Видалити</button>
      </div>}
    </div>
  );
}

// ── TaskListView ─────────────────────────────────────────────────────────────
function TaskListView({tasks,renderTask,renderAdd,emptyMsg}){
  const active=tasks.filter(t=>!t.done);
  const done=tasks.filter(t=>t.done);
  const [showDone,setShowDone]=useState(false);
  return(
    <>
      {active.length===0&&done.length===0&&<div className="empty-state"><i className="ti ti-checks" /><p>{emptyMsg}</p></div>}
      <div className="task-list">{active.map(t=>renderTask(t))}</div>
      {renderAdd&&renderAdd()}
      {done.length>0&&<div style={{marginTop:16}}>
        <button className="done-toggle" onClick={()=>setShowDone(v=>!v)}>
          <i className={`ti ${showDone?"ti-chevron-down":"ti-chevron-right"}`} style={{fontSize:12}} />
          Виконані ({done.length})
        </button>
        {showDone&&<div className="task-list" style={{marginTop:8}}>{done.map(t=>renderTask(t))}</div>}
      </div>}
    </>
  );
}

// ── UpcomingView ─────────────────────────────────────────────────────────────
function UpcomingView({tasks,renderTask,renderAdd}){
  const groups={};
  tasks.forEach(t=>{if(!groups[t.date])groups[t.date]=[];groups[t.date].push(t);});
  const sorted=Object.keys(groups).sort();
  return(
    <>
      {sorted.length===0&&<div className="empty-state"><i className="ti ti-calendar-off" /><p>Немає запланованих задач</p></div>}
      {sorted.map(date=>(
        <div key={date} style={{marginBottom:24}}>
          <div className="section-header">
            <span className="section-title">{new Date(date+"T00:00:00").toLocaleDateString("uk-UA",{weekday:"long",day:"numeric",month:"long"})}</span>
            <span className="section-count">{groups[date].filter(t=>!t.done).length} задач</span>
          </div>
          <div className="task-list">{groups[date].map(t=>renderTask(t))}</div>
        </div>
      ))}
      <div style={{marginTop:8}}>{renderAdd&&renderAdd()}</div>
    </>
  );
}

// ── CalendarView ─────────────────────────────────────────────────────────────
function CalendarView({tasks,calDate,setCalDate,calDays,renderTask,renderAdd}){
  const [selectedDay,setSelectedDay]=useState(null);
  const days=calDays();
  const DAYS=["Пн","Вт","Ср","Чт","Пт","Сб","Нд"];
  const selTasks=selectedDay?tasks.filter(t=>t.date===selectedDay):[];
  const prevMonth=()=>{const d=new Date(calDate);d.setMonth(d.getMonth()-1);setCalDate(d);};
  const nextMonth=()=>{const d=new Date(calDate);d.setMonth(d.getMonth()+1);setCalDate(d);};
  return(
    <>
      <div className="cal-nav">
        <button className="cal-nav-btn" onClick={prevMonth}><i className="ti ti-chevron-left" style={{fontSize:14}} /></button>
        <span className="cal-month-label">{calDate.toLocaleDateString("uk-UA",{month:"long",year:"numeric"})}</span>
        <button className="cal-nav-btn" onClick={nextMonth}><i className="ti ti-chevron-right" style={{fontSize:14}} /></button>
      </div>
      <div className="calendar-grid">
        {DAYS.map(d=><div key={d} className="cal-header">{d}</div>)}
        {days.map((day,i)=>{
          if(!day.date) return <div key={i} />;
          const hasTasks=tasks.some(t=>t.date===day.date);
          const isTd=isToday(day.date);
          return(
            <div key={day.date} className={`cal-day${isTd?" today":""}${hasTasks?" has-tasks":""}${selectedDay===day.date?" ":" "}`}
              style={selectedDay===day.date?{border:"2px solid var(--focus)",background:"var(--focus-bg)"}:{}}
              onClick={()=>setSelectedDay(selectedDay===day.date?null:day.date)}>
              {parseInt(day.date.split("-")[2])}
            </div>
          );
        })}
      </div>
      {selectedDay&&<>
        <div className="section-header" style={{marginBottom:10}}>
          <span className="section-title">{new Date(selectedDay+"T00:00:00").toLocaleDateString("uk-UA",{weekday:"long",day:"numeric",month:"long"})}</span>
        </div>
        <div className="task-list">{selTasks.map(t=>renderTask(t))}</div>
        {renderAdd({date:selectedDay})}
      </>}
    </>
  );
}

// ── StatsView ────────────────────────────────────────────────────────────────
function StatsView({tasks,projects,total,done,overdue,todayCount,pct}){
  const byPriority={high:tasks.filter(t=>t.priority==="high"&&!t.done).length,med:tasks.filter(t=>t.priority==="med"&&!t.done).length,low:tasks.filter(t=>t.priority==="low"&&!t.done).length};
  const r=40, circ=2*Math.PI*r;
  const offset=circ*(1-pct/100);
  return(
    <>
      <div className="stats-row">
        {[{num:total,label:"Всього задач"},{num:done,label:"Виконано"},{num:overdue,label:"Прострочено"},{num:todayCount,label:"На сьогодні"}].map(({num,label})=>(
          <div key={label} className="stat-card">
            <div className="stat-num">{num}</div>
            <div className="stat-label">{label}</div>
            {total>0&&<div className="stat-bar"><div className="stat-bar-fill" style={{width:`${Math.round(num/total*100)}%`}} /></div>}
          </div>
        ))}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:24}}>
        <div className="stat-card" style={{display:"flex",alignItems:"center",gap:20}}>
          <svg width="100" height="100" viewBox="0 0 100 100">
            <circle className="progress-track" cx="50" cy="50" r={r} strokeWidth="8" />
            <circle className="progress-fill" cx="50" cy="50" r={r} strokeWidth="8" strokeDasharray={circ} strokeDashoffset={offset} style={{transform:"rotate(-90deg)",transformOrigin:"50% 50%"}} />
            <text x="50" y="55" textAnchor="middle" fontSize="18" fontWeight="700" fill="var(--ink)">{pct}%</text>
          </svg>
          <div><div className="stat-num">{pct}%</div><div className="stat-label">Загальний прогрес</div></div>
        </div>
        <div className="stat-card">
          <div className="stat-label" style={{marginBottom:12}}>За пріоритетом</div>
          {[["Терміново",byPriority.high,"var(--high)"],["Середній",byPriority.med,"var(--med)"],["Низький",byPriority.low,"var(--low)"]].map(([label,count,color])=>(
            <div key={label} style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
              <div style={{width:8,height:8,borderRadius:"50%",background:color,flexShrink:0}} />
              <span style={{fontSize:13,flex:1,color:"var(--ink2)"}}>{label}</span>
              <span style={{fontSize:13,fontWeight:600,color:"var(--ink)"}}>{count}</span>
            </div>
          ))}
        </div>
      </div>
      {projects.length>0&&<>
        <div className="section-header"><span className="section-title">По проєктах</span></div>
        <div style={{display:"grid",gap:8,marginTop:8}}>
          {projects.map(p=>{
            const pt=tasks.filter(t=>t.projectId===p.id);
            const pd=pt.filter(t=>t.done).length;
            const pp=pt.length>0?Math.round(pd/pt.length*100):0;
            return(
              <div key={p.id} className="stat-card" style={{padding:"12px 16px"}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                  <div style={{width:8,height:8,borderRadius:"50%",background:p.color}} />
                  <span style={{fontWeight:600,fontSize:14,flex:1}}>{p.name}</span>
                  <span style={{fontSize:12,color:"var(--ink4)"}}>{pd}/{pt.length}</span>
                </div>
                <div className="stat-bar"><div className="stat-bar-fill" style={{width:`${pp}%`,background:p.color}} /></div>
              </div>
            );
          })}
        </div>
      </>}
    </>
  );
}

// ── TaskDetailModal ──────────────────────────────────────────────────────────
function TaskDetailModal({task,projects,tags,onUpdate,onClose,onDelete}){
  const [text,setText]=useState(task.text);
  const [note,setNote]=useState(task.note||"");
  const [tagInput,setTagInput]=useState("");
  const save=()=>{onUpdate({text,note});};
  const addTag=()=>{if(tagInput.trim()&&!(task.tags||[]).includes(tagInput.trim())){onUpdate({tags:[...(task.tags||[]),tagInput.trim()]});setTagInput("");}};
  const removeTag=t=>onUpdate({tags:(task.tags||[]).filter(x=>x!==t)});
  return(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{maxWidth:500}} onClick={e=>e.stopPropagation()}>
        <input value={text} onChange={e=>setText(e.target.value)} style={{width:"100%",fontSize:16,fontWeight:600,background:"transparent",border:"none",borderBottom:"1.5px solid var(--border)",outline:"none",color:"var(--ink)",paddingBottom:8,marginBottom:16}} onBlur={save} />
        <textarea value={note} onChange={e=>setNote(e.target.value)} placeholder="Нотатки..." style={{width:"100%",minHeight:80,fontSize:13,background:"var(--sand)",border:"1px solid var(--border)",borderRadius:"var(--r)",padding:"10px 12px",outline:"none",resize:"vertical",color:"var(--ink2)"}} onBlur={save} />
        <div style={{marginTop:12}}>
          <div style={{fontSize:11,fontWeight:600,color:"var(--ink4)",textTransform:"uppercase",letterSpacing:"0.6px",marginBottom:6}}>Теги</div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:8}}>
            {(task.tags||[]).map(t=>(
              <span key={t} style={{display:"flex",alignItems:"center",gap:4,fontSize:12,fontWeight:500,padding:"3px 8px",borderRadius:20,background:"var(--sand2)",color:"var(--ink3)"}}>
                #{t}<button onClick={()=>removeTag(t)} style={{background:"none",border:"none",cursor:"pointer",color:"var(--ink4)",padding:0,fontSize:12,lineHeight:1}}>×</button>
              </span>
            ))}
          </div>
          <div style={{display:"flex",gap:6}}>
            <input value={tagInput} onChange={e=>setTagInput(e.target.value)} placeholder="Новий тег" style={{fontSize:12,padding:"5px 10px",border:"1px solid var(--border)",borderRadius:"var(--r)",background:"var(--sand)",outline:"none",color:"var(--ink)"}} onKeyDown={e=>{if(e.key==="Enter")addTag();}} />
            <button className="btn-ghost" style={{fontSize:12,padding:"5px 10px"}} onClick={addTag}>Додати</button>
          </div>
        </div>
        <div className="modal-actions">
          <button className="btn-ghost" style={{color:"var(--high)"}} onClick={onDelete}><i className="ti ti-trash" style={{fontSize:13,marginRight:4}} />Видалити</button>
          <button className="btn-ghost" onClick={onClose}>Закрити</button>
          <button className="btn-primary" onClick={()=>{save();onClose();}}>Зберегти</button>
        </div>
      </div>
    </div>
  );
}
