const recent = document.getElementById("dashboardRecent");
const greeting = document.getElementById("greeting");
const todayLabel = document.getElementById("todayLabel");

function formatDate(value) {
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
  }).format(value);
}

function greetingText(hour) {
  if (hour < 12) return "Bom dia";
  if (hour < 18) return "Boa tarde";
  return "Boa noite";
}

function formatTableDate(value) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
    .format(new Date(value))
    .replace(".", "");
}

function authorName(file) {
  return file.author || file.createdBy || file.owner || "PAZ Church";
}

function authorInitials(name) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function firstName(value) {
  return String(value || "")
    .trim()
    .split(/\s+/)[0];
}

async function hydrateDashboardProfile() {
  if (!window.folhaSupabase?.isReady()) {
    return;
  }
  const user = await window.folhaSupabase.currentUser().catch(() => null);
  if (!user) {
    return;
  }
  const profile = await window.folhaSupabase.getProfile(user.id).catch(() => null);
  const name = firstName(profile?.name || user.user_metadata?.name || user.email?.split("@")[0]);
  if (name) {
    greeting.textContent = `${greetingText(new Date().getHours())}, ${name}!`;
  }
}

async function loadFiles() {
  if (window.folhaSupabase?.isReady()) {
    const files = await window.folhaSupabase.listStudyFiles().catch(() => null);
    if (files) {
      return files.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }
  }
  const response = await fetch("/api/saved");
  if (!response.ok) throw new Error("Falha ao carregar arquivos.");
  const payload = await response.json();
  return (payload.files || []).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function renderFiles(files) {
  const items = files.slice(0, 5);
  if (!items.length) {
    recent.innerHTML = '<p class="emptyState compactEmpty">Nenhum PDF salvo ainda.</p>';
    return;
  }
  recent.innerHTML = '<div class="dashboardTableHeader"><span>Documento</span><span>Criado por</span><span>Data</span><span>Status</span></div>';
  items.forEach((file) => {
    const row = document.createElement("a");
    row.className = "dashboardRow";
    row.href = `/salvos.html?arquivo=${encodeURIComponent(file.id)}`;

    const title = document.createElement("strong");
    title.textContent = file.title || "Arquivo salvo";

    const author = document.createElement("span");
    author.className = "dashboardAuthor";
    const avatar = document.createElement("span");
    avatar.className = "savedAuthorAvatar";
    if (file.avatarUrl) {
      avatar.classList.add("hasPhoto");
      avatar.style.backgroundImage = `url("${file.avatarUrl}")`;
    } else {
      avatar.textContent = authorInitials(authorName(file)) || "PC";
    }
    const authorLabel = document.createElement("span");
    authorLabel.textContent = authorName(file);
    author.append(avatar, authorLabel);

    const date = document.createElement("span");
    date.className = "dashboardDateCell";
    date.textContent = formatTableDate(file.createdAt);

    const status = document.createElement("span");
    status.className = "savedStatusPill";
    status.textContent = file.status || "Concluído";

    row.append(title, author, date, status);
    recent.append(row);
  });
}

const now = new Date();
todayLabel.textContent = formatDate(now);
greeting.textContent = `${greetingText(now.getHours())}!`;

loadFiles().then(renderFiles).catch(() => {
  recent.innerHTML = '<p class="emptyState compactEmpty">Não foi possível carregar os PDFs recentes.</p>';
});
window.folhaSupabase?.hydrateHeaderProfile();
hydrateDashboardProfile();
