// Proceso principal de la app de escritorio "Control de Artículos"
const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs");

let autoUpdater = null;
try { ({ autoUpdater } = require("electron-updater")); } catch (e) { /* en desarrollo puede no estar */ }

let win = null;

// Windows arma el "user agent" con el nombre del programa, que tiene tilde ("Artículos"),
// y Supabase no puede guardar la sesión con ese texto. Se deja solo en caracteres simples.
app.userAgentFallback = app.userAgentFallback.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7E]/g, "");

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
}

function enviar(canal, datos) { if (win && !win.isDestroyed()) win.webContents.send(canal, datos); }

function crearVentana() {
  win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 380, minHeight: 500,
    title: "Control de Artículos — López Motors",
    backgroundColor: "#0b0c0d",
    icon: path.join(__dirname, "build", "icon.ico"),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.once("ready-to-show", () => win.show());
  win.loadFile(path.join(__dirname, "src", "index.html"));

  // Enlaces externos se abren en el navegador; la app nunca navega fuera de sí misma
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => { if (!url.startsWith("file://")) e.preventDefault(); });
}

// ---------- actualizaciones automáticas (GitHub Releases) ----------
function configurarActualizaciones() {
  if (!autoUpdater || !app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("update-available", (i) => enviar("actualizacion", { estado: "descargando", version: i.version, porcentaje: 0 }));
  autoUpdater.on("download-progress", (p) => enviar("actualizacion", { estado: "descargando", porcentaje: p.percent }));
  autoUpdater.on("update-downloaded", (i) => enviar("actualizacion", { estado: "lista", version: i.version }));
  autoUpdater.on("error", (err) => enviar("actualizacion", { estado: "error", mensaje: String(err && err.message || err) }));
  const buscar = () => autoUpdater.checkForUpdates().catch(() => {});
  buscar();
  setInterval(buscar, 30 * 60 * 1000); // cada 30 minutos
}

ipcMain.handle("version", () => app.getVersion());
ipcMain.on("instalar-actualizacion", () => { if (autoUpdater) autoUpdater.quitAndInstall(false, true); });
ipcMain.handle("guardar-archivo", async (_e, nombre, bytes) => {
  const r = await dialog.showSaveDialog(win, {
    title: "Guardar Excel",
    defaultPath: path.join(app.getPath("documents"), String(nombre || "articulos.xlsx")),
    filters: [{ name: "Excel", extensions: ["xlsx"] }],
  });
  if (r.canceled || !r.filePath) return { guardado: false };
  fs.writeFileSync(r.filePath, Buffer.from(bytes));
  return { guardado: true, ruta: r.filePath };
});

app.whenReady().then(() => {
  crearVentana();
  configurarActualizaciones();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) crearVentana(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
