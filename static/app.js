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
};

const $ = (id) => document.getElementById(id);

function setStatus(message, type = "") {
  const status = $("status");
  status.textContent = message;
  status.className = `status ${type}`.trim();
}

function fillForm(data) {
  if (data.tipo) {
    setMode(data.tipo);
  }
  fields.forEach((field) => {
    $(field).value = data[field] || "";
  });
  state.perguntas = Array.isArray(data.perguntas) ? data.perguntas : [];
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
  return data;
}

function setMode(tipo) {
  state.tipo = tipo === "tadel" ? "tadel" : "life_group";
  const isTadel = state.tipo === "tadel";
  $("lifeMode").classList.toggle("active", !isTadel);
  $("tadelMode").classList.toggle("active", isTadel);
  $("modeEyebrow").textContent = isTadel ? "TADEL" : "Life Group";
  $("resumoLabel").textContent = isTadel ? "Conteúdo do TADEL" : "Resumo";
  document.querySelectorAll(".lifeOnly").forEach((element) => {
    element.classList.toggle("hidden", isTadel);
  });
  if (isTadel) {
    $("downloadBtn").textContent = "Baixar Resumo";
  } else {
    $("downloadBtn").textContent = "Baixar PDF";
  }
}

$("pdfFile").addEventListener("change", (event) => {
  const file = event.target.files[0];
  $("fileName").textContent = file ? file.name : "Nenhum arquivo escolhido";
});

$("uploadForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const file = $("pdfFile").files[0];
  if (!file) {
    setStatus("Escolha um PDF ou Word antes de extrair.", "error");
    return;
  }

  setStatus("Lendo o arquivo e organizando os campos...");
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
  }
});

$("addQuestion").addEventListener("click", () => {
  state.perguntas.push("");
  renderQuestions();
});

$("downloadBtn").addEventListener("click", async () => {
  const data = collectData();
  if (!data.titulo || !data.resumo) {
    setStatus("Preencha pelo menos o título e o resumo antes de baixar.", "error");
    return;
  }

  setStatus("Gerando o PDF final...");
  try {
    const response = await fetch("/api/pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.erro || "Não foi possível gerar o PDF.");
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = state.tipo === "tadel" ? "resumo-tadel.pdf" : "folha-de-estudo-life-group.pdf";
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setStatus("PDF gerado e baixado.", "ok");
  } catch (error) {
    setStatus(error.message, "error");
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
