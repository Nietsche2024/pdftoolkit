const { contextBridge, ipcRenderer: r, webUtils } = require('electron');
contextBridge.exposeInMainWorld('api', {
  pick: o => r.invoke('pick', o), folder: () => r.invoke('folder'),
  run: (t, f, o) => r.invoke('run', t, f, o), theme: t => r.invoke('theme', t),
  read: p => r.invoke('read', p), write: (d, s, f) => r.invoke('write', d, s, f),
  path: f => webUtils.getPathForFile(f),
  open: u => r.invoke('open', u), reveal: p => r.invoke('reveal', p)
});
