(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const canvas = $("#board");
  const frame = $("#board-frame");
  const ctx = canvas.getContext("2d", { alpha: false });
  const dialog = $("#app-dialog");
  const dialogContent = $("#dialog-content");
  const dialogActions = $("#dialog-actions");
  const dialogForm = $("#dialog-form");
  const STORAGE = { notes: "smart-whiteboard.notes.v1", draft: "smart-whiteboard.draft.v1", theme: "smart-whiteboard.theme.v1" };
  const HISTORY_LIMIT = 60;
  const colors = ["#202938", "#e24646", "#3974e8", "#29966a", "#f2c434", "#ed8b2f", "#9057ca"];
  const state = {
    pages: [blankPage()],
    pageIndex: 0,
    tool: "pencil",
    color: "#202938",
    stroke: 4,
    duster: 26,
    zoom: 1,
    panX: 0,
    panY: 0,
    currentNoteId: null,
    title: "Untitled board",
    history: [],
    future: [],
    pointers: new Map(),
    gesture: null,
    drawing: false,
    draggingText: -1,
    moving: false,
    dusterMoved: false,
    lastPoint: null,
    autosaveTimer: 0,
    resizeObserver: null
  };

  function blankPage() { return { strokes: [], texts: [], background: "Blank" }; }
  const page = () => state.pages[state.pageIndex];
  const clone = (value) => JSON.parse(JSON.stringify(value));

  function toast(message, duration = 2600) {
    const item = document.createElement("div");
    item.className = "toast";
    item.textContent = message;
    $("#toast-region").append(item);
    window.setTimeout(() => item.remove(), duration);
  }

  function setStatus(text, error = false) {
    $("#save-status").textContent = text;
    $(".status-dot").style.background = error ? "#e16b71" : "#65bf91";
  }

  function safeRead(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value === null ? fallback : JSON.parse(value);
    } catch (error) {
      console.error("Smart Whiteboard could not read local data:", error);
      toast("Local data could not be read. Check your browser storage settings.");
      return fallback;
    }
  }

  function safeWrite(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      console.error("Smart Whiteboard could not save local data:", error);
      setStatus("Storage unavailable", true);
      toast("Could not save locally. Your browser storage may be full or disabled.");
      return false;
    }
  }

  function refreshCanvasSize() {
    const rect = frame.getBoundingClientRect();
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      render();
    }
  }

  function drawPaper(width, height) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    const bg = page().background;
    if (bg === "Blank") return;
    ctx.save();
    ctx.strokeStyle = "#e7edf5";
    ctx.lineWidth = 1;
    const gap = bg === "Graph" ? 28 : 38;
    if (bg === "Graph") {
      for (let x = gap; x < width; x += gap) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
      }
    }
    for (let y = gap; y < height; y += gap) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
    }
    ctx.restore();
  }

  function render() {
    if (!canvas.width || !canvas.height) return;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const width = canvas.width / dpr;
    const height = canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.translate(state.panX, state.panY);
    ctx.scale(state.zoom, state.zoom);
    drawPaper(width, height);
    page().strokes.forEach((stroke) => drawStroke(stroke, width, height));
    page().texts.forEach((item, index) => {
      const x = item.x * width;
      const y = item.y * height;
      const size = item.size * width;
      ctx.save();
      ctx.fillStyle = item.color;
      ctx.font = `${size}px "DM Sans", "Segoe UI", sans-serif`;
      ctx.textBaseline = "alphabetic";
      ctx.fillText(item.text, x, y);
      if (index === state.draggingText) {
        const bounds = ctx.measureText(item.text);
        ctx.strokeStyle = "#6685ea";
        ctx.lineWidth = 1.3;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(x - 5, y - size - 4, bounds.width + 10, size + 10);
      }
      ctx.restore();
    });
    if (state.tool === "duster" && state.lastPoint) {
      ctx.beginPath();
      ctx.arc(state.lastPoint.x, state.lastPoint.y, state.duster, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(82, 119, 238, .10)";
      ctx.fill();
      ctx.strokeStyle = "rgba(82, 119, 238, .72)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.restore();
    $("#canvas-hint").classList.toggle("is-hidden", page().strokes.length + page().texts.length > 0);
    $("#zoom-indicator").textContent = `${Math.round(state.zoom * 100)}%`;
    $("#page-label").textContent = `Page ${state.pageIndex + 1} of ${state.pages.length}`;
    $("#board-title").textContent = state.title;
  }

  function drawStroke(stroke, width, height) {
    const pts = stroke.points;
    if (!pts.length) return;
    ctx.save();
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
    ctx.lineWidth = stroke.width * width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(pts[0].x * width, pts[0].y * height);
    if (pts.length === 1) {
      ctx.arc(pts[0].x * width, pts[0].y * height, Math.max(1, stroke.width * width / 2), 0, Math.PI * 2);
      ctx.fill();
    } else {
      for (let i = 1; i < pts.length; i++) {
        const prev = pts[i - 1], cur = pts[i];
        const mx = (prev.x + cur.x) * width / 2;
        const my = (prev.y + cur.y) * height / 2;
        ctx.quadraticCurveTo(prev.x * width, prev.y * height, mx, my);
      }
      const last = pts[pts.length - 1];
      ctx.lineTo(last.x * width, last.y * height);
      ctx.stroke();
    }
    ctx.restore();
  }

  function snapshot() {
    state.history.push(clone({ pages: state.pages, pageIndex: state.pageIndex }));
    if (state.history.length > HISTORY_LIMIT) state.history.shift();
    state.future.length = 0;
    updateHistoryButtons();
  }

  function restoreSnapshot(value) {
    state.pages = value.pages;
    state.pageIndex = Math.min(value.pageIndex, state.pages.length - 1);
    if (state.pageIndex < 0) state.pageIndex = 0;
    changed();
  }

  function undo() {
    if (!state.history.length) return;
    state.future.push(clone({ pages: state.pages, pageIndex: state.pageIndex }));
    restoreSnapshot(state.history.pop());
    updateHistoryButtons();
  }

  function redo() {
    if (!state.future.length) return;
    state.history.push(clone({ pages: state.pages, pageIndex: state.pageIndex }));
    restoreSnapshot(state.future.pop());
    updateHistoryButtons();
  }

  function updateHistoryButtons() {
    $("#undo-button").disabled = state.history.length === 0;
    $("#redo-button").disabled = state.future.length === 0;
  }

  function changed() {
    render();
    setStatus("Saving…");
    window.clearTimeout(state.autosaveTimer);
    state.autosaveTimer = window.setTimeout(autosave, 260);
  }

  function autosave() {
    const data = serializeBoard();
    const ok = safeWrite(STORAGE.draft, {
      title: state.title,
      currentNoteId: state.currentNoteId,
      board: data,
      updatedAt: Date.now()
    });
    if (!ok) return;
    if (state.currentNoteId) {
      const notes = getNotes();
      const note = notes.find((item) => item.id === state.currentNoteId);
      if (note) {
        note.board = data;
        note.updatedAt = Date.now();
        if (!safeWrite(STORAGE.notes, notes)) return;
      }
    }
    setStatus("Saved on this device");
  }

  function serializeBoard() {
    return { version: 1, pages: clone(state.pages), pageIndex: state.pageIndex };
  }

  function normalizeBoard(input) {
    if (input && Array.isArray(input.pages)) {
      const pages = input.pages.map(normalizePage);
      return { pages: pages.length ? pages : [blankPage()], pageIndex: Math.max(0, Math.min(Number(input.pageIndex) || 0, pages.length - 1)) };
    }
    return { pages: [normalizePage(input || {})], pageIndex: 0 };
  }

  function normalizePage(input) {
    const allowedBackgrounds = ["Blank", "Lined", "Graph"];
    const strokes = Array.isArray(input.strokes) ? input.strokes.filter((stroke) => stroke && Array.isArray(stroke.points) && stroke.points.length)
      .map((stroke) => ({
        color: normalizeColor(stroke.color),
        width: clamp(Number(stroke.width) || 0.004, 0.0005, 0.04),
        points: stroke.points.map((point) => {
          const x = Array.isArray(point) ? point[0] : point.x;
          const y = Array.isArray(point) ? point[1] : point.y;
          return { x: clamp(Number(x) || 0, 0, 1), y: clamp(Number(y) || 0, 0, 1) };
        })
      })) : [];
    const texts = Array.isArray(input.texts) ? input.texts.filter((item) => item && typeof item.text === "string")
      .map((item) => ({
        text: item.text.slice(0, 2000),
        x: clamp(Number(item.x) || 0, 0, 1),
        y: clamp(Number(item.y) || 0, 0, 1),
        color: normalizeColor(item.color),
        size: clamp(Number(item.size) || 0.04, 0.01, 0.12)
      })) : [];
    return { strokes, texts, background: allowedBackgrounds.includes(input.background) ? input.background : "Blank" };
  }

  function normalizeColor(value) {
    if (typeof value === "string" && /^#[\da-f]{6}$/i.test(value)) return value;
    if (typeof value === "number" && Number.isFinite(value)) return `#${(value >>> 0).toString(16).slice(-6).padStart(6, "0")}`;
    return "#202938";
  }

  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

  function currentPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: (event.clientX - rect.left - state.panX) / state.zoom, y: (event.clientY - rect.top - state.panY) / state.zoom };
  }

  function textHit(point, width, height) {
    for (let i = page().texts.length - 1; i >= 0; i--) {
      const item = page().texts[i];
      ctx.save();
      ctx.font = `${item.size * width}px "DM Sans", "Segoe UI", sans-serif`;
      const measured = ctx.measureText(item.text);
      const x = item.x * width, y = item.y * height;
      const hit = point.x >= x - 10 && point.x <= x + measured.width + 10 && point.y >= y - item.size * width - 8 && point.y <= y + 8;
      ctx.restore();
      if (hit) return i;
    }
    return -1;
  }

  function distanceToSegment(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = dx * dx + dy * dy;
    if (!len) return Math.hypot(p.x - a.x, p.y - a.y);
    const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / len, 0, 1);
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  }

  function eraseStrokeAt(point, width, height) {
    let hit = -1;
    for (let i = page().strokes.length - 1; i >= 0 && hit < 0; i--) {
      const stroke = page().strokes[i], pts = stroke.points;
      const radius = Math.max(18, stroke.width * width * 1.4);
      for (let j = 0; j < pts.length; j++) {
        const a = { x: pts[j].x * width, y: pts[j].y * height };
        if ((j === 0 && Math.hypot(point.x - a.x, point.y - a.y) <= radius) ||
            (j > 0 && distanceToSegment(point, { x: pts[j - 1].x * width, y: pts[j - 1].y * height }, a) <= radius)) {
          hit = i; break;
        }
      }
    }
    if (hit < 0) return false;
    snapshot();
    page().strokes.splice(hit, 1);
    changed();
    return true;
  }

  function dusterPass(point, width, height) {
    const radius = state.duster;
    let changedAny = false;
    const output = [];
    page().strokes.forEach((stroke) => {
      const pieces = [];
      let run = [];
      let strokeChanged = false;
      const step = Math.max(2, radius / 3);
      const addSample = (x, y) => {
        if (Math.hypot(x - point.x, y - point.y) > radius + stroke.width * width / 2) {
          run.push({ x: x / width, y: y / height });
        } else {
          if (run.length) pieces.push(run);
          run = [];
          strokeChanged = true;
          changedAny = true;
        }
      };
      if (!stroke.points.length) return;
      addSample(stroke.points[0].x * width, stroke.points[0].y * height);
      for (let i = 1; i < stroke.points.length; i++) {
        const a = stroke.points[i - 1], b = stroke.points[i];
        const ax = a.x * width, ay = a.y * height, bx = b.x * width, by = b.y * height;
        const length = Math.hypot(bx - ax, by - ay);
        const count = Math.max(1, Math.ceil(length / step));
        if (distanceToSegment(point, { x: ax, y: ay }, { x: bx, y: by }) <= radius + stroke.width * width / 2) {
          for (let n = 1; n <= count; n++) {
            const t = n / count;
            addSample(ax + (bx - ax) * t, ay + (by - ay) * t);
          }
        } else {
          run.push({ x: b.x, y: b.y });
        }
      }
      if (run.length) pieces.push(run);
      if (strokeChanged) pieces.filter((part) => part.length).forEach((part) => output.push({ ...stroke, points: part }));
      else output.push(stroke);
    });
    const texts = page().texts;
    const keptTexts = texts.filter((item) => {
      ctx.save();
      ctx.font = `${item.size * width}px "DM Sans", "Segoe UI", sans-serif`;
      const tw = ctx.measureText(item.text).width;
      ctx.restore();
      const x = item.x * width, y = item.y * height;
      const touched = point.x >= x - radius && point.x <= x + tw + radius && point.y >= y - item.size * width - radius && point.y <= y + radius;
      if (touched) changedAny = true;
      return !touched;
    });
    if (!changedAny) return false;
    page().strokes = output;
    page().texts = keptTexts;
    changed();
    return true;
  }

  function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function pointerCenter(points) {
    const list = [...points.values()];
    return { x: list.reduce((sum, p) => sum + p.x, 0) / list.length, y: list.reduce((sum, p) => sum + p.y, 0) / list.length };
  }

  canvas.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (state.pointers.size >= 2) {
      state.gesture = {
        distance: distance(...[...state.pointers.values()].slice(0, 2)),
        center: pointerCenter(state.pointers),
        zoom: state.zoom, panX: state.panX, panY: state.panY
      };
      state.drawing = false;
      state.draggingText = -1;
      return;
    }
    const point = currentPoint(event);
    const width = frame.clientWidth, height = frame.clientHeight;
    state.lastPoint = point;
    state.dusterMoved = false;
    if (state.tool === "pencil") {
      snapshot();
      page().strokes.push({ color: state.color, width: state.stroke / width, points: [{ x: point.x / width, y: point.y / height }] });
      state.drawing = true;
      changed();
    } else if (state.tool === "duster") {
      snapshot();
      state.drawing = true;
      dusterPass(point, width, height);
    } else if (state.tool === "eraser") {
      const textIndex = textHit(point, width, height);
      if (textIndex >= 0) {
        snapshot();
        page().texts.splice(textIndex, 1);
        changed();
      } else {
        eraseStrokeAt(point, width, height);
      }
    } else if (state.tool === "text") {
      const index = textHit(point, width, height);
      if (index >= 0) editText(index);
      else addTextAt(point, width, height);
    } else if (state.tool === "select") {
      state.draggingText = textHit(point, width, height);
      if (state.draggingText >= 0) state.textStart = { point, item: clone(page().texts[state.draggingText]), snapshotTaken: false };
      else {
        state.panning = true;
        state.lastPanPoint = { x: event.clientX, y: event.clientY };
      }
    }
    render();
  });

  canvas.addEventListener("pointermove", (event) => {
    if (state.pointers.has(event.pointerId)) state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (state.pointers.size >= 2 && state.gesture) {
      const points = [...state.pointers.values()].slice(0, 2);
      const center = pointerCenter(state.pointers);
      const nextZoom = clamp(state.gesture.zoom * distance(points[0], points[1]) / Math.max(1, state.gesture.distance), 1, 4);
      const rect = canvas.getBoundingClientRect();
      const cx = center.x - rect.left, cy = center.y - rect.top;
      const startX = state.gesture.center.x - rect.left, startY = state.gesture.center.y - rect.top;
      const ratio = nextZoom / state.gesture.zoom;
      state.zoom = nextZoom;
      state.panX = cx - (startX - state.gesture.panX) * ratio;
      state.panY = cy - (startY - state.gesture.panY) * ratio;
      constrainPan();
      render();
      return;
    }
    if (!state.drawing && state.draggingText < 0 && !state.panning) return;
    const point = currentPoint(event);
    const width = frame.clientWidth, height = frame.clientHeight;
    if (state.tool === "pencil" && state.drawing) {
      const stroke = page().strokes[page().strokes.length - 1];
      stroke.points.push({ x: point.x / width, y: point.y / height });
      state.lastPoint = point;
      render();
    } else if (state.tool === "duster" && state.drawing) {
      if (state.lastPoint && distance(point, state.lastPoint) > 2) state.dusterMoved = true;
      if (state.lastPoint) {
        const dist = distance(point, state.lastPoint);
        const count = Math.max(1, Math.ceil(dist / Math.max(4, state.duster / 3)));
        for (let i = 1; i <= count; i++) {
          const t = i / count;
          dusterPass({ x: state.lastPoint.x + (point.x - state.lastPoint.x) * t, y: state.lastPoint.y + (point.y - state.lastPoint.y) * t }, width, height);
        }
      }
      state.lastPoint = point;
      render();
    } else if (state.tool === "select" && state.draggingText >= 0 && state.textStart) {
      const original = state.textStart;
      if (!original.snapshotTaken && distance(point, original.point) > 2) {
        snapshot();
        original.snapshotTaken = true;
        state.moving = true;
      }
      if (state.moving) {
        const item = page().texts[state.draggingText];
        item.x = clamp(original.item.x + (point.x - original.point.x) / width, 0, 1);
        item.y = clamp(original.item.y + (point.y - original.point.y) / height, 0, 1);
        render();
      }
    } else if (state.tool === "select" && state.panning) {
      state.panX += event.clientX - state.lastPanPoint.x;
      state.panY += event.clientY - state.lastPanPoint.y;
      state.lastPanPoint = { x: event.clientX, y: event.clientY };
      constrainPan();
      render();
    }
    state.lastPoint = point;
  });

  canvas.addEventListener("pointerup", (event) => finishPointer(event));
  canvas.addEventListener("pointercancel", (event) => finishPointer(event));
  function finishPointer(event) {
    state.pointers.delete(event.pointerId);
    if (state.pointers.size < 2) state.gesture = null;
    if (state.tool === "select" && state.draggingText >= 0) {
      if (state.moving) changed();
      else editText(state.draggingText);
    }
    state.drawing = false;
    state.draggingText = -1;
    state.moving = false;
    state.panning = false;
    state.lastPoint = null;
    render();
  }

  function constrainPan() {
    const width = frame.clientWidth, height = frame.clientHeight;
    state.panX = clamp(state.panX, width * (1 - state.zoom), 0);
    state.panY = clamp(state.panY, height * (1 - state.zoom), 0);
  }

  function addTextAt(point, width, height) {
    showDialog({
      title: "Add text",
      content: textEditorContent("", false),
      actions: [actionButton("Cancel", "quiet"), actionButton("Add text", "primary", "submit")],
      onSubmit: () => {
        const input = $("#text-value", dialogContent);
        const text = input.value.trim();
        if (!text) { toast("Type something to add to your board."); return false; }
        snapshot();
        page().texts.push({
          text, x: clamp(point.x / width, 0, 1), y: clamp(point.y / height, 0.05, 0.98),
          color: $("#text-color", dialogContent).value, size: Number($("#text-size", dialogContent).value)
        });
        changed();
        return true;
      }
    });
  }

  function textEditorContent(text, includeDelete) {
    return `<label class="field-label" for="text-value">Your text</label>
      <input class="text-input" id="text-value" maxlength="2000" placeholder="Write a note..." value="${escapeHtml(text)}" autocomplete="off">
      <div class="text-style-row"><label class="field-label" for="text-color">Color</label><input id="text-color" type="color" value="#202938" aria-label="Text color">
        <label class="field-label" for="text-size">Size</label><select id="text-size" aria-label="Text size"><option value="0.03">Small</option><option value="0.04" selected>Medium</option><option value="0.055">Large</option></select></div>
      ${includeDelete ? '<p class="dialog-help">To move this text, drag it using the Select tool.</p>' : ""}`;
  }

  function editText(index) {
    if (index < 0 || !page().texts[index]) return;
    const item = page().texts[index];
    showDialog({
      title: "Edit text",
      content: textEditorContent(item.text, true),
      actions: [actionButton("Delete", "quiet danger-button", "submit", "delete"), actionButton("Cancel", "quiet"), actionButton("Update", "primary", "submit")],
      onSubmit: (event) => {
        if (event.submitter?.dataset.action === "delete") {
          snapshot();
          page().texts.splice(index, 1);
          changed();
          return true;
        }
        const value = $("#text-value", dialogContent).value.trim();
        if (!value) { toast("Text cannot be empty. Use Delete to remove it."); return false; }
        snapshot();
        page().texts[index] = {
          ...item, text: value, color: $("#text-color", dialogContent).value,
          size: Number($("#text-size", dialogContent).value)
        };
        changed();
        return true;
      }
    });
    $("#text-color", dialogContent).value = item.color;
    const sizes = [0.03, 0.04, 0.055];
    $("#text-size", dialogContent).value = String(sizes.reduce((a, b) => Math.abs(b - item.size) < Math.abs(a - item.size) ? b : a, sizes[0]));
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  }

  function actionButton(label, style = "quiet", type = "button", action = "") {
    const close = type === "button" && !action ? 'data-dialog-close="true"' : "";
    return `<button class="button button-${style}" type="${type}" ${close} ${action ? `data-action="${action}"` : ""}>${label}</button>`;
  }

  function showDialog({ title, content, actions = [], onSubmit }) {
    $("#dialog-title").textContent = title;
    dialogContent.innerHTML = content;
    dialogActions.innerHTML = actions.join("");
    $$("[data-dialog-close]", dialogActions).forEach((button) => button.addEventListener("click", () => dialog.close()));
    dialogForm.onsubmit = (event) => {
      event.preventDefault();
      const close = onSubmit ? onSubmit(event) : true;
      if (close !== false) dialog.close();
    };
    dialog.showModal();
    const input = $("input:not([type=color]), textarea", dialogContent);
    if (input) window.setTimeout(() => input.focus(), 0);
  }

  function getNotes() {
    const notes = safeRead(STORAGE.notes, []);
    return Array.isArray(notes) ? notes.filter((note) => note && typeof note.id === "string") : [];
  }

  function saveNote(title = state.title) {
    const notes = getNotes();
    const name = title.trim() || "Untitled board";
    const now = Date.now();
    let note = notes.find((item) => item.id === state.currentNoteId);
    if (!note) {
      note = { id: crypto.randomUUID ? crypto.randomUUID() : `${now}-${Math.random().toString(36).slice(2)}`, createdAt: now };
      notes.unshift(note);
    }
    note.title = name;
    note.board = serializeBoard();
    note.updatedAt = now;
    if (!safeWrite(STORAGE.notes, notes)) return false;
    state.currentNoteId = note.id;
    state.title = name;
    safeWrite(STORAGE.draft, { title: state.title, currentNoteId: state.currentNoteId, board: serializeBoard(), updatedAt: now });
    render();
    setStatus("Saved on this device");
    toast(`“${name}” saved`);
    return true;
  }

  function openSaveDialog() {
    showDialog({
      title: "Save your whiteboard",
      content: `<label class="field-label" for="note-name">Note title</label><input class="text-input" id="note-name" maxlength="80" placeholder="e.g. Project brainstorm" value="${escapeHtml(state.title === "Untitled board" ? "" : state.title)}"><p class="dialog-help">Your note is stored locally on this device and is available offline.</p>`,
      actions: [actionButton("Cancel"), actionButton("Save note", "primary", "submit")],
      onSubmit: () => saveNote($("#note-name", dialogContent).value)
    });
  }

  function openLibrary() {
    const notes = getNotes();
    let rows = "";
    if (!notes.length) {
      rows = '<div class="dialog-empty">No saved notes yet. Save your first board to find it here.</div>';
    } else {
      rows = `<div class="note-list">${notes.map((note) => {
        const date = new Date(note.updatedAt || note.createdAt || Date.now()).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
        return `<div class="note-row" data-note-id="${escapeHtml(note.id)}"><button class="note-open" type="button" data-open-note="${escapeHtml(note.id)}"><span class="note-title">${escapeHtml(note.title || "Untitled board")}</span><span class="note-date">${escapeHtml(date)}</span></button><button class="icon-button" type="button" data-rename-note="${escapeHtml(note.id)}" aria-label="Rename ${escapeHtml(note.title || "note")}" title="Rename"><svg viewBox="0 0 24 24"><path d="m14 5 5 5M4 20l4-.8L19 8a2.1 2.1 0 0 0-3-3L5 16l-1 4Z"/></svg></button><button class="icon-button danger-button" type="button" data-delete-note="${escapeHtml(note.id)}" aria-label="Delete ${escapeHtml(note.title || "note")}" title="Delete"><svg viewBox="0 0 24 24"><path d="M4 7h16m-10 4v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3"/></svg></button></div>`;
      }).join("")}</div>`;
    }
    showDialog({ title: "Your notes", content: rows, actions: [actionButton("Done", "primary")] });
    $$("[data-open-note]", dialogContent).forEach((button) => button.addEventListener("click", () => loadNote(button.dataset.openNote)));
    $$("[data-rename-note]", dialogContent).forEach((button) => button.addEventListener("click", () => renameNote(button.dataset.renameNote)));
    $$("[data-delete-note]", dialogContent).forEach((button) => button.addEventListener("click", () => deleteNote(button.dataset.deleteNote)));
  }

  function loadNote(id) {
    const note = getNotes().find((item) => item.id === id);
    if (!note) { toast("This saved note is no longer available."); openLibrary(); return; }
    const board = normalizeBoard(note.board);
    state.pages = board.pages;
    state.pageIndex = board.pageIndex;
    state.title = note.title || "Untitled board";
    state.currentNoteId = note.id;
    state.history.length = 0;
    state.future.length = 0;
    state.zoom = 1; state.panX = 0; state.panY = 0;
    dialog.close();
    changed();
    updateHistoryButtons();
    toast(`Opened “${state.title}”`);
  }

  function renameNote(id) {
    const note = getNotes().find((item) => item.id === id);
    if (!note) return;
    showDialog({
      title: "Rename note",
      content: `<label class="field-label" for="rename-value">New title</label><input class="text-input" id="rename-value" maxlength="80" value="${escapeHtml(note.title || "")}">`,
      actions: [actionButton("Cancel"), actionButton("Rename", "primary", "submit")],
      onSubmit: () => {
        const notes = getNotes();
        const target = notes.find((item) => item.id === id);
        if (!target) return true;
        target.title = $("#rename-value", dialogContent).value.trim() || "Untitled board";
        target.updatedAt = Date.now();
        if (!safeWrite(STORAGE.notes, notes)) return false;
        if (state.currentNoteId === id) { state.title = target.title; render(); }
        toast("Note renamed");
        window.setTimeout(openLibrary, 0);
        return true;
      }
    });
  }

  function deleteNote(id) {
    const note = getNotes().find((item) => item.id === id);
    if (!note || !window.confirm(`Delete “${note.title || "Untitled board"}” from your notes?`)) return;
    const notes = getNotes().filter((item) => item.id !== id);
    if (!safeWrite(STORAGE.notes, notes)) return;
    if (state.currentNoteId === id) state.currentNoteId = null;
    toast("Note deleted");
    dialog.close();
    window.setTimeout(openLibrary, 0);
  }

  function clearPage() {
    if (!page().strokes.length && !page().texts.length && page().background === "Blank") {
      toast("This page is already blank.");
      return;
    }
    if (!window.confirm("Clear all writing and text from this page? You can undo this action.")) return;
    snapshot();
    state.pages[state.pageIndex] = blankPage();
    changed();
  }

  function setTool(tool) {
    state.tool = tool;
    canvas.dataset.tool = tool;
    $$(".tool-button[data-tool]").forEach((button) => {
      const active = button.dataset.tool === tool;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    $("#duster-size-control").classList.toggle("is-visible", tool === "duster");
    state.lastPoint = null;
    render();
  }

  function setColor(color) {
    state.color = color;
    $("#pencil-color").value = color;
    $("#color-preview").style.backgroundColor = color;
  }

  function createNewBoard() {
    if ((page().strokes.length || page().texts.length || state.currentNoteId) &&
        !window.confirm("Start a new board? Your saved notes will stay in the library.")) return;
    state.pages = [blankPage()];
    state.pageIndex = 0;
    state.currentNoteId = null;
    state.title = "Untitled board";
    state.history.length = 0; state.future.length = 0;
    state.zoom = 1; state.panX = 0; state.panY = 0;
    changed();
    updateHistoryButtons();
  }

  function changePage(index) {
    if (index < 0 || index >= state.pages.length) return;
    state.pageIndex = index;
    state.history.length = 0; state.future.length = 0;
    render();
    updateHistoryButtons();
    autosave();
  }

  function addPage() {
    snapshot();
    state.pages.push(blankPage());
    state.pageIndex = state.pages.length - 1;
    changed();
    updateHistoryButtons();
  }

  function moreMenu() {
    const options = [
      ["New board", "Start a fresh whiteboard"],
      ["Background", `Currently ${page().background.toLowerCase()}`],
      ["Light / dark theme", document.body.classList.contains("dark-theme") ? "Switch to light appearance" : "Switch to dark appearance"],
      ["Import editable file", "Open a .swhiteboard or JSON file"],
      ["Export editable file", "Download the full notebook"]
    ];
    showDialog({
      title: "More options",
      content: options.map(([name, desc], index) => `<button class="dialog-option" type="button" data-more="${index}"><span>${name}</span><small>${desc}</small></button>`).join(""),
      actions: [actionButton("Done", "primary")]
    });
    $$("[data-more]", dialogContent).forEach((button) => button.addEventListener("click", () => {
      const index = Number(button.dataset.more);
      dialog.close();
      if (index === 0) createNewBoard();
      if (index === 1) chooseBackground();
      if (index === 2) toggleTheme();
      if (index === 3) $("#import-file").click();
      if (index === 4) downloadEditable();
    }));
  }

  function chooseBackground() {
    const choices = ["Blank", "Lined", "Graph"];
    showDialog({
      title: "Choose a background",
      content: choices.map((name) => `<button class="dialog-option" type="button" data-background="${name}"><span>${name} paper</span><small>${page().background === name ? "Selected" : "Apply to this page"}</small></button>`).join(""),
      actions: [actionButton("Done", "primary")]
    });
    $$("[data-background]", dialogContent).forEach((button) => button.addEventListener("click", () => {
      snapshot();
      page().background = button.dataset.background;
      changed();
      dialog.close();
    }));
  }

  function toggleTheme() {
    const dark = document.body.classList.toggle("dark-theme");
    safeWrite(STORAGE.theme, dark ? "dark" : "light");
    document.querySelector('meta[name="theme-color"]').content = dark ? "#151a22" : "#f5f7fb";
  }

  function download(name, blob) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = name;
    document.body.append(anchor); anchor.click(); anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function fileBase() {
    return (state.title || "whiteboard").trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, "-").replace(/\s+/g, "-").slice(0, 60) || "whiteboard";
  }

  function exportCanvas() {
    const width = frame.clientWidth, height = frame.clientHeight;
    const output = document.createElement("canvas");
    const dpr = 2;
    output.width = width * dpr; output.height = height * dpr;
    const outputCtx = output.getContext("2d");
    outputCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    outputCtx.fillStyle = "#fff"; outputCtx.fillRect(0, 0, width, height);
    outputCtx.save();
    outputCtx.translate(state.panX, state.panY); outputCtx.scale(state.zoom, state.zoom);
    const bg = page().background;
    outputCtx.fillStyle = "#fff"; outputCtx.fillRect(0, 0, width, height);
    outputCtx.strokeStyle = "#e7edf5"; outputCtx.lineWidth = 1;
    const gap = bg === "Graph" ? 28 : 38;
    if (bg === "Graph") for (let x = gap; x < width; x += gap) { outputCtx.beginPath(); outputCtx.moveTo(x, 0); outputCtx.lineTo(x, height); outputCtx.stroke(); }
    if (bg === "Lined" || bg === "Graph") for (let y = gap; y < height; y += gap) { outputCtx.beginPath(); outputCtx.moveTo(0, y); outputCtx.lineTo(width, y); outputCtx.stroke(); }
    page().strokes.forEach((stroke) => drawStrokeOn(outputCtx, stroke, width, height));
    page().texts.forEach((item) => {
      outputCtx.fillStyle = item.color; outputCtx.font = `${item.size * width}px "DM Sans", "Segoe UI", sans-serif`;
      outputCtx.textBaseline = "alphabetic"; outputCtx.fillText(item.text, item.x * width, item.y * height);
    });
    outputCtx.restore();
    return output;
  }

  function drawStrokeOn(target, stroke, width, height) {
    const pts = stroke.points;
    if (!pts.length) return;
    target.save(); target.strokeStyle = stroke.color; target.fillStyle = stroke.color;
    target.lineWidth = stroke.width * width; target.lineCap = "round"; target.lineJoin = "round";
    target.beginPath(); target.moveTo(pts[0].x * width, pts[0].y * height);
    if (pts.length === 1) { target.arc(pts[0].x * width, pts[0].y * height, Math.max(1, stroke.width * width / 2), 0, Math.PI * 2); target.fill(); }
    else {
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        target.quadraticCurveTo(a.x * width, a.y * height, (a.x + b.x) * width / 2, (a.y + b.y) * height / 2);
      }
      const end = pts[pts.length - 1]; target.lineTo(end.x * width, end.y * height); target.stroke();
    }
    target.restore();
  }

  function textContent() { return page().texts.map((item) => item.text).join("\n"); }

  async function shareBlob(blob, mime, filename, text = "") {
    const file = new File([blob], filename, { type: mime });
    if (navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
      try { await navigator.share({ title: state.title, text, files: [file] }); }
      catch (error) { if (error.name !== "AbortError") { console.error(error); toast("Sharing failed. The file was downloaded instead."); download(filename, blob); } }
    } else {
      download(filename, blob);
      toast("File downloaded. Attach it in your preferred sharing app.");
    }
  }

  function pdfEscape(text) {
    return text.replace(/[^\x20-\x7E]/g, "?").replace(/([\\()])/g, "\\$1");
  }

  function makePdf() {
    const width = 900, height = Math.round(width * frame.clientHeight / Math.max(1, frame.clientWidth));
    const commands = ["1 1 1 rg", `0 0 ${width} ${height} re f`];
    const background = page().background;
    const spacing = background === "Graph" ? 24 : 34;
    if (background !== "Blank") {
      commands.push("0.90 0.92 0.95 RG 0.5 w");
      if (background === "Graph") for (let x = spacing; x < width; x += spacing) commands.push(`${x} 0 m ${x} ${height} l S`);
      for (let y = spacing; y < height; y += spacing) commands.push(`0 ${height-y} m ${width} ${height-y} l S`);
    }
    page().strokes.forEach((stroke) => {
      const rgb = hexRgb(stroke.color);
      commands.push(`${rgb.r} ${rgb.g} ${rgb.b} RG`, `${Math.max(.7, stroke.width * width)} w`, "1 J 1 j");
      stroke.points.forEach((point, index) => {
        const x = point.x * width, y = height - point.y * height;
        commands.push(`${x.toFixed(2)} ${y.toFixed(2)} ${index ? "l" : "m"}`);
      });
      if (stroke.points.length === 1) {
        const p = stroke.points[0];
        commands.push(`${(p.x * width).toFixed(2)} ${(height - p.y * height).toFixed(2)} m ${(p.x * width + .5).toFixed(2)} ${(height - p.y * height).toFixed(2)} l`);
      }
      commands.push("S");
    });
    page().texts.forEach((item) => {
      const rgb = hexRgb(item.color);
      commands.push(`${rgb.r} ${rgb.g} ${rgb.b} rg`, "BT", `/F1 ${(item.size * width).toFixed(2)} Tf`,
        `1 0 0 1 ${(item.x * width).toFixed(2)} ${(height - item.y * height).toFixed(2)} Tm`,
        `(${pdfEscape(item.text)}) Tj`, "ET");
    });
    const stream = commands.join("\n");
    const objects = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`,
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
      `<< /Length ${new TextEncoder().encode(stream).length} >>\nstream\n${stream}\nendstream`
    ];
    let pdf = "%PDF-1.4\n";
    const offsets = [0];
    objects.forEach((object, index) => {
      offsets.push(new TextEncoder().encode(pdf).length);
      pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });
    const xref = new TextEncoder().encode(pdf).length;
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    offsets.slice(1).forEach((offset) => { pdf += `${String(offset).padStart(10, "0")} 00000 n \n`; });
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return new Blob([pdf], { type: "application/pdf" });
  }

  function hexRgb(hex) {
    const value = /^#[\da-f]{6}$/i.test(hex) ? hex : "#202938";
    return [1, 3, 5].reduce((result, index, i) => {
      result[["r", "g", "b"][i]] = (parseInt(value.slice(index, index + 2), 16) / 255).toFixed(3);
      return result;
    }, {});
  }

  async function runShareAction(action) {
    if (action === "text") {
      const text = textContent();
      if (!text) { toast("There is no typed text on this page to share."); return; }
      if (navigator.share) {
        try { await navigator.share({ title: state.title, text }); }
        catch (error) { if (error.name !== "AbortError") { console.error(error); toast("Text sharing failed."); } }
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        toast("Typed text copied to clipboard.");
      } else {
        download(`${fileBase()}-text.txt`, new Blob([text], { type: "text/plain;charset=utf-8" }));
      }
    } else if (action === "png") {
      const blob = await new Promise((resolve) => exportCanvas().toBlob(resolve, "image/png"));
      if (!blob) { toast("Could not export this board as an image."); return; }
      await shareBlob(blob, "image/png", `${fileBase()}.png`);
    } else if (action === "pdf") {
      await shareBlob(makePdf(), "application/pdf", `${fileBase()}.pdf`);
    } else {
      const blob = new Blob([JSON.stringify({ format: "swhiteboard", version: 1, title: state.title, board: serializeBoard() }, null, 2)], { type: "application/json" });
      await shareBlob(blob, "application/vnd.smartwhiteboard+json", `${fileBase()}.swhiteboard`);
    }
  }

  function shareMenu() {
    const options = [
      ["Share as PNG", "A crisp image of this page", "png"],
      ["Share as PDF", "A portable document of this page", "pdf"],
      ["Share typed text", "Share only typed text elements", "text"],
      ["Export editable file", "Keep all pages and editing data", "editable"]
    ];
    showDialog({
      title: "Share your whiteboard",
      content: options.map(([name, description, action]) => `<button class="dialog-option" type="button" data-share="${action}"><span>${name}</span><small>${description}</small></button>`).join(""),
      actions: [actionButton("Done", "primary")]
    });
    $$("[data-share]", dialogContent).forEach((button) => button.addEventListener("click", async () => {
      const action = button.dataset.share;
      dialog.close();
      try { await runShareAction(action); }
      catch (error) { console.error("Export or share failed:", error); toast("Export failed. Please try again."); }
    }));
  }

  function downloadEditable() {
    const contents = { format: "swhiteboard", version: 1, title: state.title, board: serializeBoard() };
    download(`${fileBase()}.swhiteboard`, new Blob([JSON.stringify(contents, null, 2)], { type: "application/json" }));
    toast("Editable notebook downloaded.");
  }

  async function importFile(file) {
    if (!file) return;
    try {
      if (file.size > 25 * 1024 * 1024) throw new Error("This file is larger than 25 MB.");
      const data = JSON.parse(await file.text());
      const board = normalizeBoard(data.board || data);
      state.pages = board.pages;
      state.pageIndex = board.pageIndex;
      state.title = typeof data.title === "string" ? data.title : file.name.replace(/\.(swhiteboard|json)$/i, "");
      state.currentNoteId = null;
      state.history.length = 0; state.future.length = 0;
      state.zoom = 1; state.panX = 0; state.panY = 0;
      changed(); updateHistoryButtons();
      toast("Editable whiteboard imported.");
    } catch (error) {
      console.error("Could not import whiteboard:", error);
      toast(`Could not open this whiteboard: ${error.message}`);
    } finally {
      $("#import-file").value = "";
    }
  }

  function wireEvents() {
    $("#save-button").addEventListener("click", openSaveDialog);
    $("#library-button").addEventListener("click", openLibrary);
    $("#share-button").addEventListener("click", shareMenu);
    $("#undo-button").addEventListener("click", undo);
    $("#redo-button").addEventListener("click", redo);
    $("#more-button").addEventListener("click", moreMenu);
    $("#clear-button").addEventListener("click", clearPage);
    $("#add-page").addEventListener("click", addPage);
    $("#prev-page").addEventListener("click", () => changePage(state.pageIndex - 1));
    $("#next-page").addEventListener("click", () => changePage(state.pageIndex + 1));
    $("#dialog-close").addEventListener("click", () => dialog.close());
    $("#pencil-color").addEventListener("input", (event) => { setColor(event.target.value); setTool("pencil"); });
    $("#pencil-size").addEventListener("change", (event) => { state.stroke = Number(event.target.value); });
    $("#duster-size").addEventListener("change", (event) => { state.duster = Number(event.target.value); render(); });
    $$(".tool-button[data-tool]").forEach((button) => button.addEventListener("click", () => setTool(button.dataset.tool)));
    $("#import-file").addEventListener("change", (event) => importFile(event.target.files[0]));
    window.addEventListener("resize", refreshCanvasSize);
    state.resizeObserver = new ResizeObserver(refreshCanvasSize);
    state.resizeObserver.observe(frame);
    document.addEventListener("keydown", (event) => {
      const target = event.target;
      const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
      if (typing || dialog.open) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        event.shiftKey ? redo() : undo();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
        event.preventDefault(); redo();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault(); openSaveDialog();
      } else if (event.key === "Escape") {
        setTool("select");
      }
    });
  }

  function init() {
    const theme = safeRead(STORAGE.theme, "light");
    if (theme === "dark") document.body.classList.add("dark-theme");
    const draft = safeRead(STORAGE.draft, null);
    if (draft && draft.board) {
      const board = normalizeBoard(draft.board);
      state.pages = board.pages; state.pageIndex = board.pageIndex;
      state.title = typeof draft.title === "string" ? draft.title : "Untitled board";
      state.currentNoteId = typeof draft.currentNoteId === "string" ? draft.currentNoteId : null;
    }
    $("#pencil-color").value = state.color;
    $("#color-preview").style.backgroundColor = state.color;
    wireEvents();
    setTool("pencil");
    refreshCanvasSize();
    render();
    updateHistoryButtons();
    if (location.protocol === "file:") {
      setStatus("Offline ready");
    }
  }

  init();
})();
