const fields = [
  "titulo",
  "subtitulo",
  "momentoGenerosidade",
  "avisos",
  "momentoVisao",
  "resumo",
  "conclusao",
];

const state = {
  perguntas: [],
  tipo: "life_group",
  textoExtraido: "",
  busy: false,
  editingSavedId: "",
  view: "preview",
  chatHistory: [],
};

const DB_NAME = "folha-estudo-arquivos";
const DB_VERSION = 1;
const STORE_NAME = "arquivos";

const $ = (id) => document.getElementById(id);

function setStatus(message, type = "") {
  const status = $("status");
  status.textContent = message;
  status.className = `status ${type}`.trim();
}

function buttonContent(label, loading = false) {
  return loading ? `<span class="spinner" aria-hidden="true"></span><span>${label}</span>` : label;
}

function getExtractLabel() {
  return "Criar PDF";
}

function getFileName() {
  return "folha-de-estudo-life-group.pdf";
}

function setBusy(isBusy, action = "") {
  state.busy = isBusy;
  const extractBtn = $("extractBtn");
  const downloadMenuBtn = $("downloadMenuBtn");
  const downloadPdfBtn = $("downloadPdfBtn");
  const downloadDocxBtn = $("downloadDocxBtn");
  const saveOnlineBtn = $("saveOnlineBtn");
  const addQuestion = $("addQuestion");
  const fileInput = $("pdfFile");
  const chatInput = $("chatInput");
  const chatSendBtn = $("chatSendBtn");
  const fieldsToToggle = [
    ...fields.map((field) => $(field)),
    ...document.querySelectorAll("#questions textarea, .questionRow button"),
  ];

  extractBtn.disabled = isBusy;
  downloadMenuBtn.disabled = isBusy;
  downloadPdfBtn.disabled = isBusy;
  downloadDocxBtn.disabled = isBusy;
  saveOnlineBtn.disabled = isBusy;
  addQuestion.disabled = isBusy;
  fileInput.disabled = isBusy;
  chatInput.disabled = isBusy;
  chatSendBtn.disabled = isBusy;
  fieldsToToggle.forEach((field) => {
    field.disabled = isBusy;
  });

  extractBtn.classList.toggle("loading", isBusy && action === "extract");
  downloadMenuBtn.classList.toggle("loading", isBusy && (action === "pdf" || action === "word"));
  saveOnlineBtn.classList.toggle("loading", isBusy && action === "save");
  chatSendBtn.classList.toggle("loading", isBusy && action === "chat");
  extractBtn.innerHTML = buttonContent(action === "extract" ? "Montando estrutura..." : getExtractLabel(), isBusy && action === "extract");
  downloadMenuBtn.innerHTML = buttonContent(action === "pdf" ? "Gerando PDF..." : action === "word" ? "Gerando DOCX..." : "Baixar", isBusy && (action === "pdf" || action === "word"));
  saveOnlineBtn.innerHTML = buttonContent(action === "save" ? "Salvando..." : "Salvar Arquivo Online", isBusy && action === "save");
  chatSendBtn.innerHTML = buttonContent(action === "chat" ? "Ajustando..." : "Enviar", isBusy && action === "chat");
  document.body.classList.toggle("isBusy", isBusy);
}

function fillForm(data) {
  if (data.tipo) {
    setMode(data.tipo);
  }
  fields.forEach((field) => {
    $(field).value = data[field] || "";
  });
  state.perguntas = Array.isArray(data.perguntas) ? data.perguntas : [];
  state.textoExtraido = data.textoExtraido || "";
  renderQuestions();
  renderPreview();
}

