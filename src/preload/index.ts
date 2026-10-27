import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import type { FossWriteApi } from '@shared/types'

const invoke = (channel: string) => (...args: unknown[]) => ipcRenderer.invoke(channel, ...args)

function on<T extends unknown[]>(channel: string) {
  return (cb: (...args: T) => void) => {
    const listener = (_e: IpcRendererEvent, ...args: unknown[]) => cb(...(args as T))
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  }
}

const api: FossWriteApi = {
  platform: process.platform,
  getSettings: invoke('settings:get'),
  setSettings: invoke('settings:set'),
  onSettings: on('settings'),
  onMenu: on('menu'),
  onOpenFile: on('open-file'),
  onFileChanged: on('file-changed'),
  onLibraryChanged: on('library-changed'),

  readFile: invoke('fs:read'),
  readFileBase64: invoke('fs:readBase64'),
  writeFile: invoke('fs:write'),
  writeBinary: invoke('fs:writeBinary'),
  exists: invoke('fs:exists'),
  stat: invoke('fs:stat'),
  listDir: invoke('fs:listDir'),
  listAllFiles: invoke('fs:listAll'),
  listFolders: invoke('fs:listFolders'),
  mkdir: invoke('fs:mkdir'),
  rename: invoke('fs:rename'),
  copyFile: invoke('fs:copy'),
  trash: invoke('fs:trash'),
  reveal: invoke('fs:reveal'),
  openExternal: invoke('shell:open'),
  search: invoke('fs:search'),
  smartFolder: invoke('fs:smart'),
  tags: invoke('fs:tags'),
  watchFile: invoke('fs:watchFile'),
  watchLibrary: invoke('fs:watchLibrary'),

  showOpenDialog: invoke('dialog:open'),
  showSaveDialog: invoke('dialog:save'),
  confirm: invoke('dialog:confirm'),

  setDocumentState: (s) => ipcRenderer.send('doc:state', s),
  newWindow: invoke('window:new'),

  listTemplates: invoke('templates:list'),
  importTemplate: invoke('templates:import'),
  removeTemplate: invoke('templates:remove'),
  revealTemplates: invoke('templates:reveal'),

  exportPdf: invoke('export:pdf'),
  print: invoke('print'),
  copyRich: invoke('clipboard:rich'),

  listVersions: invoke('versions:list'),
  readVersion: invoke('versions:read'),
  saveVersion: invoke('versions:save'),
  moveVersions: invoke('versions:move'),

  getAuthorship: invoke('authorship:get'),
  setAuthorship: invoke('authorship:set'),

  saveAccount: invoke('accounts:save'),
  publish: invoke('publish'),

  addDictionaryWord: invoke('spell:add'),
  getPathForFile: (file) => webUtils.getPathForFile(file)
} as FossWriteApi

contextBridge.exposeInMainWorld('api', api)
