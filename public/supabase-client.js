const SUPABASE_URL = "https://rcnwzeibvrhtngoqxzoh.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJjbnd6ZWlidnJodG5nb3F4em9oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg0NTMwNjYsImV4cCI6MjEwNDAyOTA2Nn0.TA1vVL8ZZU5B3c_Z7LGGtLVeC41JBSZBdXNBXeAsyUA";

const folhaSupabase = (() => {
  const client = window.supabase?.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const APP_URL = "https://estudo-life.vercel.app";
  const PDF_BUCKET = "study-pdfs";
  const AVATAR_BUCKET = "profile-photos";

  function isReady() {
    return Boolean(client);
  }

  function cleanName(value, fallback = "arquivo") {
    return String(value || fallback)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || fallback;
  }

  function isUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
  }

  function publicUrl(bucket, path) {
    if (!path) {
      return "";
    }
    return client.storage.from(bucket).getPublicUrl(path).data.publicUrl || "";
  }

  function mapSavedFile(row) {
    return {
      id: row.id,
      name: row.name || "folha-de-estudo-life-group.pdf",
      title: row.title || "Folha de Estudo Life Group",
      status: row.status || "Concluído",
      type: row.type || "life_group",
      size: row.size || 0,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      data: row.data || {},
      pdfUrl: row.pdf_url || publicUrl(PDF_BUCKET, row.pdf_path),
      pdfPath: row.pdf_path || "",
      author: row.created_by_name || "PAZ Church",
      avatarUrl: row.created_by_avatar_url || "",
      online: true,
      supabase: true,
    };
  }

  async function currentSession() {
    if (!client) {
      return null;
    }
    const { data, error } = await client.auth.getSession();
    if (error) {
      throw error;
    }
    return data.session;
  }

  async function currentUser() {
    const session = await currentSession();
    return session?.user || null;
  }

  async function getProfile(userId) {
    if (!client || !userId) {
      return null;
    }
    const { data, error } = await client.from("profiles").select("*").eq("id", userId).maybeSingle();
    if (error) {
      throw error;
    }
    return data;
  }

  async function upsertProfile({ userId, name, email, avatarFile } = {}) {
    if (!client) {
      return null;
    }
    const user = userId ? { id: userId, email } : await currentUser();
    if (!user) {
      throw new Error("Entre na sua conta para salvar o perfil.");
    }

    let avatarUrl = "";
    if (avatarFile) {
      const extension = avatarFile.name.split(".").pop() || "jpg";
      const avatarPath = `${user.id}/${Date.now()}.${extension}`;
      const { error: uploadError } = await client.storage.from(AVATAR_BUCKET).upload(avatarPath, avatarFile, {
        cacheControl: "3600",
        upsert: true,
      });
      if (uploadError) {
        throw uploadError;
      }
      avatarUrl = publicUrl(AVATAR_BUCKET, avatarPath);
    }

    const profile = {
      id: user.id,
      name: name || user.user_metadata?.name || user.email?.split("@")[0] || "PAZ Church",
      email: email || user.email || "",
      updated_at: new Date().toISOString(),
    };
    if (avatarUrl) {
      profile.avatar_url = avatarUrl;
    }

    const { data, error } = await client.from("profiles").upsert(profile).select("*").single();
    if (error) {
      throw error;
    }
    return data;
  }

  async function signUp({ name, email, password }) {
    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: {
        data: { name },
        emailRedirectTo: `${APP_URL}/dashboard.html`,
      },
    });
    if (error) {
      throw error;
    }
    if (data.user && data.session) {
      await upsertProfile({ userId: data.user.id, name, email }).catch(() => null);
    }
    return data;
  }

  async function signIn({ email, password }) {
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) {
      throw error;
    }
    if (data.user) {
      await upsertProfile({
        userId: data.user.id,
        name: data.user.user_metadata?.name || data.user.email?.split("@")[0],
        email: data.user.email,
      });
    }
    return data;
  }

  async function signInWithGoogle() {
    const { error } = await client.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${APP_URL}/dashboard.html` },
    });
    if (error) {
      throw error;
    }
  }

  async function signOut() {
    const { error } = await client.auth.signOut();
    if (error) {
      throw error;
    }
  }

  async function uploadPdf({ id, title, blob }) {
    const user = await currentUser();
    const safeTitle = cleanName(title, "folha-de-estudo");
    const fileId = isUuid(id) ? id : crypto.randomUUID();
    const path = `${user?.id || "public"}/${fileId}-${safeTitle}.pdf`;
    const { error } = await client.storage.from(PDF_BUCKET).upload(path, blob, {
      cacheControl: "3600",
      contentType: "application/pdf",
      upsert: true,
    });
    if (error) {
      throw error;
    }
    return { path, url: publicUrl(PDF_BUCKET, path) };
  }

  async function saveStudyFile({ id, name, title, size, data, pdfBlob }) {
    if (!client) {
      return null;
    }
    const user = await currentUser();
    if (!user) {
      throw new Error("Entre na sua conta para salvar online.");
    }
    const profile = await getProfile(user.id).catch(() => null);
    const fileId = isUuid(id) ? id : crypto.randomUUID();
    const uploaded = pdfBlob ? await uploadPdf({ id: fileId, title, blob: pdfBlob }) : {};
    const payload = {
      id: fileId,
      user_id: user.id,
      name: name || "folha-de-estudo-life-group.pdf",
      title: title || "Arquivo sem título",
      type: data?.tipo || "life_group",
      status: "Concluído",
      size: size || pdfBlob?.size || 0,
      data,
      created_by_name: profile?.name || user.user_metadata?.name || user.email?.split("@")[0] || "PAZ Church",
      created_by_avatar_url: profile?.avatar_url || "",
      updated_at: new Date().toISOString(),
    };
    if (uploaded.path) {
      payload.pdf_path = uploaded.path;
      payload.pdf_url = uploaded.url;
    }

    const { data: record, error } = await client.from("saved_files").upsert(payload).select("*").single();
    if (error) {
      throw error;
    }
    return mapSavedFile(record);
  }

  async function listStudyFiles() {
    if (!client) {
      return null;
    }
    const { data, error } = await client.from("saved_files").select("*").order("created_at", { ascending: false });
    if (error) {
      throw error;
    }
    return (data || []).map(mapSavedFile);
  }

  async function deleteStudyFile(file) {
    if (!client || !file?.id) {
      return false;
    }
    const { error } = await client.from("saved_files").delete().eq("id", file.id);
    if (error) {
      throw error;
    }
    if (file.pdfPath) {
      await client.storage.from(PDF_BUCKET).remove([file.pdfPath]).catch(() => {});
    }
    return true;
  }

  async function hydrateHeaderProfile() {
    if (!client) {
      return;
    }
    const user = await currentUser().catch(() => null);
    if (!user) {
      return;
    }
    const profile = await getProfile(user.id).catch(() => null);
    const label = profile?.name || user.email || "PC";
    const initials = label
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase();
    document.querySelectorAll(".avatarLink").forEach((avatar) => {
      avatar.textContent = profile?.avatar_url ? "" : initials || "PC";
      avatar.style.backgroundImage = profile?.avatar_url ? `url("${profile.avatar_url}")` : "";
    });
  }

  return {
    client,
    isReady,
    currentSession,
    currentUser,
    getProfile,
    upsertProfile,
    signUp,
    signIn,
    signInWithGoogle,
    signOut,
    saveStudyFile,
    listStudyFiles,
    deleteStudyFile,
    hydrateHeaderProfile,
  };
})();

window.folhaSupabase = folhaSupabase;