function renderQuestions() {
  const container = $("questions");
  container.innerHTML = "";
  state.perguntas.forEach((question, index) => {
    const row = document.createElement("div");
    row.className = "questionRow";

    const number = document.createElement("div");
    number.className = "number";
    number.textContent = index + 1;

    const input = document.createElement("textarea");
    input.rows = 2;
    input.value = question;
    input.addEventListener("input", () => {
      state.perguntas[index] = input.value;
      renderPreview();
    });

    const remove = document.createElement("button");
    remove.className = "remove";
    remove.type = "button";
    remove.textContent = "×";
    remove.title = "Remover pergunta";
    remove.addEventListener("click", () => {
      state.perguntas.splice(index, 1);
      renderQuestions();
      renderPreview();
    });

    row.append(number, input, remove);
    container.append(row);
  });
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function previewLines(value) {
  return String(value || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function previewText(value) {
  const lines = previewLines(value);
  if (!lines.length) {
    return "";
  }
  return lines.map((line) => `<p>${escapeHtml(line)}</p>`).join("");
}

function renderPreviewSection(label, value) {
  const body = previewText(value);
  if (!body) {
    return "";
  }
  return `<section class="previewSection"><h3>${escapeHtml(label)}</h3>${body}</section>`;
}

function renderPreview() {
  const preview = $("previewPane");
  if (!preview) {
    return;
  }
  const data = collectData();
  const hasContent = fields.some((field) => data[field]) || data.perguntas.length > 0;
  if (!hasContent) {
    preview.innerHTML = '<p class="previewEmpty">A prévia aparecerá aqui depois que você anexar um arquivo e gerar a folhinha.</p>';
    return;
  }

  const questions = data.perguntas
    .map((question, index) => {
      const lines = previewLines(question);
      if (!lines.length) {
        return "";
      }
      const first = `<strong>${index + 1}) ${escapeHtml(lines[0])}</strong>`;
      const rest = lines.slice(1).map((line) => `<span>${escapeHtml(line)}</span>`).join("");
      return `<li>${first}${rest}</li>`;
    })
    .filter(Boolean)
    .join("");

  preview.innerHTML = `
    <article class="previewSheet">
      <header class="previewHeader">
        <span>Estudo Life Group</span>
        <h3>Estudo Life Group</h3>
      </header>
      ${data.titulo ? `<p class="previewSeries"><strong>Série:</strong> “${escapeHtml(data.titulo)}”</p>` : ""}
      ${data.subtitulo ? `<p class="previewSubtitle">${escapeHtml(data.subtitulo)}</p>` : ""}
      ${renderPreviewSection("Momento Generosidade", data.momentoGenerosidade)}
      ${renderPreviewSection("Avisos / Agenda", data.avisos)}
      ${renderPreviewSection("Momento da Visão", data.momentoVisao)}
      ${renderPreviewSection("Introdução", data.resumo)}
      ${questions ? `<section class="previewSection"><h3>Perguntas</h3><ol class="previewQuestions">${questions}</ol></section>` : ""}
      ${renderPreviewSection("Conclusão", data.conclusao)}
    </article>
  `;
}

function setView(view) {
  state.view = view;
  $("previewPane").classList.toggle("hidden", view !== "preview");
  $("formEditor").classList.toggle("hidden", view !== "edit");
  $("previewViewBtn").classList.toggle("active", view === "preview");
  $("editViewBtn").classList.toggle("active", view === "edit");
  const stepLabel = $("stepLabel");
  if (stepLabel && !$("reviewLayout").classList.contains("hidden")) {
    stepLabel.textContent = "Revisão de conteúdo";
  }
}

function showReview() {
  $("uploadForm").classList.add("hidden");
  $("reviewLayout").classList.remove("hidden");
  document.body.classList.add("reviewOpen");
  $("stepLabel").textContent = "Revisão de conteúdo";
}

function collectData() {
  const data = {};
  fields.forEach((field) => {
    data[field] = $(field).value.trim();
  });
  data.perguntas = state.perguntas.map((item) => item.trim()).filter(Boolean);
  data.tipo = "life_group";
  data.textoExtraido = state.textoExtraido;
  return data;
}

function validatePdfData(data) {
  if (!data.titulo || !data.resumo) {
    setStatus("Preencha pelo menos o título e o resumo antes de baixar.", "error");
    return false;
  }
  return true;
}

function appendChatMessage(role, message) {
  const messages = $("chatMessages");
  const item = document.createElement("div");
  item.className = `chatMessage ${role}`;
  item.textContent = message;
  messages.append(item);
  messages.scrollTop = messages.scrollHeight;
}

function hasGeneratedContent(data) {
  return fields.some((field) => data[field]) || data.perguntas.length > 0;
}

async function talkWithAssistant(message) {
  const response = await fetch("/api/revise", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      data: collectData(),
      history: state.chatHistory.slice(-8),
    }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.erro || "Não foi possível ajustar a folhinha.");
  }
  return data;
}

async function generatePdfBlob(data) {
  const response = await fetch("/api/pdf", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.erro || "Não foi possível gerar o PDF.");
  }
  return response.blob();
}

async function generateWordBlob(data) {
  const response = await fetch("/api/word", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.erro || "Não foi possível gerar o Word.");
  }
  return response.blob();
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function openSavedDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function savePdfOnline(blob, data) {
  const db = await openSavedDb();
  const id = state.editingSavedId || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const file = {
    id,
    name: getFileName(),
    title: data.titulo || "Arquivo sem título",
    type: data.tipo,
    size: blob.size,
    createdAt: new Date().toISOString(),
    data,
    blob,
  };

  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(file);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  return file;
}

function formatRecentDate(value) {
  if (!value) {
    return "";
  }
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

async function getRecentSavedFiles() {
  const db = await openSavedDb();
  const files = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return files
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 5);
}

