import { useState, useCallback, useRef, forwardRef, useEffect } from "react";

const VIEWS = { TODAY:"today", UPCOMING:"upcoming", INBOX:"inbox", PRIVATE:"private", PROJECTS:"projects", CALENDAR:"calendar", STATS:"stats" };
const P = { HIGH:"high", MED:"med", LOW:"low", NONE:"none" };
const P_LABEL = { high:"High", med:"Medium", low:"Low", none:"No priority" };
const REPEAT_OPT = { none:"No repeat", daily:"Daily", weekly:"Weekly", monthly:"Monthly" };
const PROJ_COLORS = ["#6C47FF","#E53E3E","#2563EB","#0FA884","#D97706","#BE185D","#0E7490","#65A30D"];

const QUOTES = [
  { text: "The secret of getting ahead is getting started.", author: "Mark Twain" },
  { text: "Focus on being productive instead of busy.", author: "Tim Ferriss" },
  { text: "Small daily improvements lead to stunning results.", author: "Robin Sharma" },
  { text: "Do the hard work, especially when you don't feel like it.", author: "Seth Godin" },
  { text: "You don't have to be great to start, but you have to start to be great.", author: "Zig Ziglar" },
  { text: "One day or day one. You decide.", author: "Unknown" },
  { text: "Done is better than perfect.", author: "Sheryl Sandberg" },
];

