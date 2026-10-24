// Web implementation of Platform interface.
// This is the ONLY file in the codebase allowed to use browser globals.

import type { Platform, PlatformCapabilities } from '../interface'
import { webStorage } from './storage'
import { webFilePicker } from './filePicker'
import { webUploadTransport } from './uploadTransport'
import { webShare } from './share'
import { webMedia } from './media'
import { webClipboard } from './clipboard'
import { webExternalBrowser } from './externalBrowser'
import { webPush } from './push'
import { webDeepLink } from './deepLink'
import { webAppInfo } from './appInfo'
import { webLifecycle } from './lifecycle'

function detectCapabilities(): PlatformCapabilities {
  const ua = navigator.userAgent
  const isMobile = /iPhone|iPad|iPod|Android/i.test(ua)
  return {
    canInstall: 'BeforeInstallPromptEvent' in window || isMobile,
    canPush: 'PushManager' in window && 'serviceWorker' in navigator,
    canBackgroundUpload: false,   // web: no background upload
    canReceiveShare: 'share' in navigator,
    canShowWebPurchase: true,
    canCamera: 'mediaDevices' in navigator && 'getUserMedia' in navigator.mediaDevices,
  }
}

export const webPlatform: Platform = {
  get capabilities() { return detectCapabilities() },
  storage: webStorage,
  filePicker: webFilePicker,
  uploadTransport: webUploadTransport,
  share: webShare,
  media: webMedia,
  clipboard: webClipboard,
  externalBrowser: webExternalBrowser,
  push: webPush,
  deepLink: webDeepLink,
  appInfo: webAppInfo,
  lifecycle: webLifecycle,
}
