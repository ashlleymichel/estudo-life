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
  return state.tipo === "tadel" ? "Gerar Resumo TADEL" : "Gerar Folha de Estudo";
}

function getFileName() {
  return state.tipo === "tadel" ? "resumo-tadel.pdf" : "folha-de-estudo-life-group.pdf";
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
  const modeButtons = [$("lifeMode"), $("tadelMode")];
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
  modeButtons.forEach((button) => {
    button.disabled = isBusy;
  });
  fieldsToToggle.forEach((field) => {
    field.disabled = isBusy;
  });

  extractBtn.classList.toggle("loading", isBusy && action === "extract");
  downloadMenuBtn.classList.toggle("loading", isBusy && (action === "pdf" || action === "word"));
  saveOnlineBtn.classList.toggle("loading", isBusy && action === "save");
  extractBtn.innerHTML = buttonContent(action === "extract" ? "Montando estrutura..." : getExtractLabel(), isBusy && action === "extract");
  downloadMenuBtn.innerHTML = buttonContent(action === "pdf" ? "Gerando PDF..." : action === "word" ? "Gerando DOCX..." : "Baixar", isBusy && (action === "pdf" || action === "word"));
  saveOnlineBtn.innerHTML = buttonContent(action === "save" ? "Salvando..." : "Salvar Arquivo Online", isBusy && action === "save");
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
    });

    const remove = document.createElement("button");
    remove.className = "remove";
    remove.type = "button";
    remove.textContent = "×";
    remove.title = "Remover pergunta";
    remove.addEventListener("click", () => {
      state.perguntas.splice(index, 1);
      renderQuestions();
    });

    row.append(number, input, remove);
    container.append(row);
  });
}

function collectData() {
  const data = {};
  fields.forEach((field) => {
    data[field] = $(field).value.trim();
  });
  data.perguntas = state.perguntas.map((item) => item.trim()).filter(Boolean);
  data.tipo = state.tipo;
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
    setStatus("Arquivo salvo aberto para edição. Ajuste o que precisar e salve novamente.", "ok");
    return true;
  } catch (error) {
    setStatus("Não foi possível abrir o arquivo salvo para edição.", "error");
    return false;
  }
}

function setMode(tipo) {
  if (state.busy) {
    return;
  }
  state.tipo = tipo === "tadel" ? "tadel" : "life_group";
  const isTadel = state.tipo === "tadel";
  $("lifeMode").classList.toggle("active", !isTadel);
  $("tadelMode").classList.toggle("active", isTadel);
  $("modeEyebrow").textContent = isTadel ? "TADEL" : "Life Group";
  $("tituloLabel").textContent = isTadel ? "Resumo TADEL" : "Título da série";
  $("subtituloLabel").textContent = isTadel ? "DATA" : "Linha do culto";
  $("resumoLabel").textContent = isTadel ? "Conteúdo do TADEL" : "Resumo";
  document.querySelectorAll(".lifeOnly").forEach((element) => {
    element.classList.toggle("hidden", isTadel);
  });
  if (isTadel) {
    $("extractBtn").innerHTML = getExtractLabel();
    if (!$("titulo").value.trim() || $("titulo").value.trim() === "Folha de Estudo Life Group") {
      $("titulo").value = "Resumo TADEL";
    }
    if (!$("subtitulo").value.trim() || $("subtitulo").value.trim() === "Culto Presencial e On-Line / Life Group") {
      $("subtitulo").value = "Data: ";
    }
  } else {
    $("extractBtn").innerHTML = getExtractLabel();
    if ($("titulo").value.trim() === "Resumo TADEL") {
      $("titulo").value = "Folha de Estudo Life Group";
    }
    if ($("subtitulo").value.trim() === "Data:") {
      $("subtitulo").value = "Culto Presencial e On-Line / Life Group";
    }
  }
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
  form.append("tipo", state.tipo);

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
    downloadBlob(blob, state.tipo === "tadel" ? "resumo-tadel.docx" : "folha-de-estudo-life-group.docx");
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
    setStatus("Arquivo salvo. Abra a página Arquivos salvos para ver seus PDFs.", "ok");
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    setBusy(false);
  }
});

document.addEventListener("click", (event) => {
  if (event.target.closest("#lifeMode")) {
    setMode("life_group");
  }
  if (event.target.closest("#tadelMode")) {
    setMode("tadel");
  }
});

fillForm({
  titulo: "Folha de Estudo Life Group",
  subtitulo: "Culto Presencial e On-Line / Life Group",
  momentoGenerosidade:
    'Todas as ofertas dos "Life Groups" são destinadas ao ministério Amor em Ação. A sua oferta tem impactado e alcançado muitas vidas para Jesus! Glórias a Deus por isso!',
  avisos: "Encontro com Deus: 14 a 16 de agosto / inscrições abertas / informações com seu líder",
  momentoVisao:
    "Nossa Missão: Fazer discípulos de Jesus que impactam o mundo inteiro com uma paixão contagiante por Deus. Nossa Visão: Ser um movimento de plantação de igrejas saudáveis e multiplicadoras.",
  resumo: "",
  perguntas: ["Compartilhe conosco o que essa Palavra de domingo falou com você."],
  conclusao: "",
});

setMode("life_group");
loadSavedDraftForEditing();
