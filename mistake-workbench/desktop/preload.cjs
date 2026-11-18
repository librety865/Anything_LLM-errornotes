const { contextBridge, ipcRenderer } = require('electron');
const prefix = '--zhixu-settings=';
const options = process.argv.find(argument => argument.startsWith(prefix));
if (options) contextBridge.exposeInMainWorld('zhixuDesktop', JSON.parse(options.slice(prefix.length)));

contextBridge.exposeInMainWorld('zhixuClassroom', (address, endpoint, body, token) =>
 ipcRenderer.invoke('zhixu:classroom', address, endpoint, body, token));