function openRecentFile(file) {
  if (!file.data) {
    window.location.href = "/salvos.html";
    return;
  }
  sessionStorage.setItem(
    "folhaEstudoEditDraft",
    JSON.stringify({
      id: file.id,
      name: file.name,
      createdAt: file.createdAt,
      data: file.data,
    }),
  );
  window.location.href = "/editar.html";
}

async function renderRecentFiles() {
  const container = $("recentFiles");
  if (!container) {
    return;
  }
  try {
    const files = await getRecentSavedFiles();
    if (!files.length) {
      container.innerHTML = '<p class="recentEmpty">Nenhum PDF salvo ainda.</p>';
      return;
    }
    container.innerHTML = "";
    files.forEach((file) => {
      const button = document.createElement("button");
      button.className = "recentItem";
      button.type = "button";
      button.addEventListener("click", () => openRecentFile(file));

      const icon = document.createElement("span");
      icon.className = "recentIcon";
      icon.setAttribute("aria-hidden", "true");

      const text = document.createElement("span");
      text.className = "recentText";

      const title = document.createElement("strong");
      title.textContent = file.title || "Folha salva";

      const meta = document.createElement("span");
      meta.textContent = formatRecentDate(file.createdAt);

      text.append(title, meta);
      button.append(icon, text);
      container.append(button);
    });
  } catch (error) {
    container.innerHTML = '<p class="recentEmpty">Não foi possível carregar os recentes.</p>';
  }
}

function loadSavedDraftForEditing() {
  const raw = sessionStorage.getItem("folhaEstudoEditDraft");
  if (!raw) {
    return false;
  }
  sessionStorage.removeItem("folhaEstudoEditDraft");
  try {
    const saved = JSON.parse(raw);
    if (!saved || !saved.data) {
      return false;
    }
    state.editingSavedId = saved.id || "";
    fillForm(saved.data);
    showReview();
    setStatus("Arquivo salvo aberto para edição. Ajuste o que precisar e salve novamente.", "ok");
    return true;
  } catch (error) {
    setStatus("Não foi possível abrir o arquivo salvo para edição.", "error");
    return false;
  }
}

function setMode() {
  if (state.busy) {
    return;
  }
  state.tipo = "life_group";
  $("modeEyebrow").textContent = "Life Group";
  $("tituloLabel").textContent = "Título da série";
  $("subtituloLabel").textContent = "Linha do culto";
  $("resumoLabel").textContent = "Resumo";
  document.querySelectorAll(".lifeOnly").forEach((element) => {
    element.classList.remove("hidden");
  });
  $("extractBtn").innerHTML = getExtractLabel();
}

$("pdfFile").addEventListener("change", (event) => {
  const file = event.target.files[0];
  $("fileName").textContent = file ? file.name : "Nenhum arquivo escolhido";
});

$("uploadForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (state.busy) {
    return;
  }
  const file = $("pdfFile").files[0];
  if (!file) {
    setStatus("Escolha um PDF ou Word antes de extrair.", "error");
    return;
  }

  setStatus("Lendo o arquivo e organizando os campos...");
  setBusy(true, "extract");
  const form = new FormData();
  form.append("arquivo", file);
  form.append("tipo", "life_group");

  try {
    const response = await fetch("/api/extract", {
      method: "POST",
      body: form,
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.erro || "Não foi possível extrair o arquivo.");
    }
    fillForm(data);
    showReview();
    setView("preview");
    setStatus("Conteúdo extraído. Revise e ajuste o que precisar antes de baixar.", "ok");
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    setBusy(false);
  }
});

$("addQuestion").addEventListener("click", () => {
  if (state.busy) {
    return;
  }
  state.perguntas.push("");
  renderQuestions();
  renderPreview();
});

function closeDownloadMenu() {
  $("downloadOptions").classList.add("hidden");
  $("downloadMenuBtn").setAttribute("aria-expanded", "false");
}

$("downloadMenuBtn").addEventListener("click", () => {
  if (state.busy) {
    return;
  }
  const isOpen = !$("downloadOptions").classList.contains("hidden");
  $("downloadOptions").classList.toggle("hidden", isOpen);
  $("downloadMenuBtn").setAttribute("aria-expanded", String(!isOpen));
});

$("downloadPdfBtn").addEventListener("click", async () => {
  if (state.busy) {
    return;
  }
  closeDownloadMenu();
  const data = collectData();
  if (!validatePdfData(data)) {
    return;
  }

  setStatus("Gerando o PDF final...");
  setBusy(true, "pdf");
  try {
    const blob = await generatePdfBlob(data);
    downloadBlob(blob, getFileName());
    setStatus("PDF gerado e baixado.", "ok");
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    setBusy(false);
  }
});

