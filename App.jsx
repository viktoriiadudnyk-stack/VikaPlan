import { useState, useEffect, useCallback, useRef, forwardRef } from "react";

const VIEWS = { TODAY:"today", UPCOMING:"upcoming", INBOX:"inbox", PROJECTS:"projects", CALENDAR:"calendar", STATS:"stats" };
const P = { HIGH:"high", MED:"med", LOW:"low", NONE:"none" };
const P_LABEL = { high:"High", med:"Medium", low:"Low", none:"No priority" };
const REPEAT_OPT = { none:"Без повтору", daily:"Щодня", weekly:"Щотижня", monthly:"Щомісяця" };
const PROJ_COLORS = ["#5B21B6","#B91C1C","#1D4ED8","#15803D","#B45309","#BE185D","#0E7490","#4D7C0F"];

const gid = () => `${Date.now()}_${Math.random().toString(36).slice(2)}`;
const todayStr = () => new Date().toISOString().split("T")[0];
const fmtDate = d => { if(!d)return""; const dt=new Date(d+"T00:00:00"); return dt.toLocaleDateString("uk-UA",{day:"numeric",month:"short"}); };
const isToday = d => d===todayStr();
const isPast = d => d&&d<todayStr();
const isFuture = d => d&&d>todayStr();

const load = () => { try{ const s=localStorage.getItem("vikaplan_v3"); return s?JSON.parse(s):{tasks:[],projects:[],focusId:null}; }catch{return{tasks:[],projects:[],focusId:null};} };
const persist = s => { try{localStorage.setItem("vikaplan_v3",JSON.stringify(s));}catch{} };

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
  const [calDate, setCalDate] = useState(new Date());
  const [selDay, setSelDay] = useState(null);
  const [taskDetail, setTaskDetail] = useState(null);
  const recogRef = useRef(null);
  const addRef = useRef(null);

  const upd = useCallback(next => { setSt(next); persist(next); }, []);
  const showToast = msg => { setToast(msg); setTimeout(()=>setToast(null),2500); };

  const addTask = fields => {
    const t = {id:gid(),text:"",done:false,priority:P.NONE,date:null,projectId:null,repeat:"none",tags:[],note:"",createdAt:Date.now(),...fields};
    upd({...st,tasks:[...st.tasks,t]});
  };
  const updTask = (id,fields) => upd({...st,tasks:st.tasks.map(t=>t.id===id?{...t,...fields}:t)});
  const delTask = id => { upd({...st,tasks:st.tasks.filter(t=>t.id!==id),focusId:st.focusId===id?null:st.focusId}); setConfirmDel(null); showToast("Задачу видалено"); };
  const toggleDone = id => {
    const t=st.tasks.find(t=>t.id===id);
    if(t.repeat&&t.repeat!=="none"&&!t.done){
      const nd=new Date((t.date||todayStr())+"T00:00:00");
      if(t.repeat==="daily")nd.setDate(nd.getDate()+1);
      if(t.repeat==="weekly")nd.setDate(nd.getDate()+7);
      if(t.repeat==="monthly")nd.setMonth(nd.getMonth()+1);
      const newTask={...t,id:gid(),done:false,date:nd.toISOString().split("T")[0],createdAt:Date.now()};
      upd({...st,tasks:[...st.tasks.map(tk=>tk.id===id?{...tk,done:true}:tk),newTask]});
    } else {
      updTask(id,{done:!t.done});
    }
  };
  const toggleFocus = id => upd({...st,focusId:st.focusId===id?null:id});

  const addProj = () => {
    const p={id:gid(),name:"Новий проєкт",color:PROJ_COLORS[st.projects.length%PROJ_COLORS.length]};
    upd({...st,projects:[...st.projects,p]});
    setSelProj(p.id); setView(VIEWS.PROJECTS); setEditingProj(p.id); setSidebarOpen(false);
  };
  const updProj = (id,fields) => upd({...st,projects:st.projects.map(p=>p.id===id?{...p,...fields}:p)});
  const delProj = id => {
    upd({...st,projects:st.projects.filter(p=>p.id!==id),tasks:st.tasks.map(t=>t.projectId===id?{...t,projectId:null}:t)});
    setConfirmDel(null); if(selProj===id){setSelProj(null);setView(VIEWS.PROJECTS);} showToast("Проєкт видалено");
  };

  const startVoice = () => {
    const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
    if(!SR){showToast("Браузер не підтримує голосовий ввід");return;}
    setVoiceModal(true); setTranscript(""); setRecording(true);
    const r=new SR(); r.lang="uk-UA"; r.continuous=false; r.interimResults=true;
    r.onresult=e=>{setTranscript(Array.from(e.results).map(r=>r[0].transcript).join(" "));};
    r.onend=()=>setRecording(false);
    r.onerror=()=>{setRecording(false);showToast("Помилка мікрофону");};
    r.start(); recogRef.current=r;
  };
  const stopVoice = () => { recogRef.current?.stop(); setRecording(false); };
  const processVoice = async () => {
    if(!transcript.trim())return;
    setAiLoading(true);
    try {
      const res=await fetch("https://api.anthropic.com/v1/messages",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({model:"claude-sonnet-4-6",max_tokens:1000,
          system:`Ти — AI-планувальник. Витягни задачі з тексту. Повернути ТІЛЬКИ JSON масив без жодного іншого тексту. Кожен елемент: text (коротко, українською), priority ("high"|"med"|"low"|"none"), date ("YYYY-MM-DD" або null, сьогодні=${todayStr()}). Мінімум 1, максимум 8.`,
          messages:[{role:"user",content:transcript}]})
      });
      const data=await res.json();
      const raw=data.content?.[0]?.text?.trim()||"[]";
      let tasks; try{tasks=JSON.parse(raw);}catch{tasks=[];}
      if(tasks.length){
        const nt=tasks.map(t=>({id:gid(),text:t.text||"Задача",done:false,priority:t.priority||P.NONE,date:t.date||null,projectId:null,repeat:"none",tags:[],note:"",createdAt:Date.now()}));
        upd({...st,tasks:[...st.tasks,...nt]});
        showToast(`Додано ${nt.length} задач${nt.length===1?"у":nt.length<5?"и":""}`);
        setView(VIEWS.INBOX); setVoiceModal(false); setTranscript("");
      } else showToast("Не вдалось розпізнати задачі");
    } catch{showToast("Помилка AI");}
    setAiLoading(false);
  };

  const filterFn = tasks => filterPriority==="all"?tasks:tasks.filter(t=>t.priority===filterPriority);
  const todayTasks = filterFn(st.tasks.filter(t=>isToday(t.date)||(!t.done&&isPast(t.date))));
  const upcomingTasks = filterFn(st.tasks.filter(t=>isFuture(t.date)));
  const inboxTasks = filterFn(st.tasks.filter(t=>!t.date&&!t.projectId));
  const focusTask = st.focusId?st.tasks.find(t=>t.id===st.focusId):null;

  const calDays = () => {
    const y=calDate.getFullYear(),m=calDate.getMonth();
    const first=new Date(y,m,1).getDay(),offset=first===0?6:first-1;
    const days=[];
    for(let i=0;i<offset;i++)days.push(null);
    const dc=new Date(y,m+1,0).getDate();
    for(let d=1;d<=dc;d++)days.push(`${y}-${String(m+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`);
    while(days.length%7!==0)days.push(null);
    return days;
  };

  const nav = (v,proj=null) => { setView(v); setSelProj(proj); setSidebarOpen(false); };

  const allTags = [...new Set(st.tasks.flatMap(t=>t.tags||[]))];
  const total=st.tasks.length,done=st.tasks.filter(t=>t.done).length;
  const overdue=st.tasks.filter(t=>!t.done&&isPast(t.date)).length;
  const todayCount=st.tasks.filter(t=>isToday(t.date)&&!t.done).length;
  const pct=total>0?Math.round(done/total*100):0;

  const renderTask = task => {
    const proj=st.projects.find(p=>p.id===task.projectId);
    const isFocused=st.focusId===task.id;
    return (
      <div key={task.id} className={`task-card${task.done?" done":""}${isFocused?" is-focus":""}`}>
        <button className={`check-btn${task.done?" checked":""} ${task.priority==="high"?"ph":task.priority==="med"?"pm":task.priority==="low"?"pl":""}`}
          onClick={()=>toggleDone(task.id)} aria-label="Виконано">
          {task.done&&<i className="ti ti-check" />}
        </button>
        <div className="task-body" onClick={()=>setTaskDetail(task)}>
          {editingTask===task.id
            ?<input className="task-edit-input" autoFocus defaultValue={task.text}
                onBlur={e=>{updTask(task.id,{text:e.target.value});setEditingTask(null);}}
                onKeyDown={e=>{if(e.key==="Enter")e.target.blur();if(e.key==="Escape")setEditingTask(null);}}
                onClick={e=>e.stopPropagation()} />
            :<span className={`task-text${task.done?" done":""}`}>{task.text||"Без назви"}</span>
          }
          <div className="task-meta">
            {task.priority!==P.NONE&&<span className={`tag tag-${task.priority}`}>{P_LABEL[task.priority]}</span>}
            {task.date&&<span className={`tag ${!task.done&&isPast(task.date)?"tag-overdue":"tag-date"}`}><i className="ti ti-calendar" style={{fontSize:10,marginRight:3}}/>{fmtDate(task.date)}</span>}
            {task.repeat&&task.repeat!=="none"&&<span className="tag tag-repeat"><i className="ti ti-refresh" style={{fontSize:10,marginRight:3}}/>{REPEAT_OPT[task.repeat]}</span>}
            {proj&&<span className="tag tag-proj" style={{background:proj.color}}>{proj.name}</span>}
            {(task.tags||[]).map(tg=><span key={tg} className="tag tag-custom">#{tg}</span>)}
          </div>
        </div>
        <div className="task-actions">
          <button className={`tact-btn${isFocused?" focus-on":""}`} title={isFocused?"Прибрати фокус":"Встановити фокус дня"}
            onClick={e=>{e.stopPropagation();toggleFocus(task.id);}}>
            <i className={`ti ${isFocused?"ti-bolt-off":"ti-bolt"}`} style={{fontSize:14}} />
          </button>
          <button className="tact-btn" title="Редагувати" onClick={e=>{e.stopPropagation();setEditingTask(task.id);}}>
            <i className="ti ti-edit" style={{fontSize:14}} />
          </button>
          <TaskMenu task={task} projects={st.projects} onUpdate={f=>updTask(task.id,f)} onDelete={()=>setConfirmDel({type:"task",id:task.id})} />
        </div>
      </div>
    );
  };

  const renderAdd = (defaults={}) => {
    const key=JSON.stringify(defaults);
    if(addingTo!==key) return(
      <button className="add-task-btn" onClick={()=>{setAddingTo(key);setTimeout(()=>addRef.current?.focus(),40);}}>
        <i className="ti ti-plus" style={{fontSize:15}}/> Додати задачу
      </button>
    );
    return <AddForm ref={addRef} defaults={defaults} projects={st.projects} onAdd={f=>{addTask(f);setAddingTo(null);}} onCancel={()=>setAddingTo(null)} />;
  };

  const FilterBar = () => (
    <div className="filter-bar">
      {["all","high","med","low"].map(p=>(
        <button key={p} className={`fchip${filterPriority===p?" on":""}`} onClick={()=>setFilterPriority(p)}>
          {p==="all"?"Всі":P_LABEL[p]}
        </button>
      ))}
    </div>
  );

  const [focusPicker, setFocusPicker] = useState(false);
  const availForFocus = st.tasks.filter(t => !t.done);

  return (
    <div className="app">
      <div className="mobile-bar">
        <button className="hamburger" onClick={()=>setSidebarOpen(v=>!v)}><i className="ti ti-menu-2" style={{fontSize:20}}/></button>
        <span style={{fontSize:15,fontWeight:700,letterSpacing:"-0.3px"}}>Vika Plan</span>
      </div>
      {sidebarOpen&&<div className="overlay" onClick={()=>setSidebarOpen(false)}/>}

      <aside className={`sidebar${sidebarOpen?" open":""}`}>
        <div className="sidebar-logo">
          <div className="logo-icon"><i className="ti ti-bolt"/></div>
          <span className="logo-text">Vika Plan</span>
        </div>
        <div className="nav-group">
          {[
            {id:VIEWS.TODAY,icon:"ti-sun",label:"Сьогодні",count:todayTasks.filter(t=>!t.done).length},
            {id:VIEWS.UPCOMING,icon:"ti-calendar",label:"Заплановано",count:upcomingTasks.filter(t=>!t.done).length},
            {id:VIEWS.INBOX,icon:"ti-inbox",label:"Inbox",count:inboxTasks.filter(t=>!t.done).length},
            {id:VIEWS.CALENDAR,icon:"ti-calendar-month",label:"Календар"},
            {id:VIEWS.STATS,icon:"ti-chart-bar",label:"Прогрес"},
          ].map(item=>(
            <button key={item.id} className={`nav-btn${view===item.id&&!selProj?" active":""}`} onClick={()=>nav(item.id)}>
              <i className={`ti ${item.icon}`} aria-hidden/>
              <span className="nav-btn-label">{item.label}</span>
              {item.count>0&&<span className="nav-badge">{item.count}</span>}
            </button>
          ))}
        </div>
        <div className="nav-group">
          <div className="sidebar-section-header">
            <span>Проєкти</span>
            <button className="icon-btn" onClick={addProj} style={{width:24,height:24,borderRadius:6}} title="Новий проєкт"><i className="ti ti-plus" style={{fontSize:13}}/></button>
          </div>
          {st.projects.map(p=>(
            <button key={p.id} className={`proj-item${selProj===p.id?" active":""}`} onClick={()=>nav(VIEWS.PROJECTS,p.id)}>
              <div className="proj-dot" style={{background:p.color}}/>
              <span className="proj-label">
                {editingProj===p.id
                  ?<input autoFocus defaultValue={p.name}
                      onBlur={e=>{updProj(p.id,{name:e.target.value});setEditingProj(null);}}
                      onKeyDown={e=>{if(e.key==="Enter"||e.key==="Escape")e.target.blur();}}
                      style={{background:"transparent",border:"none",outline:"none",fontSize:13,fontWeight:600,color:"var(--ink)",width:"100%",padding:0}}
                      onClick={e=>e.stopPropagation()} />
                  :p.name
                }
              </span>
              <span className="proj-count">{st.tasks.filter(t=>t.projectId===p.id&&!t.done).length||""}</span>
            </button>
          ))}
          {st.projects.length===0&&<div style={{padding:"4px 8px",fontSize:12,color:"var(--ink4)"}}>Натисни + щоб додати</div>}
        </div>
      </aside>

      <div className="main">
        <div className="topbar">
          <div>
            <h1 className="page-title">{
              view===VIEWS.TODAY?"Сьогодні":view===VIEWS.UPCOMING?"Заплановано":
              view===VIEWS.INBOX?"Inbox":view===VIEWS.CALENDAR?"Календар":
              view===VIEWS.STATS?"Прогрес":
              selProj?st.projects.find(p=>p.id===selProj)?.name||"Проєкт":"Проєкти"
            }</h1>
            {view===VIEWS.TODAY&&<p className="page-sub">{new Date().toLocaleDateString("uk-UA",{weekday:"long",day:"numeric",month:"long"})}</p>}
          </div>
          <div style={{display:"flex",gap:8,paddingTop:4}}>
            {view===VIEWS.PROJECTS&&selProj&&<>
              <button className="icon-btn" onClick={()=>setEditingProj(selProj)} title="Перейменувати"><i className="ti ti-edit" style={{fontSize:14}}/></button>
              <button className="icon-btn" style={{color:"var(--high)"}} onClick={()=>setConfirmDel({type:"project",id:selProj})}><i className="ti ti-trash" style={{fontSize:14}}/></button>
            </>}
          </div>
        </div>

        <div className="content">
          {view!==VIEWS.STATS&&view!==VIEWS.CALENDAR&&(
            <div className="focus-card">
              <div className="focus-glow"/>
              <div className="focus-icon"><i className="ti ti-bolt"/></div>
              <div className="focus-body">
                <div className="focus-label">Фокус дня</div>
                {focusTask
                  ?<div className="focus-text">{focusTask.text}</div>
                  :<div className="focus-empty">Обери задачу нижче або натисни ⚡</div>
                }
              </div>
              <div style={{display:"flex",gap:6,flexShrink:0}}>
                {focusTask&&<button className="focus-btn" onClick={()=>toggleFocus(focusTask.id)}>Зняти</button>}
                <button className="focus-btn set" onClick={()=>setFocusPicker(v=>!v)}>
                  {focusPicker?"Закрити":"Обрати"}
                </button>
              </div>
            </div>
          )}
          {focusPicker&&view!==VIEWS.STATS&&view!==VIEWS.CALENDAR&&(
            <div style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:"var(--r-lg)",padding:"8px",marginBottom:16,boxShadow:"var(--shadow-sm)"}}>
              {availForFocus.length===0&&<div style={{padding:"10px 8px",fontSize:13,color:"var(--ink4)"}}>Немає активних задач</div>}
              {availForFocus.map(t=>(
                <button key={t.id} onClick={()=>{toggleFocus(t.id);setFocusPicker(false);}}
                  style={{display:"flex",alignItems:"center",gap:10,width:"100%",padding:"8px 10px",borderRadius:8,background:st.focusId===t.id?"var(--focus-bg)":"none",border:"none",cursor:"pointer",textAlign:"left"}}>
                  <i className={`ti ${st.focusId===t.id?"ti-bolt-off":"ti-bolt"}`} style={{fontSize:14,color:st.focusId===t.id?"var(--focus-color)":"var(--ink4)",flexShrink:0}}/>
                  <span style={{fontSize:13,fontWeight:500,color:"var(--ink)",flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.text||"Без назви"}</span>
                  {t.priority!==P.NONE&&<span style={{fontSize:11,fontWeight:600,color:t.priority==="high"?"var(--high)":t.priority==="med"?"var(--med)":"var(--low)"}}>{P_LABEL[t.priority]}</span>}
                </button>
              ))}
            </div>
          )}

          {view===VIEWS.TODAY&&<><FilterBar/><TaskListView tasks={todayTasks} renderTask={renderTask} renderAdd={()=>renderAdd({date:todayStr()})} emptyMsg="Сьогодні все виконано 🎉"/></>}
          {view===VIEWS.UPCOMING&&<><FilterBar/><UpcomingView tasks={upcomingTasks} renderTask={renderTask} renderAdd={()=>renderAdd({})}/></>}
          {view===VIEWS.INBOX&&<><FilterBar/><TaskListView tasks={inboxTasks} renderTask={renderTask} renderAdd={()=>renderAdd({})} emptyMsg="Inbox порожній ✓"/></>}

          {view===VIEWS.PROJECTS&&selProj&&(()=>{
            const proj=st.projects.find(p=>p.id===selProj);
            if(!proj)return null;
            const pt=filterFn(st.tasks.filter(t=>t.projectId===selProj));
            return<>
              <div style={{display:"flex",gap:7,marginBottom:18,flexWrap:"wrap"}}>
                {PROJ_COLORS.map(c=><button key={c} onClick={()=>updProj(selProj,{color:c})} style={{width:20,height:20,borderRadius:"50%",background:c,border:proj.color===c?"2.5px solid var(--ink)":"none",padding:0}}/>)}
              </div>
              <FilterBar/>
              <TaskListView tasks={pt} renderTask={renderTask} renderAdd={()=>renderAdd({projectId:selProj})} emptyMsg="Задач немає — додай першу"/>
            </>;
          })()}

          {view===VIEWS.PROJECTS&&!selProj&&<div style={{display:"grid",gap:8,marginTop:8}}>
            {st.projects.length===0&&<div className="empty"><i className="ti ti-folders"/><p>Проєктів немає</p></div>}
            {st.projects.map(p=>{
              const c=st.tasks.filter(t=>t.projectId===p.id&&!t.done).length;
              return<div key={p.id} style={{display:"flex",alignItems:"center",gap:12,padding:"13px 15px",background:"var(--surface)",border:"1px solid var(--border)",borderRadius:"var(--r-lg)",cursor:"pointer",boxShadow:"var(--shadow-xs)"}} onClick={()=>nav(VIEWS.PROJECTS,p.id)}>
                <div style={{width:9,height:9,borderRadius:"50%",background:p.color}}/>
                <span style={{flex:1,fontSize:14,fontWeight:600}}>{p.name}</span>
                {c>0&&<span style={{fontSize:12,color:"var(--ink4)"}}>{c}</span>}
                <i className="ti ti-chevron-right" style={{fontSize:13,color:"var(--ink4)"}}/>
              </div>;
            })}
            <button style={{display:"flex",alignItems:"center",gap:8,padding:"13px 15px",background:"transparent",border:"1.5px dashed var(--border2)",borderRadius:"var(--r-lg)",color:"var(--ink4)",fontSize:13,fontWeight:500}} onClick={addProj}>
              <i className="ti ti-plus" style={{fontSize:15}}/> Новий проєкт
            </button>
          </div>}

          {view===VIEWS.CALENDAR&&<CalView tasks={st.tasks} calDate={calDate} setCalDate={setCalDate} calDays={calDays} selDay={selDay} setSelDay={setSelDay} renderTask={renderTask} renderAdd={renderAdd}/>}
          {view===VIEWS.STATS&&<StatsView tasks={st.tasks} projects={st.projects} total={total} done={done} overdue={overdue} todayCount={todayCount} pct={pct}/>}
        </div>
      </div>

      <button className={`voice-fab${recording?" rec":""}`} onClick={recording?stopVoice:startVoice} aria-label="Голосовий ввід">
        <i className={`ti ${recording?"ti-microphone-off":"ti-microphone"}`} style={{fontSize:20}}/>
      </button>

      {voiceModal&&<div className="vmodal-bg" onClick={()=>{stopVoice();setVoiceModal(false);}}>
        <div className="vmodal" onClick={e=>e.stopPropagation()}>
          <div className="vmodal-title">🎙 Голосовий ввід</div>
          <div className="vmodal-sub">Говори — AI розбере на задачі автоматично</div>
          {recording&&<div className="wave">{[0,1,2,3,4].map(i=><div key={i} className="wave-bar" style={{animationDelay:`${i*0.12}s`}}/>)}</div>}
          <div className="vtranscript" style={{color:transcript?"var(--ink2)":"var(--ink4)",fontStyle:transcript?"normal":"italic"}}>
            {transcript||"Натисни мікрофон внизу і говори..."}
          </div>
          <div className="vactions">
            <button className="btn-secondary" onClick={()=>{stopVoice();setVoiceModal(false);}}>Скасувати</button>
            {!recording&&<button className="btn-secondary" onClick={startVoice}><i className="ti ti-microphone" style={{fontSize:13,marginRight:5}}/>Ще раз</button>}
            {transcript&&<button className="btn-primary" onClick={processVoice} disabled={aiLoading}>{aiLoading?"Аналізую...":"Розбити на задачі"}</button>}
          </div>
        </div>
      </div>}

      {taskDetail&&<TaskDetailModal task={taskDetail} projects={st.projects} onUpdate={f=>{updTask(taskDetail.id,f);setTaskDetail({...taskDetail,...f});}} onClose={()=>setTaskDetail(null)} onDelete={()=>{delTask(taskDetail.id);setTaskDetail(null);}}/>}

      {confirmDel&&<div className="modal-bg" onClick={()=>setConfirmDel(null)}>
        <div className="modal" onClick={e=>e.stopPropagation()}>
          <div className="modal-title">Видалити?</div>
          <div className="modal-sub">{confirmDel.type==="project"?"Проєкт видалиться. Задачі залишаться в Inbox.":"Задачу буде видалено назавжди."}</div>
          <div className="modal-actions">
            <button className="btn-secondary" onClick={()=>setConfirmDel(null)}>Скасувати</button>
            <button className="btn-danger" onClick={()=>confirmDel.type==="project"?delProj(confirmDel.id):delTask(confirmDel.id)}>Видалити</button>
          </div>
        </div>
      </div>}

      {toast&&<div className="toast">{toast}</div>}
    </div>
  );
}

