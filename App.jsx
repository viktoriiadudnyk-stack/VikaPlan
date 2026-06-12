import { useState, useEffect, useCallback, useRef } from "react";

const VIEWS = { TODAY: "today", UPCOMING: "upcoming", INBOX: "inbox", PROJECTS: "projects", CAPTURE: "capture" };
const PRIORITIES = { HIGH: "high", MED: "med", LOW: "low", NONE: "none" };
const PRIORITY_LABELS = { high: "Терміново", med: "Середній", low: "Низький", none: "Без пріоритету" };
const PRIORITY_COLORS = { high: "#e05252", med: "#e0a952", low: "#52a8e0", none: "var(--text-tertiary)" };
const PROJECT_COLORS = ["#7c6fcd", "#e05252", "#52a8e0", "#52c47a", "#e0a952", "#e05295", "#52c4b8", "#9c52e0"];

const generateId = () => `${Date.now()}_${Math.random().toString(36).slice(2)}`;
const todayStr = () => new Date().toISOString().split("T")[0];
const formatDate = (d) => {
  if (!d) return "";
  const dt = new Date(d + "T00:00:00");
  return dt.toLocaleDateString("uk-UA", { weekday: "short", day: "numeric", month: "short" });
};
const isToday = (d) => d === todayStr();
const isPast = (d) => d && d < todayStr();
const isUpcoming = (d) => d && d > todayStr();

const loadState = () => {
  try {
    const s = localStorage.getItem("maxplan_v1");
    if (s) return JSON.parse(s);
  } catch {}
  return { tasks: [], projects: [] };
};

const saveState = (state) => {
  try { localStorage.setItem("maxplan_v1", JSON.stringify(state)); } catch {}
};

