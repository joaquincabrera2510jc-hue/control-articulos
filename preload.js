// Puente seguro entre la ventana y el sistema (solo lo necesario)
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  version: () => ipcRenderer.invoke("version"),
  onUpdate: (cb) => ipcRenderer.on("actualizacion", (_e, datos) => cb(datos)),
  instalarActualizacion: () => ipcRenderer.send("instalar-actualizacion"),
  guardarArchivo: (nombre, bytes) => ipcRenderer.invoke("guardar-archivo", nombre, bytes),
});