const AddForm = forwardRef(({defaults,projects,onAdd,onCancel},ref) => {
  const [text,setText]=useState("");
  const [priority,setPriority]=useState(P.NONE);
  const [date,setDate]=useState(defaults.date||"");
  const [projId,setProjId]=useState(defaults.projectId||"");
  const [repeat,setRepeat]=useState("none");
  const submit=()=>{ if(text.trim()){onAdd({text:text.trim(),priority,date:date||null,projectId:projId||null,repeat,...defaults});setText("");}else onCancel(); };
  return(
    <div className="add-form">
      <input ref={ref} type="text" value={text} onChange={e=>setText(e.target.value)} placeholder="Назва задачі..."
        onKeyDown={e=>{if(e.key==="Enter"&&text.trim())submit();if(e.key==="Escape")onCancel();}} />
      <div className="form-row">
        <select className="form-select" value={priority} onChange={e=>setPriority(e.target.value)}>
          {Object.entries(P_LABEL).map(([k,v])=><option key={k} value={k}>{v}</option>)}
        </select>
        <input className="form-date" type="date" value={date} onChange={e=>setDate(e.target.value)}/>
        {projects.length>0&&<select className="form-select" value={projId} onChange={e=>setProjId(e.target.value)}>
          <option value="">Без проєкту</option>
          {projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
        </select>}
        <select className="form-select" value={repeat} onChange={e=>setRepeat(e.target.value)}>
          {Object.entries(REPEAT_OPT).map(([k,v])=><option key={k} value={k}>{v}</option>)}
        </select>
        <div className="form-actions">
          <button className="btn-secondary" onClick={onCancel}>Скасувати</button>
          <button className="btn-primary" onClick={submit} disabled={!text.trim()}>Додати</button>
        </div>
      </div>
    </div>
  );
});

function TaskListView({tasks,renderTask,renderAdd,emptyMsg}){
  const active=tasks.filter(t=>!t.done),done=tasks.filter(t=>t.done);
  const [showDone,setShowDone]=useState(false);
  return<>
    {active.length===0&&done.length===0&&<div className="empty"><i className="ti ti-checks"/><p>{emptyMsg}</p></div>}
    <div className="task-list">{active.map(t=>renderTask(t))}</div>
    {renderAdd&&renderAdd()}
    {done.length>0&&<div style={{marginTop:8}}>
      <button className="done-toggle" onClick={()=>setShowDone(v=>!v)}>
        <i className={`ti ${showDone?"ti-chevron-down":"ti-chevron-right"}`} style={{fontSize:12}}/>
        Виконані ({done.length})
      </button>
      {showDone&&<div className="task-list" style={{marginTop:6}}>{done.map(t=>renderTask(t))}</div>}
    </div>}
  </>;
}

function UpcomingView({tasks,renderTask,renderAdd}){
  const groups={};
  tasks.forEach(t=>{if(!groups[t.date])groups[t.date]=[];groups[t.date].push(t);});
  const sorted=Object.keys(groups).sort();
  return<>
    {sorted.length===0&&<div className="empty"><i className="ti ti-calendar-off"/><p>Немає запланованих задач</p></div>}
    {sorted.map(date=><div key={date} style={{marginBottom:22}}>
      <div className="section-head">
        <span className="section-title">{new Date(date+"T00:00:00").toLocaleDateString("uk-UA",{weekday:"long",day:"numeric",month:"long"})}</span>
        <span className="section-count">{groups[date].filter(t=>!t.done).length}</span>
      </div>
      <div className="task-list">{groups[date].map(t=>renderTask(t))}</div>
    </div>)}
    <div style={{marginTop:8}}>{renderAdd&&renderAdd()}</div>
  </>;
}

function CalView({tasks,calDate,setCalDate,calDays,selDay,setSelDay,renderTask,renderAdd}){
  const days=calDays();
  const DAYS=["Пн","Вт","Ср","Чт","Пт","Сб","Нд"];
  const selTasks=selDay?tasks.filter(t=>t.date===selDay):[];
  return<>
    <div className="cal-nav">
      <button className="icon-btn" onClick={()=>{const d=new Date(calDate);d.setMonth(d.getMonth()-1);setCalDate(d);}}><i className="ti ti-chevron-left" style={{fontSize:14}}/></button>
      <span className="cal-title">{calDate.toLocaleDateString("uk-UA",{month:"long",year:"numeric"})}</span>
      <button className="icon-btn" onClick={()=>{const d=new Date(calDate);d.setMonth(d.getMonth()+1);setCalDate(d);}}><i className="ti ti-chevron-right" style={{fontSize:14}}/></button>
    </div>
    <div className="cal-grid">
      {DAYS.map(d=><div key={d} className="cal-dh">{d}</div>)}
      {days.map((date,i)=>{
        if(!date)return<div key={i}/>;
        const has=tasks.some(t=>t.date===date);
        return<div key={date} className={`cal-day${isToday(date)?" today":""}${selDay===date?" sel":""}${has?" has":""}`}
          onClick={()=>setSelDay(selDay===date?null:date)}>
          {parseInt(date.split("-")[2])}
        </div>;
      })}
    </div>
    {selDay&&<>
      <div className="section-head" style={{marginBottom:8}}>
        <span className="section-title">{new Date(selDay+"T00:00:00").toLocaleDateString("uk-UA",{weekday:"long",day:"numeric",month:"long"})}</span>
      </div>
      <div className="task-list">{selTasks.map(t=>renderTask(t))}</div>
      {renderAdd({date:selDay})}
    </>}
  </>;
}

function StatsView({tasks,projects,total,done,overdue,todayCount,pct}){
  const r=38,circ=2*Math.PI*r,offset=circ*(1-pct/100);
  const bp={high:tasks.filter(t=>t.priority==="high"&&!t.done).length,med:tasks.filter(t=>t.priority==="med"&&!t.done).length,low:tasks.filter(t=>t.priority==="low"&&!t.done).length};
  return<>
    <div className="stats-row">
      {[{n:total,l:"Всього"},{n:done,l:"Виконано"},{n:overdue,l:"Прострочено"},{n:todayCount,l:"На сьогодні"}].map(({n,l})=>(
        <div key={l} className="stat-card">
          <div className="stat-num">{n}</div>
          <div className="stat-lbl">{l}</div>
          {total>0&&<div className="stat-bar"><div className="stat-bar-fill" style={{width:`${Math.round(n/total*100)}%`}}/></div>}
        </div>
      ))}
    </div>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:20}}>
      <div className="stat-card" style={{display:"flex",alignItems:"center",gap:18}}>
        <svg width="90" height="90" viewBox="0 0 90 90" className="prog-ring">
          <circle className="prog-track" cx="45" cy="45" r={r} strokeWidth="7"/>
          <circle className="prog-fill" cx="45" cy="45" r={r} strokeWidth="7" strokeDasharray={circ} strokeDashoffset={offset} style={{transform:"rotate(-90deg)",transformOrigin:"50% 50%"}}/>
          <text x="45" y="50" textAnchor="middle" fontSize="16" fontWeight="700" fill="var(--ink)" style={{transform:"rotate(90deg)",transformOrigin:"50% 50%"}}>{pct}%</text>
        </svg>
        <div><div className="stat-num">{pct}%</div><div className="stat-lbl">Загальний прогрес</div></div>
      </div>
      <div className="stat-card">
        <div className="stat-lbl" style={{marginBottom:10}}>За пріоритетом</div>
        {[["Терміново",bp.high,"var(--high)"],["Середній",bp.med,"var(--med)"],["Низький",bp.low,"var(--low)"]].map(([l,c,col])=>(
          <div key={l} style={{display:"flex",alignItems:"center",gap:8,marginBottom:7}}>
            <div style={{width:7,height:7,borderRadius:"50%",background:col,flexShrink:0}}/>
            <span style={{fontSize:12,flex:1,color:"var(--ink2)"}}>{l}</span>
            <span style={{fontSize:13,fontWeight:700}}>{c}</span>
          </div>
        ))}
      </div>
    </div>
    {projects.length>0&&<>
      <div className="section-head"><span className="section-title">По проєктах</span></div>
      <div style={{display:"grid",gap:8,marginTop:8}}>
        {projects.map(p=>{
          const pt=tasks.filter(t=>t.projectId===p.id),pd=pt.filter(t=>t.done).length,pp=pt.length>0?Math.round(pd/pt.length*100):0;
          return<div key={p.id} className="stat-card" style={{padding:"11px 14px"}}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:7}}>
              <div style={{width:7,height:7,borderRadius:"50%",background:p.color}}/>
              <span style={{fontWeight:600,fontSize:13,flex:1}}>{p.name}</span>
              <span style={{fontSize:11,color:"var(--ink4)"}}>{pd}/{pt.length}</span>
            </div>
            <div className="stat-bar"><div className="stat-bar-fill" style={{width:`${pp}%`,background:p.color}}/></div>
          </div>;
        })}
      </div>
    </>}
  </>;
}

