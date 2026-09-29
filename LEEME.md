# Control de Artículos — López Motors

App de escritorio para Windows: stock, pedidos, taller y usuarios.
Solo funciona con internet y se actualiza sola.

## Instalar en una computadora

1. En esta página de GitHub, entrá a **Releases** (columna derecha) y descargá `Control-de-Articulos-Setup-X.X.X.exe`.
2. Ejecutalo. Como el instalador no tiene firma digital paga, Windows puede mostrar "Windows protegió su PC". Tocá **Más información → Ejecutar de todos modos**.
3. Queda un ícono **Control de Artículos** en el escritorio. Se puede instalar en todas las PCs que quieras.

## Cómo está armada

- **Supabase** (proyecto `control-articulos`, región São Paulo) es la base de datos. Guarda los artículos, pedidos, movimientos y usuarios. Las contraseñas se verifican en el servidor y cada rol tiene permisos controlados por la propia base.
- **GitHub** (este repositorio) arma el instalador y guarda las versiones. Las apps instaladas buscan acá las actualizaciones.

## Publicar una versión nueva

1. Cambiá los archivos que correspondan.
2. Subí el número de `"version"` en `package.json`, por ejemplo de `1.0.0` a `1.0.1`.
3. GitHub arma y publica el instalador solo. Lo podés seguir en la pestaña **Actions**.
4. Cada app instalada busca versiones nuevas al abrirse y cada 30 minutos. Cuando encuentra una, la descarga y muestra **Reiniciar y actualizar**. Si nadie lo toca, se instala al cerrar la app.

Las imágenes (logo e ícono) están guardadas como texto (`.b64`). GitHub las convierte al armar el instalador.

## Sin internet

- Sin conexión no se puede ingresar.
- Si se corta internet con la app abierta, la pantalla se bloquea hasta que vuelva la conexión.

## Roles

| Rol | Qué puede hacer |
|---|---|
| Administrador | Todo, incluido crear usuarios, cambiar roles y contraseñas, y desactivar usuarios |
| Operador | Artículos, entradas, salidas, ajustes y pedidos |
| Taller | Buscar artículos, dar salida y deshacer sus propias salidas dentro de las 24 h |
| Solo consulta | Ver sin modificar |

## Bueno saber

- **Plan gratuito de Supabase:** según sus condiciones actuales, el proyecto se pausa después de 7 días seguidos sin uso. Se reactiva desde el panel de Supabase y los datos no se pierden.
- **Respaldo:** el botón **Descargar Excel** guarda artículos, pedidos y movimientos.
- **Archivos de Supabase:** `supabase/schema.sql` tiene la estructura de la base y `supabase/functions/admin-usuarios` tiene la función que crea usuarios. Ya están instalados. Se guardan acá como respaldo.
