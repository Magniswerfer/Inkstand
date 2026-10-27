import type { InkstandApi } from '@shared/types'

declare global {
  interface Window {
    api: InkstandApi
  }
}