function TaskMenu({task,projects,onUpdate,onDelete}){
  const [open,setOpen]=useState(false);
  const ref=useRef(null);
  useEffect(()=>{
    if(!open)return;
    const h=e=>{if(!ref.current?.contains(e.target))setOpen(false);};
    document.addEventListener("mousedown",h);
    return()=>document.removeEventListener("mousedown",h);
  },[open]);
  const d=(n)=>{const d=new Date();d.setDate(d.getDate()+n);return d.toISOString().split("T")[0];};
  return<div className="dd-wrap" ref={ref}>
    <button className="tact-btn" onClick={e=>{e.stopPropagation();setOpen(v=>!v);}} aria-label="Ще">
      <i className="ti ti-dots" style={{fontSize:14}}/>
    </button>
    {open&&<div className="dd-menu" onClick={e=>e.stopPropagation()}>
      <div className="dd-lbl">Пріоритет</div>
      {Object.entries(P_LABEL).map(([k,v])=>(
        <button key={k} className={`dd-btn${task.priority===k?" active":""}`} onClick={()=>{onUpdate({priority:k});setOpen(false);}}>
          <i className="ti ti-flag" style={{fontSize:12,color:k==="high"?"var(--high)":k==="med"?"var(--med)":k==="low"?"var(--low)":"var(--ink4)"}}/>{v}
          {task.priority===k&&<i className="ti ti-check" style={{fontSize:11,marginLeft:"auto"}}/>}
        </button>
      ))}
      <div className="dd-sep"/>
      <div className="dd-lbl">Дата</div>
      {[["Сьогодні","ti-sun",0],["Завтра","ti-calendar",1],["Тиждень","ti-calendar-week",7]].map(([l,ic,n])=>(
        <button key={l} className="dd-btn" onClick={()=>{onUpdate({date:d(n)});setOpen(false);}}><i className={`ti ${ic}`} style={{fontSize:12}}/>{l}</button>
      ))}
      {task.date&&<button className="dd-btn" onClick={()=>{onUpdate({date:null});setOpen(false);}}><i className="ti ti-x" style={{fontSize:12}}/>Прибрати дату</button>}
      <div className="dd-sep"/>
      <div className="dd-lbl">Повтор</div>
      {Object.entries(REPEAT_OPT).map(([k,v])=>(
        <button key={k} className={`dd-btn${task.repeat===k?" active":""}`} onClick={()=>{onUpdate({repeat:k});setOpen(false);}}><i className="ti ti-refresh" style={{fontSize:12}}/>{v}</button>
      ))}
      {projects.length>0&&<><div className="dd-sep"/><div className="dd-lbl">Проєкт</div>
      {projects.map(p=>(
        <button key={p.id} className={`dd-btn${task.projectId===p.id?" active":""}`} onClick={()=>{onUpdate({projectId:task.projectId===p.id?null:p.id});setOpen(false);}}>
          <div style={{width:7,height:7,borderRadius:"50%",background:p.color,flexShrink:0}}/>{p.name}
          {task.projectId===p.id&&<i className="ti ti-check" style={{fontSize:11,marginLeft:"auto"}}/>}
        </button>
      ))}</>}
      <div className="dd-sep"/>
      <button className="dd-btn red" onClick={()=>{onDelete();setOpen(false);}}><i className="ti ti-trash" style={{fontSize:12}}/>Видалити</button>
    </div>}
  </div>;
}

