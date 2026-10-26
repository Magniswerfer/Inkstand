import type { FossWriteApi } from '@shared/types'

declare global {
  interface Window {
    api: FossWriteApi
  }
}
