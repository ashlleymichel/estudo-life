const authForm = document.getElementById("authForm");
const authName = document.getElementById("authName");
const authEmail = document.getElementById("authEmail");
const authPassword = document.getElementById("authPassword");
const authConfirmPassword = document.getElementById("authConfirmPassword");
const authSubmit = document.getElementById("authSubmit");
const authStatus = document.getElementById("authStatus");
const googleButton = document.getElementById("googleAuth");
const mode = document.body.dataset.authMode || "login";

function setAuthStatus(message, type = "") {
  authStatus.textContent = message;
  authStatus.className = `authStatus ${type}`.trim();
}

function setAuthBusy(isBusy) {
  authSubmit.disabled = isBusy;
  if (googleButton) {
    googleButton.disabled = isBusy;
  }
  authSubmit.textContent = isBusy ? "Aguarde..." : mode === "signup" ? "Criar conta" : "Entrar";
}

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!window.folhaSupabase?.isReady()) {
    setAuthStatus("Supabase não carregou. Tente atualizar a página.", "error");
    return;
  }

  const email = authEmail.value.trim();
  const password = authPassword.value;
  const name = authName?.value.trim() || "";

  if (!email || !password || (mode === "signup" && !name)) {
    setAuthStatus("Preencha todos os campos obrigatórios.", "error");
    return;
  }
  if (mode === "signup" && password !== authConfirmPassword.value) {
    setAuthStatus("As senhas não conferem.", "error");
    return;
  }

  setAuthBusy(true);
  setAuthStatus(mode === "signup" ? "Criando sua conta..." : "Entrando...");
  try {
    if (mode === "signup") {
      const data = await window.folhaSupabase.signUp({ name, email, password });
      if (!data.session) {
        setAuthStatus("Conta criada. Confirme seu e-mail para entrar.", "ok");
        return;
      }
      setAuthStatus("Conta criada com sucesso.", "ok");
    } else {
      await window.folhaSupabase.signIn({ email, password });
      setAuthStatus("Entrada realizada.", "ok");
    }
    window.location.href = "/dashboard.html";
  } catch (error) {
    setAuthStatus(error.message || "Não foi possível concluir. Confira os dados.", "error");
  } finally {
    setAuthBusy(false);
  }
});

googleButton?.addEventListener("click", async () => {
  if (!window.folhaSupabase?.isReady()) {
    setAuthStatus("Supabase não carregou. Tente atualizar a página.", "error");
    return;
  }
  setAuthBusy(true);
  setAuthStatus("Abrindo login do Google...");
  try {
    await window.folhaSupabase.signInWithGoogle();
  } catch (error) {
    setAuthStatus(error.message || "Não foi possível entrar com Google.", "error");
    setAuthBusy(false);
  }
});

window.addEventListener("pageshow", () => {
  setAuthBusy(false);
});

window.folhaSupabase?.currentUser().then((user) => {
  if (user) {
    window.location.href = "/dashboard.html";
  }
});