function TaskDetailModal({task,projects,onUpdate,onClose,onDelete}){
  const [text,setText]=useState(task.text);
  const [note,setNote]=useState(task.note||"");
  const [tagInput,setTagInput]=useState("");
  const save=()=>onUpdate({text,note});
  const addTag=()=>{if(tagInput.trim()&&!(task.tags||[]).includes(tagInput.trim())){onUpdate({tags:[...(task.tags||[]),tagInput.trim()]});setTagInput("");}};
  return<div className="modal-bg" onClick={onClose}>
    <div className="modal" style={{maxWidth:480}} onClick={e=>e.stopPropagation()}>
      <input value={text} onChange={e=>setText(e.target.value)} onBlur={save}
        style={{width:"100%",fontSize:16,fontWeight:700,background:"transparent",border:"none",borderBottom:"1.5px solid var(--border)",outline:"none",color:"var(--ink)",paddingBottom:8,marginBottom:14,letterSpacing:"-0.2px"}}/>
      <textarea value={note} onChange={e=>setNote(e.target.value)} onBlur={save} placeholder="Нотатки..."
        style={{width:"100%",minHeight:72,fontSize:13,background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:"var(--r)",padding:"9px 11px",outline:"none",resize:"vertical",color:"var(--ink2)"}}/>
      <div style={{marginTop:12}}>
        <div style={{fontSize:10,fontWeight:700,color:"var(--ink4)",textTransform:"uppercase",letterSpacing:"0.7px",marginBottom:6}}>Теги</div>
        <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:8}}>
          {(task.tags||[]).map(t=>(
            <span key={t} style={{display:"flex",alignItems:"center",gap:3,fontSize:12,fontWeight:600,padding:"2px 8px",borderRadius:20,background:"var(--surface2)",color:"var(--ink3)"}}>
              #{t}<button onClick={()=>onUpdate({tags:(task.tags||[]).filter(x=>x!==t)})} style={{background:"none",border:"none",cursor:"pointer",color:"var(--ink4)",padding:0,lineHeight:1,fontSize:13}}>×</button>
            </span>
          ))}
        </div>
        <div style={{display:"flex",gap:6}}>
          <input value={tagInput} onChange={e=>setTagInput(e.target.value)} placeholder="Новий тег"
            style={{fontSize:12,padding:"5px 9px",border:"1px solid var(--border)",borderRadius:7,background:"var(--surface2)",outline:"none",color:"var(--ink)",flex:1}}
            onKeyDown={e=>{if(e.key==="Enter")addTag();}}/>
          <button className="btn-secondary" style={{fontSize:12,padding:"5px 10px"}} onClick={addTag}>Додати</button>
        </div>
      </div>
      <div className="modal-actions">
        <button className="btn-secondary" style={{color:"var(--high)",marginRight:"auto"}} onClick={onDelete}><i className="ti ti-trash" style={{fontSize:12,marginRight:4}}/>Видалити</button>
        <button className="btn-secondary" onClick={onClose}>Закрити</button>
        <button className="btn-primary" onClick={()=>{save();onClose();}}>Зберегти</button>
      </div>
    </div>
  </div>;
}
