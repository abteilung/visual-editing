import { HistoryAdapterNavigate, enableOverlays } from '@sanity/overlays'
import { studioUrl } from 'apps-common/env'
import { useRouter } from 'next/router'
import { useEffect, useRef, useState } from 'react'
import { client } from './sanity.client'
import { useLiveMode } from '@sanity/react-loader'

// Always enable stega in Live Mode
const stegaClient = client.withConfig({ stega: true })

export default function VisualEditing() {
  const router = useRouter()
  const routerRef = useRef(router)
  const [navigate, setNavigate] = useState<HistoryAdapterNavigate | undefined>()

  useEffect(() => {
    routerRef.current = router
  }, [router])
  useEffect(() => {
    if (!router.isReady) return
    const disable = enableOverlays({
      history: {
        subscribe: (navigate) => {
          setNavigate(() => navigate)
          return () => setNavigate(undefined)
        },
        update: (update) => {
          switch (update.type) {
            case 'push':
              return routerRef.current.push(update.url)
            case 'pop':
              return routerRef.current.back()
            case 'replace':
              return routerRef.current.replace(update.url)
            default:
              throw new Error(`Unknown update type: ${update.type}`)
          }
        },
      },
    })
    return () => disable()
  }, [router.isReady])
  useEffect(() => {
    if (navigate) {
      navigate({ type: 'push', url: router.asPath })
    }
  }, [navigate, router.asPath])

  useLiveMode({ client: stegaClient })
  // useEffect(() => {
  //   if (
  //     process.env.NEXT_PUBLIC_VERCEL_ENV !== 'preview' &&
  //     window === parent &&
  //     !opener
  //   ) {
  //     // If not an iframe, turn off Draft Mode
  //     location.href = '/api/disable-pages-draft'
  //   }
  // }, [])

  return null
}