export default function MaxPlan() {
  const [state, setState] = useState(loadState);
  const [view, setView] = useState(VIEWS.TODAY);
  const [aiLoading, setAiLoading] = useState(false);
  const [captureInput, setCaptureInput] = useState("");
  const [newTaskText, setNewTaskText] = useState("");
  const [addingTo, setAddingTo] = useState(null);
  const [editingTask, setEditingTask] = useState(null);
  const [editingProject, setEditingProject] = useState(null);
  const [selectedProject, setSelectedProject] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [toast, setToast] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const inputRef = useRef(null);

  const update = useCallback((newState) => {
    setState(newState);
    saveState(newState);
  }, []);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2500); };

  const addTask = (fields) => {
    const task = { id: generateId(), text: "", done: false, priority: PRIORITIES.NONE, date: null, projectId: null, createdAt: Date.now(), ...fields };
    update({ ...state, tasks: [...state.tasks, task] });
  };

  const updateTask = useCallback((id, fields) => {
    setState(prev => {
      const next = { ...prev, tasks: prev.tasks.map(t => t.id === id ? { ...t, ...fields } : t) };
      saveState(next);
      return next;
    });
  }, []);

  const deleteTask = (id) => {
    setState(prev => { const next = { ...prev, tasks: prev.tasks.filter(t => t.id !== id) }; saveState(next); return next; });
    setConfirmDelete(null);
    showToast("Задачу видалено");
  };

  const toggleDone = (id) => {
    setState(prev => {
      const t = prev.tasks.find(t => t.id === id);
      const next = { ...prev, tasks: prev.tasks.map(tk => tk.id === id ? { ...tk, done: !tk.done } : tk) };
      saveState(next);
      return next;
    });
  };

  const addProject = () => {
    const p = { id: generateId(), name: "Новий проєкт", color: "#7c6fcd" };
    const next = { ...state, projects: [...state.projects, p] };
    update(next);
    setSelectedProject(p.id);
    setView(VIEWS.PROJECTS);
    setEditingProject(p.id);
    setSidebarOpen(false);
  };

  const updateProject = (id, fields) => {
    setState(prev => { const next = { ...prev, projects: prev.projects.map(p => p.id === id ? { ...p, ...fields } : p) }; saveState(next); return next; });
  };

  const deleteProject = (id) => {
    setState(prev => { const next = { ...prev, projects: prev.projects.filter(p => p.id !== id), tasks: prev.tasks.map(t => t.projectId === id ? { ...t, projectId: null } : t) }; saveState(next); return next; });
    if (selectedProject === id) { setSelectedProject(null); setView(VIEWS.PROJECTS); }
    setConfirmDelete(null);
    showToast("Проєкт видалено");
  };

  const runAiCapture = async () => {
    if (!captureInput.trim() || aiLoading) return;
    setAiLoading(true);
    const input = captureInput;
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 1000,
          system: `Ти — AI-асистент для планування задач. Аналізуй текстовий потік свідомості та витягни конкретні задачі.
Повернути ТІЛЬКИ JSON масив, без жодного іншого тексту, без markdown і без блоків коду.
Кожен елемент: text (назва задачі, коротко, українською), priority ("high"|"med"|"low"|"none"), date ("YYYY-MM-DD" або null, сьогодні = ${todayStr()}).
Мінімум 1, максимум 8 задач.`,
          messages: [{ role: "user", content: input }],
        }),
      });
      const data = await res.json();
      const raw = data.content?.[0]?.text?.trim() || "[]";
      let tasks;
      try { tasks = JSON.parse(raw); } catch { tasks = []; }
      if (tasks.length) {
        const newTasks = tasks.map(t => ({ id: generateId(), text: t.text || "Задача", done: false, priority: t.priority || PRIORITIES.NONE, date: t.date || null, projectId: null, createdAt: Date.now() }));
        setState(prev => { const next = { ...prev, tasks: [...prev.tasks, ...newTasks] }; saveState(next); return next; });
        setCaptureInput("");
        showToast(`Додано ${newTasks.length} задач${newTasks.length === 1 ? "у" : newTasks.length < 5 ? "и" : ""}`);
        setView(VIEWS.INBOX);
      } else {
        showToast("Не вдалося витягти задачі — спробуй ще раз");
      }
    } catch {
      showToast("Помилка AI — перевір з'єднання");
    }
    setAiLoading(false);
  };

  const todayTasks = state.tasks.filter(t => isToday(t.date) || (!t.done && isPast(t.date)));
  const upcomingTasks = state.tasks.filter(t => isUpcoming(t.date));
  const inboxTasks = state.tasks.filter(t => !t.date && !t.projectId);

  const navigate = (v, projId = null) => {
    setView(v);
    setSelectedProject(projId);
    setSidebarOpen(false);
  };

  const renderTask = (task) => {
    const proj = state.projects.find(p => p.id === task.projectId);
    const isEditing = editingTask === task.id;
    return (
      <div key={task.id} className="task-row">
        <button className="task-check" onClick={() => toggleDone(task.id)} style={{ borderColor: task.done ? PRIORITY_COLORS[task.priority] : undefined, background: task.done ? PRIORITY_COLORS[task.priority] : undefined }} aria-label="Виконано">
          {task.done && <i className="ti ti-check" style={{ fontSize: 10, color: "#fff" }} />}
        </button>
        <div className="task-body">
          {isEditing ? (
            <input className="task-edit-input" autoFocus defaultValue={task.text}
              onBlur={e => { updateTask(task.id, { text: e.target.value }); setEditingTask(null); }}
              onKeyDown={e => { if (e.key === "Enter") e.target.blur(); if (e.key === "Escape") setEditingTask(null); }} />
          ) : (
            <span className="task-text" onClick={() => setEditingTask(task.id)} style={{ textDecoration: task.done ? "line-through" : "none", color: task.done ? "var(--text-tertiary)" : "var(--text-primary)" }}>
              {task.text || "Без назви"}
            </span>
          )}
          <div className="task-meta">
            {task.priority !== PRIORITIES.NONE && <span style={{ fontSize: 11, color: PRIORITY_COLORS[task.priority] }}>{PRIORITY_LABELS[task.priority]}</span>}
            {task.date && <span className="task-date" style={{ color: isPast(task.date) && !task.done ? "var(--danger)" : "var(--text-secondary)" }}>
              <i className="ti ti-calendar" style={{ fontSize: 11, marginRight: 3 }} />{formatDate(task.date)}
            </span>}
            {proj && <span className="proj-badge" style={{ color: proj.color, background: proj.color + "22" }}>{proj.name}</span>}
          </div>
        </div>
        <TaskMenu task={task} projects={state.projects} onUpdate={f => updateTask(task.id, f)} onDelete={() => setConfirmDelete({ type: "task", id: task.id })} />
      </div>
    );
  };

  const renderAddTask = (defaults = {}) => {
    const key = JSON.stringify(defaults);
    if (addingTo !== key) return (
      <button className="add-task-btn" onClick={() => { setAddingTo(key); setNewTaskText(""); setTimeout(() => inputRef.current?.focus(), 50); }}>
        <i className="ti ti-plus" style={{ fontSize: 15 }} /> Додати задачу
      </button>
    );
    return (
      <div className="add-task-form">
        <input ref={inputRef} value={newTaskText} onChange={e => setNewTaskText(e.target.value)}
          placeholder="Назва задачі..."
          onKeyDown={e => {
            if (e.key === "Enter" && newTaskText.trim()) { addTask({ text: newTaskText.trim(), ...defaults }); setNewTaskText(""); setAddingTo(null); }
            if (e.key === "Escape") setAddingTo(null);
          }} className="add-task-input" />
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button className="btn-primary" onClick={() => { if (newTaskText.trim()) addTask({ text: newTaskText.trim(), ...defaults }); setAddingTo(null); }}>Додати</button>
          <button className="btn-secondary" onClick={() => setAddingTo(null)}>Скасувати</button>
        </div>
      </div>
    );
  };

  return (
    <div className="app">
      {/* Mobile header */}
      <div className="mobile-header">
        <button className="hamburger" onClick={() => setSidebarOpen(v => !v)} aria-label="Меню">
          <i className="ti ti-menu-2" style={{ fontSize: 20 }} />
        </button>
        <span className="app-name">Max Plan</span>
      </div>

      {/* Sidebar overlay on mobile */}
      {sidebarOpen && <div className="overlay" onClick={() => setSidebarOpen(false)} />}

      {/* Sidebar */}
      <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
        <div className="sidebar-header">
          <span className="app-name">Max Plan</span>
        </div>
        {[
          { id: VIEWS.CAPTURE, icon: "ti-wand", label: "AI Capture" },
          { id: VIEWS.TODAY, icon: "ti-sun", label: "Сьогодні", count: todayTasks.filter(t => !t.done).length },
          { id: VIEWS.UPCOMING, icon: "ti-calendar", label: "Згодом", count: upcomingTasks.filter(t => !t.done).length },
          { id: VIEWS.INBOX, icon: "ti-inbox", label: "Inbox", count: inboxTasks.filter(t => !t.done).length },
        ].map(item => (
          <SidebarItem key={item.id} icon={item.icon} label={item.label} count={item.count}
            active={view === item.id && !selectedProject}
            onClick={() => navigate(item.id)} />
        ))}

        <div className="sidebar-section-header">
          <span>Проєкти</span>
          <button onClick={addProject} className="icon-btn" title="Новий проєкт"><i className="ti ti-plus" style={{ fontSize: 15 }} /></button>
        </div>

        {state.projects.map(p => (
          <SidebarItem key={p.id}
            icon="ti-circle-filled"
            iconColor={p.color}
            label={editingProject === p.id ? (
              <input autoFocus defaultValue={p.name}
                onBlur={e => { updateProject(p.id, { name: e.target.value }); setEditingProject(null); }}
                onKeyDown={e => { if (e.key === "Enter" || e.key === "Escape") e.target.blur(); }}
                className="proj-name-input"
                onClick={e => e.stopPropagation()} />
            ) : p.name}
            count={state.tasks.filter(t => t.projectId === p.id && !t.done).length}
            active={selectedProject === p.id}
            onClick={() => navigate(VIEWS.PROJECTS, p.id)} />
        ))}
        {state.projects.length === 0 && <div className="sidebar-hint">Натисни + щоб додати</div>}
      </aside>

      {/* Main content */}
      <main className="main">
        {view === VIEWS.CAPTURE && !selectedProject && (
          <CaptureView input={captureInput} setInput={setCaptureInput} onSubmit={runAiCapture} loading={aiLoading} />
        )}
        {view === VIEWS.TODAY && !selectedProject && (
          <TaskListView title="Сьогодні"
            subtitle={new Date().toLocaleDateString("uk-UA", { weekday: "long", day: "numeric", month: "long" })}
            tasks={todayTasks} renderTask={renderTask}
            renderAdd={() => renderAddTask({ date: todayStr() })}
            emptyMsg="Сьогодні вільно 🎉" />
        )}
        {view === VIEWS.UPCOMING && !selectedProject && (
          <UpcomingView tasks={upcomingTasks} renderTask={renderTask} renderAdd={() => renderAddTask({})} />
        )}
        {view === VIEWS.INBOX && !selectedProject && (
          <TaskListView title="Inbox" subtitle="Задачі без дати і проєкту"
            tasks={inboxTasks} renderTask={renderTask}
            renderAdd={() => renderAddTask({})}
            emptyMsg="Inbox порожній ✓" />
        )}
        {view === VIEWS.PROJECTS && selectedProject && (() => {
          const proj = state.projects.find(p => p.id === selectedProject);
          if (!proj) return null;
          const ptasks = state.tasks.filter(t => t.projectId === selectedProject);
          return (
            <div>
              <div className="proj-header">
                <div style={{ width: 12, height: 12, borderRadius: "50%", background: proj.color, flexShrink: 0 }} />
                <h1 className="page-title">{proj.name}</h1>
                <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                  <button className="icon-btn" onClick={() => setEditingProject(proj.id)} title="Перейменувати"><i className="ti ti-edit" style={{ fontSize: 16 }} /></button>
                  <button className="icon-btn danger" onClick={() => setConfirmDelete({ type: "project", id: proj.id })} title="Видалити"><i className="ti ti-trash" style={{ fontSize: 16 }} /></button>
                </div>
              </div>
              <div className="color-picker">
                {PROJECT_COLORS.map(c => (
                  <button key={c} onClick={() => updateProject(proj.id, { color: c })}
                    className="color-dot"
                    style={{ background: c, outline: proj.color === c ? `2px solid ${c}` : "none", outlineOffset: 2 }} />
                ))}
              </div>
              <TaskListView title={null} tasks={ptasks} renderTask={renderTask}
                renderAdd={() => renderAddTask({ projectId: selectedProject })}
                emptyMsg="Задач немає — додай першу" />
            </div>
          );
        })()}
        {view === VIEWS.PROJECTS && !selectedProject && (
          <div>
            <h1 className="page-title" style={{ marginBottom: 24 }}>Проєкти</h1>
            {state.projects.length === 0 ? (
              <div>
                <p style={{ color: "var(--text-secondary)", marginBottom: 16 }}>У тебе ще немає проєктів.</p>
                <button className="btn-primary" onClick={addProject}>Створити проєкт</button>
              </div>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {state.projects.map(p => {
                  const count = state.tasks.filter(t => t.projectId === p.id && !t.done).length;
                  return (
                    <div key={p.id} className="proj-card" onClick={() => navigate(VIEWS.PROJECTS, p.id)}>
                      <div style={{ width: 10, height: 10, borderRadius: "50%", background: p.color }} />
                      <span style={{ flex: 1, fontSize: 15 }}>{p.name}</span>
                      {count > 0 && <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>{count}</span>}
                      <i className="ti ti-chevron-right" style={{ fontSize: 14, color: "var(--text-tertiary)" }} />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Confirm modal */}
      {confirmDelete && (
        <div className="modal-backdrop" onClick={() => setConfirmDelete(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <p style={{ fontSize: 15, marginBottom: 20 }}>
              {confirmDelete.type === "project" ? "Видалити проєкт? Задачі залишаться в Inbox." : "Видалити задачу?"}
            </p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn-secondary" onClick={() => setConfirmDelete(null)}>Скасувати</button>
              <button className="btn-danger" onClick={() => confirmDelete.type === "project" ? deleteProject(confirmDelete.id) : deleteTask(confirmDelete.id)}>Видалити</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && <div className="toast">{toast}</div>}

      <style>{`
        .app { display: flex; height: 100vh; overflow: hidden; }
        .mobile-header { display: none; }
        .sidebar { width: 220px; flex-shrink: 0; background: var(--bg-sidebar); border-right: 1px solid var(--border); display: flex; flex-direction: column; overflow-y: auto; }
        .sidebar-header { padding: 20px 16px 16px; border-bottom: 1px solid var(--border); }
        .app-name { font-size: 15px; font-weight: 500; letter-spacing: -0.3px; color: var(--text-primary); }
        .main { flex: 1; overflow-y: auto; padding: 36px 48px; background: var(--bg-main); }
        .page-title { font-size: 22px; font-weight: 500; margin: 0; letter-spacing: -0.4px; }
        .page-subtitle { font-size: 13px; color: var(--text-secondary); margin: 4px 0 24px; }

        /* Sidebar items */
        .sidebar-item { display: flex; align-items: center; gap: 10px; padding: 7px 16px; background: none; border: none; cursor: pointer; width: 100%; text-align: left; transition: background 0.1s; }
        .sidebar-item:hover { background: var(--bg-hover); }
        .sidebar-item.active { background: var(--bg-hover); }
        .sidebar-item-label { font-size: 14px; color: var(--text-secondary); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .sidebar-item.active .sidebar-item-label { color: var(--text-primary); }
        .sidebar-item-count { font-size: 12px; color: var(--text-tertiary); }
        .sidebar-section-header { display: flex; justify-content: space-between; align-items: center; padding: 16px 16px 6px; border-top: 1px solid var(--border); margin-top: 8px; }
        .sidebar-section-header span { font-size: 11px; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.5px; font-weight: 500; }
        .sidebar-hint { padding: 4px 16px; font-size: 12px; color: var(--text-tertiary); }

        /* Tasks */
        .task-row { display: flex; align-items: flex-start; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--border); }
        .task-check { width: 18px; height: 18px; border-radius: 50%; border: 1.5px solid #888; background: transparent; cursor: pointer; flex-shrink: 0; margin-top: 1px; display: flex; align-items: center; justify-content: center; transition: all 0.15s; }
        .task-check:hover { border-color: #555; }
        .task-body { flex: 1; min-width: 0; }
        .task-text { font-size: 14px; cursor: text; word-break: break-word; line-height: 1.5; }
        .task-edit-input { width: 100%; font-size: 14px; background: transparent; border: none; border-bottom: 1px solid var(--border-strong); outline: none; color: var(--text-primary); padding: 2px 0; }
        .task-meta { display: flex; gap: 8px; margin-top: 4px; flex-wrap: wrap; align-items: center; }
        .task-date { font-size: 11px; color: var(--text-secondary); }
        .proj-badge { font-size: 11px; border-radius: 4px; padding: 1px 6px; }

        /* Add task */
        .add-task-btn { display: flex; align-items: center; gap: 6px; padding: 10px 0; color: var(--text-tertiary); background: none; border: none; cursor: pointer; font-size: 14px; width: 100%; transition: color 0.15s; }
        .add-task-btn:hover { color: var(--text-secondary); }
        .add-task-form { padding: 10px 0; border-top: 1px solid var(--border); }
        .add-task-input { width: 100%; font-size: 14px; background: transparent; border: none; border-bottom: 1px solid var(--border-strong); outline: none; color: var(--text-primary); padding: 4px 0; }

        /* Buttons */
        .btn-primary { font-size: 13px; padding: 7px 16px; border-radius: var(--radius); background: var(--text-primary); color: var(--bg-card); border: none; cursor: pointer; font-weight: 500; transition: opacity 0.15s; }
        .btn-primary:hover { opacity: 0.85; }
        .btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }
        .btn-secondary { font-size: 13px; padding: 7px 16px; border-radius: var(--radius); background: none; border: 1px solid var(--border-strong); cursor: pointer; color: var(--text-secondary); transition: background 0.15s; }
        .btn-secondary:hover { background: var(--bg-hover); }
        .btn-danger { font-size: 13px; padding: 7px 16px; border-radius: var(--radius); background: var(--danger); color: #fff; border: none; cursor: pointer; }
        .icon-btn { background: none; border: none; cursor: pointer; color: var(--text-secondary); padding: 5px; border-radius: 6px; display: flex; align-items: center; transition: background 0.15s; }
        .icon-btn:hover { background: var(--bg-hover); }
        .icon-btn.danger { color: var(--danger); }

        /* Projects */
        .proj-header { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
        .color-picker { display: flex; gap: 8px; margin-bottom: 24px; }
        .color-dot { width: 18px; height: 18px; border-radius: 50%; border: none; cursor: pointer; transition: transform 0.1s; padding: 0; }
        .color-dot:hover { transform: scale(1.2); }
        .proj-card { display: flex; align-items: center; gap: 12px; padding: 14px 16px; background: var(--bg-card); border: 1px solid var(--border); border-radius: var(--radius-lg); cursor: pointer; transition: border-color 0.15s; }
        .proj-card:hover { border-color: var(--border-strong); }
        .proj-name-input { background: transparent; border: none; outline: none; font-size: 14px; color: var(--text-primary); width: 100%; padding: 0; }

        /* Capture */
        .capture-textarea { width: 100%; min-height: 180px; font-size: 14px; line-height: 1.7; background: var(--bg-card); border: 1px solid var(--border-strong); border-radius: var(--radius-lg); padding: 16px; resize: vertical; color: var(--text-primary); outline: none; transition: border-color 0.15s; box-sizing: border-box; }
        .capture-textarea:focus { border-color: var(--text-tertiary); }

        /* Modal */
        .modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 100; }
        .modal { background: var(--bg-card); border-radius: var(--radius-lg); padding: 24px; max-width: 320px; width: 90%; border: 1px solid var(--border-strong); }

        /* Toast */
        .toast { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); background: var(--text-primary); color: var(--bg-main); padding: 10px 20px; border-radius: var(--radius); font-size: 13px; z-index: 200; white-space: nowrap; animation: fadeup 0.2s ease; }
        @keyframes fadeup { from { opacity: 0; transform: translateX(-50%) translateY(8px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }

        /* Dropdown menu */
        .dropdown { position: absolute; right: 0; top: 100%; background: var(--bg-card); border: 1px solid var(--border-strong); border-radius: var(--radius-lg); padding: 4px 0; min-width: 200px; z-index: 50; margin-top: 4px; box-shadow: 0 4px 16px rgba(0,0,0,0.08); }
        .dropdown-section-label { padding: 6px 12px 2px; font-size: 10px; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.5px; }
        .dropdown-item { display: flex; align-items: center; gap: 8px; padding: 7px 12px; width: 100%; background: none; border: none; cursor: pointer; font-size: 13px; color: var(--text-secondary); text-align: left; transition: background 0.1s; }
        .dropdown-item:hover { background: var(--bg-hover); }
        .dropdown-item.active { color: var(--text-primary); font-weight: 500; }
        .dropdown-item.danger { color: var(--danger); }
        .dropdown-divider { height: 1px; background: var(--border); margin: 4px 0; }

        /* Done section */
        .done-toggle { background: none; border: none; cursor: pointer; color: var(--text-tertiary); font-size: 12px; padding: 6px 0; display: flex; align-items: center; gap: 6px; margin-top: 16px; }
        .done-toggle:hover { color: var(--text-secondary); }

        /* Upcoming groups */
        .upcoming-group-label { font-size: 11px; font-weight: 500; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px; margin-top: 24px; }

        /* Mobile */
        @media (max-width: 640px) {
          .mobile-header { display: flex; align-items: center; gap: 12px; padding: 14px 16px; background: var(--bg-sidebar); border-bottom: 1px solid var(--border); position: sticky; top: 0; z-index: 40; }
          .hamburger { background: none; border: none; cursor: pointer; color: var(--text-primary); padding: 0; }
          .app { flex-direction: column; }
          .sidebar { position: fixed; left: 0; top: 0; bottom: 0; z-index: 50; transform: translateX(-100%); transition: transform 0.25s ease; width: 260px; }
          .sidebar-open { transform: translateX(0); }
          .overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.3); z-index: 49; }
          .main { padding: 20px 20px; }
        }
      `}</style>
    </div>
  );
}

function SidebarItem({ icon, iconColor, label, count, active, onClick }) {
  return (
    <button className={`sidebar-item ${active ? "active" : ""}`} onClick={onClick}>
      <i className={`ti ${icon}`} style={{ fontSize: 15, color: iconColor || "var(--text-tertiary)", flexShrink: 0 }} aria-hidden="true" />
      <span className="sidebar-item-label">{label}</span>
      {count > 0 && <span className="sidebar-item-count">{count}</span>}
    </button>
  );
}

function TaskListView({ title, subtitle, tasks, renderTask, renderAdd, emptyMsg }) {
  const done = tasks.filter(t => t.done);
  const active = tasks.filter(t => !t.done);
  const [showDone, setShowDone] = useState(false);

  return (
    <div>
      {title && <h1 className="page-title">{title}</h1>}
      {subtitle && <p className="page-subtitle">{subtitle}</p>}
      {!title && !subtitle && <div style={{ marginBottom: 8 }} />}
      {active.length === 0 && done.length === 0 && <p style={{ color: "var(--text-secondary)", marginTop: 8 }}>{emptyMsg}</p>}
      {active.map(t => renderTask(t))}
      {renderAdd && renderAdd()}
      {done.length > 0 && (
        <div>
          <button className="done-toggle" onClick={() => setShowDone(v => !v)}>
            <i className={`ti ${showDone ? "ti-chevron-down" : "ti-chevron-right"}`} style={{ fontSize: 12 }} />
            Виконані ({done.length})
          </button>
          {showDone && done.map(t => renderTask(t))}
        </div>
      )}
    </div>
  );
}

function UpcomingView({ tasks, renderTask, renderAdd }) {
  const groups = {};
  tasks.forEach(t => { if (!groups[t.date]) groups[t.date] = []; groups[t.date].push(t); });
  const sorted = Object.keys(groups).sort();

  return (
    <div>
      <h1 className="page-title">Згодом</h1>
      {sorted.length === 0 && <p style={{ color: "var(--text-secondary)", marginTop: 12 }}>Немає запланованих задач</p>}
      {sorted.map(date => (
        <div key={date}>
          <div className="upcoming-group-label">{formatDate(date)}</div>
          {groups[date].map(t => renderTask(t))}
        </div>
      ))}
      <div style={{ marginTop: 8 }}>{renderAdd && renderAdd()}</div>
    </div>
  );
}

function CaptureView({ input, setInput, onSubmit, loading }) {
  return (
    <div>
      <h1 className="page-title">AI Capture</h1>
      <p className="page-subtitle">Вивали все з голови — AI розкладе на задачі з пріоритетом і датою</p>
      <textarea className="capture-textarea" value={input} onChange={e => setInput(e.target.value)}
        placeholder={"Наприклад: «Треба зателефонувати Олені щодо зустрічі завтра, не забути купити ліки, терміново відповісти Максу на листа, в п'ятницю здати звіт...»"}
        onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onSubmit(); }} />
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12 }}>
        <button className="btn-primary" onClick={onSubmit} disabled={loading || !input.trim()}>
          {loading ? <><i className="ti ti-loader" style={{ fontSize: 14, marginRight: 6 }} />Аналізую…</> : <><i className="ti ti-wand" style={{ fontSize: 14, marginRight: 6 }} />Розкласти на задачі</>}
        </button>
        <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>⌘↵ або Ctrl+↵</span>
      </div>
    </div>
  );
}

function TaskMenu({ task, projects, onUpdate, onDelete }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const h = e => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative", flexShrink: 0 }}>
      <button className="icon-btn" onClick={() => setOpen(v => !v)} aria-label="Меню">
        <i className="ti ti-dots" style={{ fontSize: 15 }} />
      </button>
      {open && (
        <div className="dropdown">
          <div className="dropdown-section-label">Пріоритет</div>
          {Object.entries(PRIORITY_LABELS).map(([k, v]) => (
            <button key={k} className={`dropdown-item ${task.priority === k ? "active" : ""}`}
              onClick={() => { onUpdate({ priority: k }); setOpen(false); }}>
              <i className="ti ti-flag" style={{ fontSize: 13, color: PRIORITY_COLORS[k] }} aria-hidden="true" />
              {v}
              {task.priority === k && <i className="ti ti-check" style={{ fontSize: 12, marginLeft: "auto" }} />}
            </button>
          ))}
          <div className="dropdown-divider" />
          <div className="dropdown-section-label">Дата</div>
          {[
            { label: "Сьогодні", icon: "ti-sun", date: () => todayStr() },
            { label: "Завтра", icon: "ti-calendar", date: () => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().split("T")[0]; } },
            { label: "Наступний тиждень", icon: "ti-calendar-week", date: () => { const d = new Date(); d.setDate(d.getDate() + 7); return d.toISOString().split("T")[0]; } },
          ].map(({ label, icon, date }) => (
            <button key={label} className={`dropdown-item ${task.date === date() ? "active" : ""}`}
              onClick={() => { onUpdate({ date: date() }); setOpen(false); }}>
              <i className={`ti ${icon}`} style={{ fontSize: 13 }} aria-hidden="true" />{label}
            </button>
          ))}
          <DatePickerItem value={task.date} onChange={d => { onUpdate({ date: d }); setOpen(false); }} />
          {task.date && (
            <button className="dropdown-item" onClick={() => { onUpdate({ date: null }); setOpen(false); }}>
              <i className="ti ti-x" style={{ fontSize: 13 }} aria-hidden="true" />Прибрати дату
            </button>
          )}
          {projects.length > 0 && <>
            <div className="dropdown-divider" />
            <div className="dropdown-section-label">Проєкт</div>
            {projects.map(p => (
              <button key={p.id} className={`dropdown-item ${task.projectId === p.id ? "active" : ""}`}
                onClick={() => { onUpdate({ projectId: task.projectId === p.id ? null : p.id }); setOpen(false); }}>
                <i className="ti ti-circle-filled" style={{ fontSize: 13, color: p.color }} aria-hidden="true" />{p.name}
                {task.projectId === p.id && <i className="ti ti-check" style={{ fontSize: 12, marginLeft: "auto" }} />}
              </button>
            ))}
          </>}
          <div className="dropdown-divider" />
          <button className="dropdown-item danger" onClick={() => { onDelete(); setOpen(false); }}>
            <i className="ti ti-trash" style={{ fontSize: 13 }} aria-hidden="true" />Видалити
          </button>
        </div>
      )}
    </div>
  );
}

function DatePickerItem({ value, onChange }) {
  const [show, setShow] = useState(false);
  if (!show) return (
    <button className="dropdown-item" onClick={e => { e.stopPropagation(); setShow(true); }}>
      <i className="ti ti-calendar-event" style={{ fontSize: 13 }} aria-hidden="true" />Інша дата…
    </button>
  );
  return (
    <div style={{ padding: "6px 12px" }}>
      <input type="date" defaultValue={value || ""} autoFocus
        onChange={e => onChange(e.target.value)}
        onClick={e => e.stopPropagation()}
        onBlur={() => setShow(false)}
        style={{ fontSize: 13, width: "100%", background: "var(--bg-hover)", border: "1px solid var(--border-strong)", borderRadius: 6, padding: "5px 8px", color: "var(--text-primary)" }} />
    </div>
  );
}
