'use client'

import { Toaster } from 'sonner'

export function AppToaster() {
  return (
    <Toaster
      theme="dark"
      richColors
      position="top-center"
      style={{ zIndex: 9999 }}
      toastOptions={{
        style: { zIndex: 9999 },
      }}
    />
  )
}