$("downloadDocxBtn").addEventListener("click", async () => {
  if (state.busy) {
    return;
  }
  closeDownloadMenu();
  const data = collectData();
  if (!validatePdfData(data)) {
    return;
  }

  setStatus("Gerando o arquivo Word...");
  setBusy(true, "word");
  try {
    const blob = await generateWordBlob(data);
    downloadBlob(blob, "folha-de-estudo-life-group.docx");
    setStatus("Arquivo Word gerado e baixado.", "ok");
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    setBusy(false);
  }
});

document.addEventListener("click", (event) => {
  if (!event.target.closest(".downloadMenu")) {
    closeDownloadMenu();
  }
});

$("saveOnlineBtn").addEventListener("click", async () => {
  if (state.busy) {
    return;
  }
  const data = collectData();
  if (!validatePdfData(data)) {
    return;
  }

  setStatus("Gerando e salvando o arquivo...");
  setBusy(true, "save");
  try {
    const blob = await generatePdfBlob(data);
    await savePdfOnline(blob, data);
    await renderRecentFiles();
    setStatus("Arquivo salvo. Abra a página Arquivos salvos para ver seus PDFs.", "ok");
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    setBusy(false);
  }
});

$("chatForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (state.busy) {
    return;
  }

  const input = $("chatInput");
  const instruction = input.value.trim();
  if (!instruction) {
    return;
  }

  appendChatMessage("user", instruction);
  state.chatHistory.push({ role: "user", content: instruction });
  input.value = "";
  setStatus("O assistente está analisando sua mensagem...");
  setBusy(true, "chat");

  try {
    const result = await talkWithAssistant(instruction);
    if (result.action === "updated" && result.data) {
      fillForm(result.data);
      showReview();
      setView("preview");
      setStatus("Alteração aplicada pelo assistente.", "ok");
    } else {
      setStatus("Resposta recebida do assistente.", "ok");
    }
    const reply = result.reply || "Como posso ajudar?";
    appendChatMessage("bot", reply);
    state.chatHistory.push({ role: "assistant", content: reply });
  } catch (error) {
    appendChatMessage("bot", error.message);
    setStatus(error.message, "error");
  } finally {
    setBusy(false);
    input.focus();
  }
});

fillForm({
  titulo: "",
  subtitulo: "",
  momentoGenerosidade: "",
  avisos: "",
  momentoVisao: "",
  resumo: "",
  perguntas: [],
  conclusao: "",
});

setMode();
fields.forEach((field) => {
  $(field).addEventListener("input", renderPreview);
});
$("previewViewBtn").addEventListener("click", () => setView("preview"));
$("editViewBtn").addEventListener("click", () => setView("edit"));
setView("preview");

const dropzone = document.querySelector(".dropzone");
["dragenter", "dragover"].forEach((name) => dropzone.addEventListener(name, (event) => {
  event.preventDefault();
  dropzone.classList.add("dragging");
}));
["dragleave", "drop"].forEach((name) => dropzone.addEventListener(name, (event) => {
  event.preventDefault();
  dropzone.classList.remove("dragging");
}));
dropzone.addEventListener("drop", (event) => {
  const file = event.dataTransfer.files[0];
  if (!file) return;
  const transfer = new DataTransfer();
  transfer.items.add(file);
  $("pdfFile").files = transfer.files;
  $("fileName").textContent = file.name;
});

const themeToggle = $("themeToggle");
themeToggle.addEventListener("click", () => {
  document.body.classList.toggle("dark");
  const dark = document.body.classList.contains("dark");
  themeToggle.innerHTML = dark
    ? '<img src="/figma-assets/light-mode.svg" alt=""><span>Modo escuro</span>'
    : '<img src="/figma-assets/light-mode.svg" alt=""><span>Modo claro</span>';
  localStorage.setItem("folhaTheme", dark ? "dark" : "light");
});
if (localStorage.getItem("folhaTheme") === "dark") {
  document.body.classList.add("dark");
  themeToggle.innerHTML = '<img src="/figma-assets/light-mode.svg" alt=""><span>Modo escuro</span>';
}

const chatLaunchButton = $("chatLaunchButton");
if (chatLaunchButton) {
  chatLaunchButton.addEventListener("click", () => {
    setStatus("Gere uma folha primeiro. Depois disso o chat abre para você pedir ajustes no conteúdo.", "error");
    $("pdfFile").focus();
  });
}

const previewStyle = document.createElement("style");
previewStyle.textContent = ".previewHeader p{display:none}.previewSeries{text-align:center;margin:0 70px 24px}.previewSubtitle{margin:0 70px 24px}@media(max-width:900px){.previewSeries,.previewSubtitle{margin-left:20px;margin-right:20px}}";
document.head.append(previewStyle);
loadSavedDraftForEditing();
renderRecentFiles();
