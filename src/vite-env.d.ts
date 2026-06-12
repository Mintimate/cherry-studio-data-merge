/// <reference types="vite/client" />

import type { CherryDesktopApi } from './types/desktop'

declare global {
  interface Window {
    cherryDesktop?: CherryDesktopApi
  }
}