const gid = () => `${Date.now()}_${Math.random().toString(36).slice(2)}`;
const todayStr = () => new Date().toISOString().split("T")[0];
const fmtDate = d => { if(!d)return""; const dt=new Date(d+"T00:00:00"); return dt.toLocaleDateString("en-US",{day:"numeric",month:"short"}); };
const isToday = d => d===todayStr();
const isPast = d => d&&d<todayStr();
const isFuture = d => d&&d>todayStr();
const load = () => { try{ const s=localStorage.getItem("vikaplan_v5"); return s?JSON.parse(s):{tasks:[],projects:[],focus:{text:"",done:false}}; }catch{return{tasks:[],projects:[],focus:{text:"",done:false}};} };
const persist = s => { try{localStorage.setItem("vikaplan_v5",JSON.stringify(s));}catch{} };
const quote = QUOTES[new Date().getDay()%QUOTES.length];

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
  const [editingFocus, setEditingFocus] = useState(false);
  const [focusDraft, setFocusDraft] = useState("");
  const recogRef = useRef(null);
  const addRef = useRef(null);
  const focusRef = useRef(null);

  const upd = useCallback(next => { setSt(next); persist(next); }, []);
  const showToast = msg => { setToast(msg); setTimeout(()=>setToast(null),2500); };

  const startEditFocus = () => { setFocusDraft(st.focus?.text||""); setEditingFocus(true); setTimeout(()=>focusRef.current?.focus(),40); };
  const saveFocus = () => { upd({...st,focus:{text:focusDraft.trim(),done:false}}); setEditingFocus(false); };
  const clearFocus = () => { upd({...st,focus:{text:"",done:false}}); setEditingFocus(false); };
  const toggleFocusDone = () => upd({...st,focus:{...st.focus,done:!st.focus?.done}});

  const addTask = fields => { const t={id:gid(),text:"",done:false,priority:P.NONE,date:null,projectId:null,repeat:"none",tags:[],note:"",private:false,createdAt:Date.now(),...fields}; upd({...st,tasks:[...st.tasks,t]}); };
  const updTask = (id,fields) => upd({...st,tasks:st.tasks.map(t=>t.id===id?{...t,...fields}:t)});
  const delTask = id => { upd({...st,tasks:st.tasks.filter(t=>t.id!==id)}); setConfirmDel(null); showToast("Task deleted"); };
  const toggleDone = id => {
    const t=st.tasks.find(t=>t.id===id);
    if(t.repeat&&t.repeat!=="none"&&!t.done){
      const nd=new Date((t.date||todayStr())+"T00:00:00");
      if(t.repeat==="daily")nd.setDate(nd.getDate()+1);
      if(t.repeat==="weekly")nd.setDate(nd.getDate()+7);
      if(t.repeat==="monthly")nd.setMonth(nd.getMonth()+1);
      upd({...st,tasks:[...st.tasks.map(tk=>tk.id===id?{...tk,done:true}:tk),{...t,id:gid(),done:false,date:nd.toISOString().split("T")[0],createdAt:Date.now()}]});
    } else updTask(id,{done:!t.done});
  };

  const addProj = () => { const p={id:gid(),name:"New project",color:PROJ_COLORS[st.projects.length%PROJ_COLORS.length]}; upd({...st,projects:[...st.projects,p]}); setSelProj(p.id); setView(VIEWS.PROJECTS); setEditingProj(p.id); setSidebarOpen(false); };
  const updProj = (id,fields) => upd({...st,projects:st.projects.map(p=>p.id===id?{...p,...fields}:p)});
  const delProj = id => { upd({...st,projects:st.projects.filter(p=>p.id!==id),tasks:st.tasks.map(t=>t.projectId===id?{...t,projectId:null}:t)}); setConfirmDel(null); if(selProj===id){setSelProj(null);setView(VIEWS.PROJECTS);} showToast("Project deleted"); };

  const startVoice = () => {
    const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
    if(!SR){showToast("Voice not supported in this browser");return;}
    setVoiceModal(true); setTranscript(""); setRecording(true);
    const r=new SR(); r.lang="uk-UA"; r.continuous=false; r.interimResults=true;
    r.onresult=e=>{setTranscript(Array.from(e.results).map(r=>r[0].transcript).join(" "));};
    r.onend=()=>setRecording(false);
    r.onerror=()=>{setRecording(false);showToast("Microphone error");};
    r.start(); recogRef.current=r;
  };
  const stopVoice = () => { recogRef.current?.stop(); setRecording(false); };
  const processVoice = async () => {
    if(!transcript.trim())return;
    setAiLoading(true);
    try {
      const res=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({model:"claude-sonnet-4-6",max_tokens:1000,
          system:`Extract tasks from the text. Return ONLY a JSON array, no markdown, no extra text. Each item: text (short task name in Ukrainian), priority ("high"|"med"|"low"|"none"), date ("YYYY-MM-DD" or null, today=${todayStr()}). Min 1, max 8.`,
          messages:[{role:"user",content:transcript}]})});
      const data=await res.json();
      const raw=data.content?.[0]?.text?.trim()||"[]";
      let tasks; try{tasks=JSON.parse(raw);}catch{tasks=[];}
      if(tasks.length){
        const nt=tasks.map(t=>({id:gid(),text:t.text||"Task",done:false,priority:t.priority||P.NONE,date:t.date||null,projectId:null,repeat:"none",tags:[],note:"",private:false,createdAt:Date.now()}));
        upd({...st,tasks:[...st.tasks,...nt]});
        showToast(`✓ Added ${nt.length} task${nt.length>1?"s":""}`);
        setView(VIEWS.INBOX); setVoiceModal(false); setTranscript("");
      } else showToast("Couldn't extract tasks — try again");
    } catch{showToast("AI error — check connection");}
    setAiLoading(false);
  };

  const filterFn = tasks => filterPriority==="all"?tasks:tasks.filter(t=>t.priority===filterPriority);
  const todayTasks = filterFn(st.tasks.filter(t=>!t.private&&(isToday(t.date)||(!t.done&&isPast(t.date)))));
  const upcomingTasks = filterFn(st.tasks.filter(t=>!t.private&&isFuture(t.date)));
  const inboxTasks = filterFn(st.tasks.filter(t=>!t.private&&!t.date&&!t.projectId));
  const privateTasks = filterFn(st.tasks.filter(t=>t.private));
  const total=st.tasks.filter(t=>!t.private).length;
  const doneCount=st.tasks.filter(t=>!t.private&&t.done).length;
  const overdue=st.tasks.filter(t=>!t.private&&!t.done&&isPast(t.date)).length;
  const todayActive=st.tasks.filter(t=>!t.private&&(isToday(t.date)||(!t.done&&isPast(t.date)))&&!t.done).length;
  const pct=total>0?Math.round(doneCount/total*100):0;

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

  const nav = (v,proj=null) => { setView(v); setSelProj(proj); setSidebarOpen(false); setFilterPriority("all"); setEditingFocus(false); };

  const renderTask = task => {
    const proj=st.projects.find(p=>p.id===task.projectId);
    return (
      <div key={task.id} className={`task-card${task.done?" done":""}${task.private?" private-task":""}`}>
        <button className={`check-btn${task.done?" checked":""} ${task.priority==="high"?"ph":task.priority==="med"?"pm":task.priority==="low"?"pl":""}`} onClick={()=>toggleDone(task.id)} aria-label="Done">
          {task.done&&<i className="ti ti-check"/>}
        </button>
        <div className="task-body" onClick={()=>setTaskDetail(task)}>
          {editingTask===task.id
            ?<input className="task-edit-input" autoFocus defaultValue={task.text} onBlur={e=>{updTask(task.id,{text:e.target.value});setEditingTask(null);}} onKeyDown={e=>{if(e.key==="Enter")e.target.blur();if(e.key==="Escape")setEditingTask(null);}} onClick={e=>e.stopPropagation()}/>
            :<span className={`task-text${task.done?" done":""}`}>{task.text||"Untitled"}</span>
          }
          <div className="task-meta">
            {task.priority!==P.NONE&&<span className={`tag tag-${task.priority}`}>{P_LABEL[task.priority]}</span>}
            {task.date&&<span className={`tag ${!task.done&&isPast(task.date)?"tag-overdue":"tag-date"}`}><i className="ti ti-calendar" style={{fontSize:10,marginRight:3}}/>{fmtDate(task.date)}</span>}
            {task.repeat&&task.repeat!=="none"&&<span className="tag tag-repeat"><i className="ti ti-refresh" style={{fontSize:10,marginRight:3}}/>{REPEAT_OPT[task.repeat]}</span>}
            {proj&&<span className="tag tag-proj" style={{background:proj.color}}>{proj.name}</span>}
            {task.private&&<span className="tag tag-private"><i className="ti ti-lock" style={{fontSize:10,marginRight:3}}/>Private</span>}
            {(task.tags||[]).map(tg=><span key={tg} className="tag tag-custom">#{tg}</span>)}
          </div>
        </div>
        <div className="task-actions">
          <button className="tact-btn" title="Edit" onClick={e=>{e.stopPropagation();setEditingTask(task.id);}}><i className="ti ti-edit" style={{fontSize:14}}/></button>
          <TaskMenu task={task} projects={st.projects} onUpdate={f=>updTask(task.id,f)} onDelete={()=>setConfirmDel({type:"task",id:task.id})}/>
        </div>
      </div>
    );
  };

  const renderAdd = (defaults={}) => {
    const key=JSON.stringify(defaults);
    if(addingTo!==key) return <button className="add-task-btn" onClick={()=>{setAddingTo(key);setTimeout(()=>addRef.current?.focus(),40);}}><i className="ti ti-plus" style={{fontSize:15}}/> Add task</button>;
    return <AddForm ref={addRef} defaults={defaults} projects={st.projects} onAdd={f=>{addTask(f);setAddingTo(null);}} onCancel={()=>setAddingTo(null)}/>;
  };

  const FilterBar = () => (
    <div className="filter-bar">
      {["all","high","med","low"].map(p=>(
        <button key={p} className={`fchip${filterPriority===p?" on":""}`} onClick={()=>setFilterPriority(p)}>
          {p==="all"?"All":P_LABEL[p]}
        </button>
      ))}
    </div>
  );

  const pageTitle = view===VIEWS.TODAY?"Today":view===VIEWS.UPCOMING?"Upcoming":view===VIEWS.INBOX?"Inbox":view===VIEWS.PRIVATE?"Private":view===VIEWS.CALENDAR?"Calendar":view===VIEWS.STATS?"Progress":selProj?st.projects.find(p=>p.id===selProj)?.name||"Project":"Projects";

  return (
    <div className="app">
      <div className="mobile-bar">
        <button className="hamburger" onClick={()=>setSidebarOpen(v=>!v)}><i className="ti ti-menu-2" style={{fontSize:20}}/></button>
        <span style={{fontSize:15,fontWeight:800,letterSpacing:"-0.4px"}}>Vika Plan</span>
      </div>
      {sidebarOpen&&<div className="overlay" onClick={()=>setSidebarOpen(false)}/>}

      <aside className={`sidebar${sidebarOpen?" open":""}`}>
        <div className="sidebar-logo">
          <div className="logo-mark"><i className="ti ti-bolt"/></div>
          <span className="logo-text">Vika Plan</span>
          <span className="logo-pro">PRO</span>
        </div>
        <div className="nav-area">
          <div className="nav-group-label">Main</div>
          {[
            {id:VIEWS.TODAY,icon:"ti-sun-high",label:"Today",count:todayActive},
            {id:VIEWS.UPCOMING,icon:"ti-calendar-due",label:"Upcoming",count:upcomingTasks.filter(t=>!t.done).length},
            {id:VIEWS.INBOX,icon:"ti-inbox",label:"Inbox",count:inboxTasks.filter(t=>!t.done).length},
          ].map(item=>(
            <button key={item.id} className={`nav-btn${view===item.id&&!selProj?" active":""}`} onClick={()=>nav(item.id)}>
              <i className={`ti ${item.icon}`} aria-hidden/>
              <span className="nav-btn-label">{item.label}</span>
              {item.count>0&&<span className="nav-badge">{item.count}</span>}
            </button>
          ))}
          <div className="nav-sep"/>
          <button className={`nav-btn private-nav${view===VIEWS.PRIVATE&&!selProj?" active":""}`} onClick={()=>nav(VIEWS.PRIVATE)}>
            <i className="ti ti-lock" aria-hidden/>
            <span className="nav-btn-label">Private</span>
            {privateTasks.filter(t=>!t.done).length>0&&<span className="nav-badge">{privateTasks.filter(t=>!t.done).length}</span>}
          </button>
          <div className="nav-sep"/>
          <button className={`nav-btn${view===VIEWS.CALENDAR&&!selProj?" active":""}`} onClick={()=>nav(VIEWS.CALENDAR)}><i className="ti ti-calendar-month" aria-hidden/><span className="nav-btn-label">Calendar</span></button>
          <button className={`nav-btn${view===VIEWS.STATS&&!selProj?" active":""}`} onClick={()=>nav(VIEWS.STATS)}><i className="ti ti-chart-bar" aria-hidden/><span className="nav-btn-label">Progress</span></button>

          <div className="nav-sep" style={{marginTop:4}}/>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 10px 4px"}}>
            <span className="nav-group-label" style={{padding:0}}>Projects</span>
            <button className="icon-btn" onClick={addProj} style={{width:26,height:26,borderRadius:7}} title="New project"><i className="ti ti-plus" style={{fontSize:13}}/></button>
          </div>
          {st.projects.map(p=>(
            <button key={p.id} className={`proj-btn${selProj===p.id?" active":""}`} onClick={()=>nav(VIEWS.PROJECTS,p.id)}>
              <div className="proj-dot" style={{background:p.color}}/>
              <span className="proj-label">
                {editingProj===p.id
                  ?<input autoFocus defaultValue={p.name} onBlur={e=>{updProj(p.id,{name:e.target.value});setEditingProj(null);}} onKeyDown={e=>{if(e.key==="Enter"||e.key==="Escape")e.target.blur();}} style={{background:"transparent",border:"none",outline:"none",fontSize:13,fontWeight:600,color:"var(--ink)",width:"100%",padding:0}} onClick={e=>e.stopPropagation()}/>
                  :p.name}
              </span>
              <span className="proj-count">{st.tasks.filter(t=>t.projectId===p.id&&!t.done).length||""}</span>
            </button>
          ))}
          {st.projects.length===0&&<div style={{padding:"4px 10px",fontSize:12,color:"var(--ink4)"}}>Press + to add a project</div>}
        </div>
        <div className="sidebar-bottom">
          <div className="sidebar-bottom-quote">"{quote.text}" <strong>— {quote.author}</strong></div>
        </div>
      </aside>

      <div className="main">
        <div className="topbar">
          <div>
            <h1 className="page-title">{pageTitle}</h1>
            {view===VIEWS.TODAY&&<p className="page-sub">{new Date().toLocaleDateString("en-US",{weekday:"long",day:"numeric",month:"long",year:"numeric"})}</p>}
            {view===VIEWS.PRIVATE&&<p className="page-sub">Stored only on this device</p>}
          </div>
          <div style={{display:"flex",gap:8,paddingTop:6}}>
            {view===VIEWS.PROJECTS&&selProj&&<>
              <button className="icon-btn" onClick={()=>setEditingProj(selProj)} title="Rename"><i className="ti ti-edit" style={{fontSize:14}}/></button>
              <button className="icon-btn" style={{color:"var(--red)",borderColor:"var(--red)"}} onClick={()=>setConfirmDel({type:"project",id:selProj})}><i className="ti ti-trash" style={{fontSize:14}}/></button>
            </>}
          </div>
        </div>

        <div className="content">

          {/* ── TODAY VIEW ── */}
          {view===VIEWS.TODAY&&<>
            {/* Hero card */}
            <div className="hero-card">
              <div>
                <div className="hero-greeting">Good {new Date().getHours()<12?"morning":new Date().getHours()<18?"afternoon":"evening"} 👋</div>
                <div className="hero-date">{new Date().toLocaleDateString("en-US",{weekday:"long",day:"numeric",month:"long"})}</div>
              </div>
              <div>
                <div className="hero-stats" style={{marginBottom:12}}>
                  <div className="hero-stat"><div className="hero-stat-num">{todayActive}</div><div className="hero-stat-lbl">tasks<br/>left</div></div>
                  <div className="hero-divider"/>
                  <div className="hero-stat"><div className="hero-stat-num">{doneCount}</div><div className="hero-stat-lbl">done<br/>total</div></div>
                  <div className="hero-divider"/>
                  <div className="hero-stat"><div className="hero-stat-num">{overdue}</div><div className="hero-stat-lbl">over<br/>due</div></div>
                </div>
                <div className="hero-progress">
                  <div className="hero-progress-bar"><div className="hero-progress-fill" style={{width:`${pct}%`}}/></div>
                  <div className="hero-progress-lbl">{pct}% complete</div>
                </div>
              </div>
            </div>

            {/* Focus of the day — TODAY ONLY */}
            <div className="focus-wrap">
              <div className="focus-top">
                <div className="focus-badge"><i className="ti ti-bolt"/><span className="focus-badge-text">Focus of the day</span></div>
                {!editingFocus&&<button className="focus-edit-btn" onClick={startEditFocus}><i className="ti ti-edit" style={{fontSize:12}}/>{st.focus?.text?"Edit":"Set focus"}</button>}
              </div>
              {editingFocus?(
                <div>
                  <input ref={focusRef} className="focus-input" value={focusDraft} onChange={e=>setFocusDraft(e.target.value)} placeholder="What's your main focus for today?" onKeyDown={e=>{if(e.key==="Enter")saveFocus();if(e.key==="Escape")setEditingFocus(false);}}/>
                  <div className="focus-save-row">
                    <button className="btn-primary" style={{fontSize:12,padding:"5px 16px"}} onClick={saveFocus}>Save</button>
                    <button className="btn-secondary" style={{fontSize:12,padding:"5px 12px"}} onClick={()=>setEditingFocus(false)}>Cancel</button>
                    {st.focus?.text&&<button className="btn-secondary" style={{fontSize:12,padding:"5px 12px",color:"var(--red)",borderColor:"var(--red)"}} onClick={clearFocus}>Clear</button>}
                  </div>
                </div>
              ):st.focus?.text?(
                <div>
                  <div className={`focus-task-text${st.focus.done?" done-text":""}`}>{st.focus.text}</div>
                  <div className="focus-actions-row">
                    <button className="focus-done-btn" onClick={toggleFocusDone}>{st.focus.done?"↩ Not done":"✓ Mark done"}</button>
                    <div className="focus-progress-mini"><div className="focus-progress-mini-fill" style={{width:st.focus.done?"100%":"30%"}}/></div>
                    <button className="focus-clear-btn" onClick={clearFocus}>Clear</button>
                  </div>
                </div>
              ):(
                <div className="focus-empty-text">No focus set — tap "Set focus" to define your #1 priority for today</div>
              )}
            </div>

            <FilterBar/>
            <TaskListView tasks={todayTasks} renderTask={renderTask} renderAdd={()=>renderAdd({date:todayStr()})} emptyMsg="All done for today 🎉"/>
          </>}

          {/* ── OTHER VIEWS ── */}
          {view===VIEWS.UPCOMING&&<><FilterBar/><UpcomingView tasks={upcomingTasks} renderTask={renderTask} renderAdd={()=>renderAdd({})}/></>}
          {view===VIEWS.INBOX&&<><FilterBar/><TaskListView tasks={inboxTasks} renderTask={renderTask} renderAdd={()=>renderAdd({})} emptyMsg="Inbox is empty ✓"/></>}
          {view===VIEWS.PRIVATE&&<>
            <div className="private-banner">
              <div className="private-banner-icon"><i className="ti ti-shield-lock"/></div>
              <div><div className="private-banner-title">Private tasks</div><div className="private-banner-sub">Only visible on this device — never synced or shared</div></div>
            </div>
            <FilterBar/>
            <TaskListView tasks={privateTasks} renderTask={renderTask} renderAdd={()=>renderAdd({private:true})} emptyMsg="No private tasks yet"/>
          </>}

          {view===VIEWS.PROJECTS&&selProj&&(()=>{
            const proj=st.projects.find(p=>p.id===selProj);
            if(!proj)return null;
            const pt=filterFn(st.tasks.filter(t=>t.projectId===selProj));
            return<>
              <div style={{display:"flex",gap:8,marginBottom:18,flexWrap:"wrap"}}>
                {PROJ_COLORS.map(c=><button key={c} onClick={()=>updProj(selProj,{color:c})} style={{width:22,height:22,borderRadius:"50%",background:c,border:proj.color===c?"3px solid var(--ink)":"none",padding:0,boxShadow:proj.color===c?"0 0 0 2px #fff, 0 0 0 4px "+c:"none"}}/>)}
              </div>
              <FilterBar/>
              <TaskListView tasks={pt} renderTask={renderTask} renderAdd={()=>renderAdd({projectId:selProj})} emptyMsg="No tasks yet — add the first one"/>
            </>;
          })()}

          {view===VIEWS.PROJECTS&&!selProj&&<div style={{display:"grid",gap:8,marginTop:4}}>
            {st.projects.length===0&&<div className="empty"><div className="empty-icon"><i className="ti ti-folders"/></div><p>No projects yet. Press + to create one.</p></div>}
            {st.projects.map(p=>{
              const c=st.tasks.filter(t=>t.projectId===p.id&&!t.done).length;
              const tot=st.tasks.filter(t=>t.projectId===p.id).length;
              const pp=tot>0?Math.round((tot-c)/tot*100):0;
              return<div key={p.id} style={{display:"flex",alignItems:"center",gap:14,padding:"15px 18px",background:"var(--surface)",border:"1.5px solid var(--border)",borderRadius:"var(--r-xl)",cursor:"pointer",boxShadow:"var(--s0)",transition:"all 0.15s"}} onClick={()=>nav(VIEWS.PROJECTS,p.id)}
                onMouseEnter={e=>e.currentTarget.style.boxShadow="var(--s2)"}
                onMouseLeave={e=>e.currentTarget.style.boxShadow="var(--s0)"}>
                <div style={{width:38,height:38,borderRadius:11,background:p.color+"22",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                  <div style={{width:10,height:10,borderRadius:"50%",background:p.color}}/>
                </div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontWeight:700,fontSize:14,marginBottom:4}}>{p.name}</div>
                  <div style={{height:3,background:"var(--surface3)",borderRadius:2,overflow:"hidden"}}><div style={{height:"100%",width:`${pp}%`,background:p.color,borderRadius:2,transition:"width 0.4s"}}/></div>
                </div>
                {c>0&&<span style={{fontSize:12,color:"var(--ink4)",fontWeight:700,flexShrink:0}}>{c} left</span>}
                <i className="ti ti-chevron-right" style={{fontSize:14,color:"var(--ink4)",flexShrink:0}}/>
              </div>;
            })}
            <button style={{display:"flex",alignItems:"center",gap:10,padding:"15px 18px",background:"transparent",border:"2px dashed var(--border2)",borderRadius:"var(--r-xl)",color:"var(--ink4)",fontSize:13,fontWeight:600,transition:"all 0.15s"}} onClick={addProj}
              onMouseEnter={e=>{e.currentTarget.style.borderColor="var(--purple)";e.currentTarget.style.color="var(--purple)";e.currentTarget.style.background="var(--purple-bg)";}}
              onMouseLeave={e=>{e.currentTarget.style.borderColor="var(--border2)";e.currentTarget.style.color="var(--ink4)";e.currentTarget.style.background="transparent";}}>
              <i className="ti ti-plus" style={{fontSize:16}}/> New project
            </button>
          </div>}

          {view===VIEWS.CALENDAR&&<CalView tasks={st.tasks} calDate={calDate} setCalDate={setCalDate} calDays={calDays} selDay={selDay} setSelDay={setSelDay} renderTask={renderTask} renderAdd={renderAdd}/>}
          {view===VIEWS.STATS&&<StatsView tasks={st.tasks} projects={st.projects} total={total} done={doneCount} overdue={overdue} todayCount={todayActive} pct={pct}/>}
        </div>
      </div>

      <button className={`voice-fab${recording?" rec":""}`} onClick={recording?stopVoice:startVoice} aria-label="Voice input">
        <i className={`ti ${recording?"ti-microphone-off":"ti-microphone"}`} style={{fontSize:20}}/>
      </button>

      {voiceModal&&<div className="vmodal-bg" onClick={()=>{stopVoice();setVoiceModal(false);}}>
        <div className="vmodal" onClick={e=>e.stopPropagation()}>
          <div className="vmodal-title">🎙 Voice Input</div>
          <div className="vmodal-sub">Speak your thoughts — AI will turn them into tasks</div>
          {recording&&<div className="wave">{[0,1,2,3,4].map(i=><div key={i} className="wave-bar" style={{animationDelay:`${i*0.12}s`}}/>)}</div>}
          <div className="vtranscript" style={{color:transcript?"var(--ink2)":"var(--ink4)",fontStyle:transcript?"normal":"italic"}}>
            {transcript||"Tap the mic and start speaking..."}
          </div>
          <div className="vactions">
            <button className="btn-secondary" onClick={()=>{stopVoice();setVoiceModal(false);}}>Cancel</button>
            {!recording&&<button className="btn-secondary" onClick={startVoice}><i className="ti ti-microphone" style={{fontSize:13,marginRight:5}}/>Again</button>}
            {transcript&&<button className="btn-primary" onClick={processVoice} disabled={aiLoading}>{aiLoading?"Analyzing...":"Create tasks"}</button>}
          </div>
        </div>
      </div>}

      {taskDetail&&<TaskDetailModal task={taskDetail} projects={st.projects} onUpdate={f=>{updTask(taskDetail.id,f);setTaskDetail({...taskDetail,...f});}} onClose={()=>setTaskDetail(null)} onDelete={()=>{delTask(taskDetail.id);setTaskDetail(null);}}/>}

      {confirmDel&&<div className="modal-bg" onClick={()=>setConfirmDel(null)}>
        <div className="modal" onClick={e=>e.stopPropagation()}>
          <div className="modal-title">Delete?</div>
          <div className="modal-sub">{confirmDel.type==="project"?"The project will be deleted. Tasks will move to Inbox.":"This task will be permanently deleted."}</div>
          <div className="modal-actions">
            <button className="btn-secondary" onClick={()=>setConfirmDel(null)}>Cancel</button>
            <button className="btn-danger" onClick={()=>confirmDel.type==="project"?delProj(confirmDel.id):delTask(confirmDel.id)}>Delete</button>
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
  const submit=()=>{ if(text.trim()){onAdd({text:text.trim(),priority,date:date||null,projectId:projId||null,repeat,private:defaults.private||false,...defaults});setText("");}else onCancel(); };
  return(
    <div className="add-form">
      <input ref={ref} type="text" value={text} onChange={e=>setText(e.target.value)} placeholder="Task name..."
        onKeyDown={e=>{if(e.key==="Enter"&&text.trim())submit();if(e.key==="Escape")onCancel();}}/>
      <div className="form-row">
        <select className="form-select" value={priority} onChange={e=>setPriority(e.target.value)}>
          {Object.entries(P_LABEL).map(([k,v])=><option key={k} value={k}>{v}</option>)}
        </select>
        <input className="form-date" type="date" value={date} onChange={e=>setDate(e.target.value)}/>
        {projects.length>0&&<select className="form-select" value={projId} onChange={e=>setProjId(e.target.value)}>
          <option value="">No project</option>
          {projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
        </select>}
        <select className="form-select" value={repeat} onChange={e=>setRepeat(e.target.value)}>
          {Object.entries(REPEAT_OPT).map(([k,v])=><option key={k} value={k}>{v}</option>)}
        </select>
        <div className="form-actions">
          <button className="btn-secondary" onClick={onCancel}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={!text.trim()}>Add</button>
        </div>
      </div>
    </div>
  );
});

function TaskListView({tasks,renderTask,renderAdd,emptyMsg}){
  const active=tasks.filter(t=>!t.done),done=tasks.filter(t=>t.done);
  const [showDone,setShowDone]=useState(false);
  return<>
    {active.length===0&&done.length===0&&<div className="empty"><div className="empty-icon"><i className="ti ti-checks"/></div><p>{emptyMsg}</p></div>}
    <div className="task-list">{active.map(t=>renderTask(t))}</div>
    {renderAdd&&renderAdd()}
    {done.length>0&&<div style={{marginTop:8}}>
      <button className="done-toggle" onClick={()=>setShowDone(v=>!v)}>
        <i className={`ti ${showDone?"ti-chevron-down":"ti-chevron-right"}`} style={{fontSize:12}}/>
        Completed ({done.length})
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
    {sorted.length===0&&<div className="empty"><div className="empty-icon"><i className="ti ti-calendar-off"/></div><p>No upcoming tasks</p></div>}
    {sorted.map(date=><div key={date} style={{marginBottom:24}}>
      <div className="section-head">
        <span className="section-title">{new Date(date+"T00:00:00").toLocaleDateString("en-US",{weekday:"long",day:"numeric",month:"long"})}</span>
        <span className="section-count">{groups[date].filter(t=>!t.done).length} left</span>
      </div>
      <div className="task-list">{groups[date].map(t=>renderTask(t))}</div>
    </div>)}
    <div style={{marginTop:4}}>{renderAdd&&renderAdd()}</div>
  </>;
}

function CalView({tasks,calDate,setCalDate,calDays,selDay,setSelDay,renderTask,renderAdd}){
  const days=calDays();
  const DAYS=["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
  const selTasks=selDay?tasks.filter(t=>t.date===selDay):[];
  return<>
    <div className="cal-nav">
      <button className="icon-btn" onClick={()=>{const d=new Date(calDate);d.setMonth(d.getMonth()-1);setCalDate(d);}}><i className="ti ti-chevron-left" style={{fontSize:14}}/></button>
      <span className="cal-title">{calDate.toLocaleDateString("en-US",{month:"long",year:"numeric"})}</span>
      <button className="icon-btn" onClick={()=>{const d=new Date(calDate);d.setMonth(d.getMonth()+1);setCalDate(d);}}><i className="ti ti-chevron-right" style={{fontSize:14}}/></button>
    </div>
    <div className="cal-grid">
      {DAYS.map(d=><div key={d} className="cal-dh">{d}</div>)}
      {days.map((date,i)=>{
        if(!date)return<div key={i}/>;
        const has=tasks.some(t=>t.date===date);
        return<div key={date} className={`cal-day${isToday(date)?" today":""}${selDay===date?" sel":""}${has?" has":""}`} onClick={()=>setSelDay(selDay===date?null:date)}>
          {parseInt(date.split("-")[2])}
        </div>;
      })}
    </div>
    {selDay&&<>
      <div className="section-head" style={{marginBottom:10}}>
        <span className="section-title">{new Date(selDay+"T00:00:00").toLocaleDateString("en-US",{weekday:"long",day:"numeric",month:"long"})}</span>
        <span className="section-count">{selTasks.filter(t=>!t.done).length} tasks</span>
      </div>
      <div className="task-list">{selTasks.map(t=>renderTask(t))}</div>
      {renderAdd({date:selDay})}
    </>}
  </>;
}

function StatsView({tasks,projects,total,done,overdue,todayCount,pct}){
  const r=40,circ=2*Math.PI*r,offset=circ*(1-pct/100);
  const bp={high:tasks.filter(t=>t.priority==="high"&&!t.done&&!t.private).length,med:tasks.filter(t=>t.priority==="med"&&!t.done&&!t.private).length,low:tasks.filter(t=>t.priority==="low"&&!t.done&&!t.private).length};
  return<>
    <div className="stats-row">
      {[{n:total,l:"Total tasks",c:"#6C47FF"},{n:done,l:"Completed",c:"#0FA884"},{n:overdue,l:"Overdue",c:"#E53E3E"},{n:todayCount,l:"Due today",c:"#D97706"}].map(({n,l,c})=>(
        <div key={l} className="stat-card">
          <div className="stat-num" style={{color:c}}>{n}</div>
          <div className="stat-lbl">{l}</div>
          {total>0&&<div className="stat-bar"><div className="stat-bar-fill" style={{width:`${Math.round(n/Math.max(total,1)*100)}%`,background:c}}/></div>}
        </div>
      ))}
    </div>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:22}}>
      <div className="stat-card" style={{display:"flex",alignItems:"center",gap:20}}>
        <svg width="100" height="100" viewBox="0 0 100 100">
          <defs><linearGradient id="pg" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stopColor="#6C47FF"/><stop offset="100%" stopColor="#A67BFF"/></linearGradient></defs>
          <circle className="prog-track" cx="50" cy="50" r={r} strokeWidth="8"/>
          <circle className="prog-fill" cx="50" cy="50" r={r} strokeWidth="8" strokeDasharray={circ} strokeDashoffset={offset} style={{transform:"rotate(-90deg)",transformOrigin:"50% 50%"}}/>
          <text x="50" y="55" textAnchor="middle" fontSize="18" fontWeight="800" fill="#16151A">{pct}%</text>
        </svg>
        <div><div style={{fontSize:28,fontWeight:800,letterSpacing:"-0.8px",color:"#6C47FF"}}>{pct}%</div><div className="stat-lbl">Overall done</div></div>
      </div>
      <div className="stat-card">
        <div className="stat-lbl" style={{marginBottom:12}}>By priority</div>
        {[["High",bp.high,"var(--red)"],["Medium",bp.med,"var(--amber)"],["Low",bp.low,"var(--blue)"]].map(([l,c,col])=>(
          <div key={l} style={{display:"flex",alignItems:"center",gap:9,marginBottom:8}}>
            <div style={{width:8,height:8,borderRadius:"50%",background:col,flexShrink:0}}/>
            <span style={{fontSize:13,flex:1,color:"var(--ink2)",fontWeight:500}}>{l}</span>
            <span style={{fontSize:14,fontWeight:800,color:"var(--ink)"}}>{c}</span>
          </div>
        ))}
      </div>
    </div>
    {projects.length>0&&<>
      <div className="section-head"><span className="section-title">By project</span></div>
      <div style={{display:"grid",gap:8,marginTop:8}}>
        {projects.map(p=>{
          const pt=tasks.filter(t=>t.projectId===p.id),pd=pt.filter(t=>t.done).length,pp=pt.length>0?Math.round(pd/pt.length*100):0;
          return<div key={p.id} className="stat-card" style={{padding:"12px 16px"}}>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
              <div style={{width:8,height:8,borderRadius:"50%",background:p.color,flexShrink:0}}/>
              <span style={{fontWeight:700,fontSize:14,flex:1}}>{p.name}</span>
              <span style={{fontSize:12,color:"var(--ink4)",fontWeight:600}}>{pd}/{pt.length}</span>
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
  const d=n=>{const dt=new Date();dt.setDate(dt.getDate()+n);return dt.toISOString().split("T")[0];};
  return<div className="dd-wrap" ref={ref}>
    <button className="tact-btn" onClick={e=>{e.stopPropagation();setOpen(v=>!v);}} aria-label="More"><i className="ti ti-dots" style={{fontSize:14}}/></button>
    {open&&<div className="dd-menu" onClick={e=>e.stopPropagation()}>
      <div className="dd-lbl">Priority</div>
      {Object.entries(P_LABEL).map(([k,v])=>(
        <button key={k} className={`dd-btn${task.priority===k?" active":""}`} onClick={()=>{onUpdate({priority:k});setOpen(false);}}>
          <i className="ti ti-flag" style={{fontSize:12,color:k==="high"?"var(--red)":k==="med"?"var(--amber)":k==="low"?"var(--blue)":"var(--ink4)"}}/>{v}
          {task.priority===k&&<i className="ti ti-check" style={{fontSize:11,marginLeft:"auto"}}/>}
        </button>
      ))}
      <div className="dd-sep"/>
      <div className="dd-lbl">Date</div>
      {[["Today","ti-sun-high",0],["Tomorrow","ti-calendar",1],["Next week","ti-calendar-week",7]].map(([l,ic,n])=>(
        <button key={l} className="dd-btn" onClick={()=>{onUpdate({date:d(n)});setOpen(false);}}><i className={`ti ${ic}`} style={{fontSize:12}}/>{l}</button>
      ))}
      {task.date&&<button className="dd-btn" onClick={()=>{onUpdate({date:null});setOpen(false);}}><i className="ti ti-x" style={{fontSize:12}}/>Remove date</button>}
      <div className="dd-sep"/>
      <div className="dd-lbl">Repeat</div>
      {Object.entries(REPEAT_OPT).map(([k,v])=>(
        <button key={k} className={`dd-btn${task.repeat===k?" active":""}`} onClick={()=>{onUpdate({repeat:k});setOpen(false);}}><i className="ti ti-refresh" style={{fontSize:12}}/>{v}</button>
      ))}
      {projects.length>0&&<><div className="dd-sep"/><div className="dd-lbl">Project</div>
        {projects.map(p=>(
          <button key={p.id} className={`dd-btn${task.projectId===p.id?" active":""}`} onClick={()=>{onUpdate({projectId:task.projectId===p.id?null:p.id});setOpen(false);}}>
            <div style={{width:8,height:8,borderRadius:"50%",background:p.color,flexShrink:0}}/>{p.name}
            {task.projectId===p.id&&<i className="ti ti-check" style={{fontSize:11,marginLeft:"auto"}}/>}
          </button>
        ))}
      </>}
      <div className="dd-sep"/>
      <button className="dd-btn" onClick={()=>{onUpdate({private:!task.private});setOpen(false);}}><i className={`ti ${task.private?"ti-lock-open":"ti-lock"}`} style={{fontSize:12}}/>{task.private?"Make public":"Make private"}</button>
      <div className="dd-sep"/>
      <button className="dd-btn red" onClick={()=>{onDelete();setOpen(false);}}><i className="ti ti-trash" style={{fontSize:12}}/>Delete</button>
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
    <div className="modal" style={{maxWidth:500}} onClick={e=>e.stopPropagation()}>
      <input value={text} onChange={e=>setText(e.target.value)} onBlur={save}
        style={{width:"100%",fontSize:17,fontWeight:800,background:"transparent",border:"none",borderBottom:"2px solid var(--border)",outline:"none",color:"var(--ink)",paddingBottom:10,marginBottom:14,letterSpacing:"-0.3px"}}/>
      <textarea value={note} onChange={e=>setNote(e.target.value)} onBlur={save} placeholder="Notes..."
        style={{width:"100%",minHeight:80,fontSize:13,background:"var(--surface2)",border:"1.5px solid var(--border)",borderRadius:"var(--r-lg)",padding:"10px 12px",outline:"none",resize:"vertical",color:"var(--ink2)",lineHeight:1.6}}/>
      <div style={{marginTop:14}}>
        <div style={{fontSize:10,fontWeight:800,color:"var(--ink4)",textTransform:"uppercase",letterSpacing:"0.8px",marginBottom:8}}>Tags</div>
        <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:8}}>
          {(task.tags||[]).map(t=>(
            <span key={t} style={{display:"flex",alignItems:"center",gap:3,fontSize:12,fontWeight:700,padding:"3px 9px",borderRadius:20,background:"var(--purple-bg)",color:"var(--purple)"}}>
              #{t}<button onClick={()=>onUpdate({tags:(task.tags||[]).filter(x=>x!==t)})} style={{background:"none",border:"none",cursor:"pointer",color:"var(--purple)",padding:0,lineHeight:1,fontSize:14,marginLeft:2}}>×</button>
            </span>
          ))}
        </div>
        <div style={{display:"flex",gap:7}}>
          <input value={tagInput} onChange={e=>setTagInput(e.target.value)} placeholder="Add tag..."
            style={{fontSize:12,padding:"6px 10px",border:"1.5px solid var(--border)",borderRadius:9,background:"var(--surface2)",outline:"none",color:"var(--ink)",flex:1}}
            onKeyDown={e=>{if(e.key==="Enter")addTag();}}/>
          <button className="btn-secondary" style={{fontSize:12,padding:"6px 12px"}} onClick={addTag}>Add</button>
        </div>
      </div>
      <div className="modal-actions">
        <button className="btn-secondary" style={{color:"var(--red)",borderColor:"var(--red)",marginRight:"auto"}} onClick={onDelete}><i className="ti ti-trash" style={{fontSize:12,marginRight:4}}/>Delete</button>
        <button className="btn-secondary" onClick={onClose}>Close</button>
        <button className="btn-primary" onClick={()=>{save();onClose();}}>Save</button>
      </div>
    </div>
  </div>;
}
