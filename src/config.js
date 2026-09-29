// ====== CONFIGURACIÓN — completar con los datos de tu proyecto de Supabase ======
// Supabase > Project Settings > API:
//   "Project URL"            -> SUPABASE_URL
//   "anon public" (API key)  -> SUPABASE_ANON_KEY
// La clave "anon" es pública por diseño: los datos los protegen los permisos de la base.
// NUNCA pongas acá la clave "service_role".
window.CONFIG = {
  SUPABASE_URL: "https://rcrbudmcgrgkfyepmgjx.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJjcmJ1ZG1jZ3Jna2Z5ZXBtZ2p4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA2ODE0MDYsImV4cCI6MjEwNjI1NzQwNn0.aKQ6qbhXyQkWsanfuPxcLtAhfR8fRaUrp24eNRbPqvI",
  // Dominio interno para los usuarios (no se envían correos). Debe coincidir con la función admin-usuarios.
  DOMINIO_USUARIOS: "control-articulos.local",
};
