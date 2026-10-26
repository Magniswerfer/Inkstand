import { app } from 'electron'
import { join } from 'node:path'

/** Files shipped with the app (templates, guide). In a packaged build they live in Resources/. */
export function resourcePath(...parts: string[]): string {
  return app.isPackaged ? join(process.resourcesPath, ...parts) : join(app.getAppPath(), 'resources', ...parts)
}

export function dataPath(...parts: string[]): string {
  return join(app.getPath('userData'), ...parts)
}
