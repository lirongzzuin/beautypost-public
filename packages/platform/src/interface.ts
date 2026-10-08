// All platform-specific capabilities are expressed as interfaces here.
// Feature code MUST NOT use window/document/navigator/localStorage directly.
// Only platform/web/* may reference browser globals.

export interface PlatformCapabilities {
  canInstall: boolean           // PWA can be installed
  canPush: boolean              // push notifications supported
  canBackgroundUpload: boolean  // background upload while app is hidden
  canReceiveShare: boolean      // can receive shared content from other apps
  canShowWebPurchase: boolean   // can show web payment UI
  canCamera: boolean            // camera access
}

export interface PickedFile {
  id: string
  name: string
  type: 'image' | 'video'
  mimeType: string
  sizeBytes: number
  previewUrl: string            // object URL or base64 for preview
  file: File                    // only set on web; native provides blob
  durationSeconds?: number      // video only
}

export interface UploadProgress {
  fileId: string
  loaded: number
  total: number
  percentage: number
  status: 'pending' | 'uploading' | 'done' | 'error'
  error?: string
}

export interface StorageAdapter {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  remove(key: string): Promise<void>
  clear(): Promise<void>
}

export interface FilePickerAdapter {
  pickMultiple(options?: { accept?: string[]; maxCount?: number }): Promise<PickedFile[]>
  pickFromCamera(): Promise<PickedFile | null>
}

export interface UploadTransportAdapter {
  upload(
    files: PickedFile[],
    sessionId: string,
    onProgress: (progress: UploadProgress) => void
  ): Promise<{ fileId: string; mediaId: string }[]>
  cancel(fileId: string): void
}

export interface ShareAdapter {
  share(options: { title?: string; text?: string; url?: string; files?: string[] }): Promise<void>
  saveToGallery?(url: string): Promise<void>
}

export interface ClipboardAdapter {
  copy(text: string): Promise<void>
  read(): Promise<string | null>
}

export interface ExternalBrowserAdapter {
  open(url: string): void
  startAuthSession(url: string, callbackScheme: string): Promise<string | null>
}

export interface PushAdapter {
  requestPermission(): Promise<'granted' | 'denied' | 'unsupported'>
  getToken(): Promise<string | null>
  onMessage(handler: (payload: Record<string, unknown>) => void): () => void
}

export interface DeepLinkAdapter {
  onLink(handler: (url: string) => void): () => void
  getInitialLink(): Promise<string | null>
}

export interface AppInfoAdapter {
  platform: 'web' | 'ios' | 'android'
  appVersion: string
  buildNumber: string
  isInAppBrowser: boolean       // Kakao/Naver in-app browser detection
  deviceType: 'mobile' | 'tablet' | 'desktop'
}

export interface LifecycleAdapter {
  onForeground(handler: () => void): () => void
  onBackground(handler: () => void): () => void
  onNetworkChange(handler: (online: boolean) => void): () => void
  isOnline(): boolean
}

export interface Platform {
  capabilities: PlatformCapabilities
  storage: StorageAdapter
  filePicker: FilePickerAdapter
  uploadTransport: UploadTransportAdapter
  share: ShareAdapter
  clipboard: ClipboardAdapter
  externalBrowser: ExternalBrowserAdapter
  push: PushAdapter
  deepLink: DeepLinkAdapter
  appInfo: AppInfoAdapter
  lifecycle: LifecycleAdapter
}
