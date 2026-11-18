const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('zhixuTeacherDesktop', {
  configureDeveloperKey: () => ipcRenderer.invoke('zhixu:configure-developer-key'),
});
