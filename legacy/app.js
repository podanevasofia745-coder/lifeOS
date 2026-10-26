import { dateKey, monthCells, remainingSeconds } from './model.js';
const $ = id => document.getElementById(id);
const today = dateKey(new Date());
let selected = today;
let month = new Date(`${today}T12:00:00`);
let tasks = [];
try {
  const saved = JSON.parse(localStorage.getItem('lifeos.tasks') || '[]');
  if (Array.isArray(saved)) tasks = saved.filter(t => t && typeof t.id === 'string' && typeof t.text === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t.date) && typeof t.done === 'boolean');
} catch { $('storageStatus').textContent = 'Не удалось прочитать сохранённые задачи. Можно продолжить работу.'; }
function save() {
  try { localStorage.setItem('lifeos.tasks', JSON.stringify(tasks)); $('storageStatus').textContent = ''; }
  catch { $('storageStatus').textContent = 'Браузер не разрешил сохранение. Задачи доступны только до закрытия страницы.'; }
  render();
}
function render() {
  $('month').textContent = month.toLocaleDateString('ru-RU', { month:'long', year:'numeric' });
  $('selectedLabel').textContent = new Date(`${selected}T12:00:00`).toLocaleDateString('ru-RU', { day:'numeric', month:'long', weekday:'short' });
  $('days').replaceChildren();
  for (const key of monthCells(month)) {
    const el = document.createElement(key ? 'button' : 'span');
    if (key) {
      el.textContent = Number(key.slice(-2));
      el.classList.toggle('selected', key === selected);
      el.classList.toggle('is-today', key === today);
      el.classList.toggle('has-task', tasks.some(t => t.date === key));
      el.setAttribute('aria-label', new Date(`${key}T12:00:00`).toLocaleDateString('ru-RU', {dateStyle:'full'}));
      el.setAttribute('aria-pressed', String(key === selected));
      el.onclick = () => { selected = key; render(); };
    }
    $('days').append(el);
  }
  const list = tasks.filter(t => t.date === selected);
  const done = list.filter(t => t.done).length;
  $('count').textContent = `${done} / ${list.length}`;
  $('taskList').replaceChildren();
  if (!list.length) {
    const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = 'Пока здесь чистый лист. Добавьте первую задачу — и день обретёт форму.'; $('taskList').append(empty);
  }
  for (const task of list) {
    const row = document.createElement('div'); row.className = `task${task.done ? ' done' : ''}`;
    const check = document.createElement('input'); check.type = 'checkbox'; check.checked = task.done; check.id = `task-${task.id}`;
    check.onchange = () => { task.done = check.checked; save(); };
    const label = document.createElement('label'); label.htmlFor = check.id; label.textContent = task.text;
    const remove = document.createElement('button'); remove.textContent = '×'; remove.setAttribute('aria-label', `Удалить: ${task.text}`); remove.onclick = () => { tasks = tasks.filter(t => t.id !== task.id); save(); };
    row.append(check, label, remove); $('taskList').append(row);
  }
  $('progressBar').style.width = `${list.length ? done / list.length * 100 : 0}%`;
  $('progressText').textContent = list.length && done === list.length ? 'Всё сделано. Оставьте время для себя.' : `Выполнено ${done} из ${list.length} задач`;
  const previous = $('focusTask').value;
  $('focusTask').replaceChildren(new Option('Свободная сессия', ''));
  list.filter(t => !t.done).forEach(t => $('focusTask').add(new Option(t.text, t.id)));
  if ([...$('focusTask').options].some(o => o.value === previous)) $('focusTask').value = previous;
}
$('todayLabel').textContent = new Date().toLocaleDateString('ru-RU', { day:'numeric', month:'long', year:'numeric' });
$('taskForm').onsubmit = e => { e.preventDefault(); const text = $('taskInput').value.trim(); if (!text) return; tasks.push({ id:crypto.randomUUID(), text, date:selected, done:false }); $('taskInput').value = ''; save(); $('taskInput').focus(); };
for (const [id, delta] of [['prev', -1], ['next', 1]]) $(id).onclick = () => { month = new Date(month.getFullYear(), month.getMonth() + delta, 1); render(); };
$('today').onclick = () => { selected = today; month = new Date(`${today}T12:00:00`); render(); };
let remaining = 1500, deadline = null;
function paintTimer() {
  if (deadline !== null) {
    remaining = remainingSeconds(deadline, Date.now());
    if (!remaining) { deadline = null; $('timerStatus').textContent = 'Сессия завершена. Сделайте небольшой перерыв.'; $('toggleTimer').textContent = 'Ещё одна сессия'; $('focusTask').disabled = false; }
  }
  $('timer').textContent = `${String(Math.floor(remaining / 60)).padStart(2,'0')}:${String(remaining % 60).padStart(2,'0')}`;
}
$('toggleTimer').onclick = () => {
  if (deadline !== null) { remaining = remainingSeconds(deadline, Date.now()); deadline = null; $('toggleTimer').textContent = 'Продолжить'; $('timerStatus').textContent = 'Сессия на паузе'; }
  else { if (!remaining) remaining = 1500; deadline = Date.now() + remaining * 1000; $('toggleTimer').textContent = 'Пауза'; $('timerStatus').textContent = 'Время сосредоточиться. Всё остальное подождёт.'; }
  $('focusTask').disabled = deadline !== null; paintTimer();
};
$('resetTimer').onclick = () => { deadline = null; remaining = 1500; $('toggleTimer').textContent = 'Начать фокус'; $('timerStatus').textContent = '25 минут для того, что действительно важно'; $('focusTask').disabled = false; paintTimer(); };
setInterval(paintTimer, 250);
document.addEventListener('visibilitychange', paintTimer);
render();
