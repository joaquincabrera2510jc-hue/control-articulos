// Función "admin-usuarios" de Supabase (Edge Function).
// Solo un Administrador activo puede crear usuarios, cambiarles nombre, rol,
// contraseña o desactivarlos. Las contraseñas las guarda Supabase cifradas.
import { createClient } from "npm:@supabase/supabase-js@2";

const DOMINIO = "control-articulos.local"; // debe coincidir con DOMINIO_USUARIOS en src/config.js
const ROLES = ["admin", "operador", "taller", "lectura"];

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const responder = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const error = (msg: string, status = 400) => responder(status, { error: msg });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return error("Método no permitido.", 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  let secretas: Record<string, string> = {};
  try { secretas = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}"); } catch { /* sin claves nuevas */ }
  const clave = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SECRET_KEY") || secretas.default || Object.values(secretas)[0];
  if (!clave) return error("La función no tiene acceso a la clave de servicio de Supabase.", 500);
  const servicio = createClient(url, clave, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ¿Quién llama?
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return error("Tenés que ingresar primero.", 401);
  const { data: quien, error: errQuien } = await servicio.auth.getUser(token);
  if (errQuien || !quien?.user) return error("Tu sesión venció. Volvé a ingresar.", 401);
  const { data: yo } = await servicio.from("perfiles").select("*").eq("id", quien.user.id).maybeSingle();
  if (!yo || !yo.activo || yo.rol !== "admin") return error("Solo un administrador puede gestionar usuarios.", 403);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return error("Pedido inválido."); }
  const accion = String(body.accion ?? "");
  const nombre = String(body.nombre ?? "").trim();
  const rol = String(body.rol ?? "");
  const password = body.password == null ? "" : String(body.password);
  const usuario = String(body.usuario ?? "").trim().toLowerCase();

  if (!nombre) return error("Escribí el nombre.");
  if (!ROLES.includes(rol)) return error("Rol no válido.");
  if (password && password.length < 6) return error("La contraseña tiene que tener al menos 6 caracteres.");

  const { data: todos } = await servicio.from("perfiles").select("id, usuario, rol, activo");

  if (accion === "crear") {
    if (!/^[a-z0-9._-]{3,30}$/.test(usuario)) return error("El usuario lleva de 3 a 30 letras minúsculas, números, punto o guion.");
    if (!password) return error("Escribí una contraseña.");
    if ((todos ?? []).some((p) => p.usuario === usuario)) return error("Ese usuario ya existe.");
    const { data: nuevo, error: e1 } = await servicio.auth.admin.createUser({
      email: `${usuario}@${DOMINIO}`, password, email_confirm: true, user_metadata: { usuario, nombre },
    });
    if (e1 || !nuevo?.user) return error("No se pudo crear el usuario: " + (e1?.message ?? "error desconocido"));
    const { error: e2 } = await servicio.from("perfiles").insert({ id: nuevo.user.id, usuario, nombre, rol, activo: true });
    if (e2) {
      await servicio.auth.admin.deleteUser(nuevo.user.id);
      return error("No se pudo crear el perfil: " + e2.message);
    }
    return responder(200, { ok: true, id: nuevo.user.id });
  }

  if (accion === "editar") {
    const id = String(body.id ?? "");
    const actual = (todos ?? []).find((p) => p.id === id);
    if (!actual) return error("Ese usuario no existe.");
    const activo = body.activo !== false;
    if (id === yo.id && (rol !== "admin" || !activo)) {
      return error("No podés quitarte el rol de administrador ni desactivarte a vos mismo.");
    }
    const adminsActivos = (todos ?? []).filter((p) => p.rol === "admin" && p.activo && p.id !== id).length
      + (rol === "admin" && activo ? 1 : 0);
    if (adminsActivos === 0) return error("Tiene que quedar al menos un administrador activo.");

    const cambiosAuth: Record<string, unknown> = { ban_duration: activo ? "none" : "876000h" };
    if (password) cambiosAuth.password = password;
    const { error: e1 } = await servicio.auth.admin.updateUserById(id, cambiosAuth);
    if (e1) return error("No se pudo actualizar el acceso: " + e1.message);
    const { error: e2 } = await servicio.from("perfiles").update({ nombre, rol, activo }).eq("id", id);
    if (e2) return error("No se pudo actualizar el perfil: " + e2.message);
    return responder(200, { ok: true });
  }

  return error("Acción desconocida.");
});
