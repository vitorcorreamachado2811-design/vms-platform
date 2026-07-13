'use client'
import { useEffect, useRef, useState } from 'react'

const MEDIAMTX_URL = process.env.NEXT_PUBLIC_MEDIAMTX_URL || 'https://wonderful-laughter-production-5858.up.railway.app'
const API = process.env.NEXT_PUBLIC_API_URL || 'https://vms-platform-production.up.railway.app'

interface HLSPlayerProps {
  cameraId: string
  cameraName: string
  onClose: () => void
}

type Status = 'connecting' | 'live' | 'error'

export function HLSPlayer({ cameraId, cameraName, onClose }: HLSPlayerProps) {
  const videoRef  = useRef<HTMLVideoElement>(null)
  const hlsRef    = useRef<any>(null)
  const [status, setStatus]   = useState<Status>('connecting')
  const [latency, setLatency] = useState<number | null>(null)
  const startRef  = useRef(Date.now())
  const hlsUrlRef = useRef<string | null>(null)

  async function buscarHlsUrl(): Promise<string | null> {
    try {
      const token = localStorage.getItem('vms_token')
      const usuarioStr = localStorage.getItem('vms_usuario')
      if (!token || !usuarioStr) return null
      const usuario = JSON.parse(usuarioStr)
      const res = await fetch(`${API}/cameras/${cameraId}/hls-token?usuario_id=${usuario.id}&token=${token}`)
      if (!res.ok) return null
      const data = await res.json()
      return `${MEDIAMTX_URL}/${cameraId}/index.m3u8?user=viewer&pass=${data.token}`
    } catch {
      return null
    }
  }

  useEffect(() => {
    let cancelado = false
    buscarHlsUrl().then(url => {
      if (cancelado) return
      hlsUrlRef.current = url
      if (url) iniciar()
      else setStatus('error')
    })
    return () => { cancelado = true; parar() }
  }, [cameraId])

  async function iniciar() {
    setStatus('connecting')
    startRef.current = Date.now()

    const video = videoRef.current
    const hlsUrl = hlsUrlRef.current
    if (!video || !hlsUrl) return

    // Tenta HLS nativo (Safari) primeiro
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = hlsUrl
      video.addEventListener('loadedmetadata', () => {
        video.play().catch(() => {})
        setStatus('live')
        setLatency(Date.now() - startRef.current)
      })
      video.addEventListener('error', () => {
        setStatus('error')
        setTimeout(iniciar, 5000)
      })
      return
    }

    // Usa hls.js para Chrome/Firefox
    try {
      const HlsModule = await import('hls.js')
      const Hls = HlsModule.default

      if (!Hls.isSupported()) {
        setStatus('error')
        return
      }

      const hls = new Hls({
        liveSyncDurationCount: 2,
        liveMaxLatencyDurationCount: 4,
        lowLatencyMode: true,
        backBufferLength: 0,
        // Sem cookies — resolve o cookieCheck bloqueado
        xhrSetup: (xhr: XMLHttpRequest) => {
          xhr.withCredentials = false
        },
      })

      hlsRef.current = hls
      hls.loadSource(hlsUrl)
      hls.attachMedia(video)

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => {})
        setStatus('live')
        setLatency(Date.now() - startRef.current)
      })

      hls.on(Hls.Events.ERROR, (_: any, data: any) => {
        if (data.fatal) {
          console.error('[HLS] Erro fatal:', data)
          setStatus('error')
          hls.destroy()
          hlsRef.current = null
          setTimeout(iniciar, 5000)
        }
      })

    } catch (e) {
      console.error('[HLS] Erro ao carregar hls.js:', e)
      setStatus('error')
    }
  }

  function parar() {
    if (hlsRef.current) {
      hlsRef.current.destroy()
      hlsRef.current = null
    }
    if (videoRef.current) {
      videoRef.current.src = ''
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.95)',
      zIndex: 9999, display: 'flex', flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 16px', background: 'rgba(0,0,0,0.6)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{
            width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
            background: status === 'live' ? '#22c55e' : status === 'connecting' ? '#f59e0b' : '#ef4444',
            boxShadow: status === 'live' ? '0 0 0 3px rgba(34,197,94,0.25)' : 'none',
          }} />
          <span style={{ color: '#fff', fontWeight: 600, fontSize: 15 }}>{cameraName}</span>
          {status === 'live' && (
            <span style={{
              background: '#dc2626', color: '#fff', fontSize: 10,
              fontWeight: 700, padding: '2px 7px', borderRadius: 4, letterSpacing: 1,
            }}>AO VIVO</span>
          )}
          {status === 'live' && latency && (
            <span style={{ color: '#9ca3af', fontSize: 12 }}>HLS {latency}ms</span>
          )}
          {status === 'connecting' && (
            <span style={{ color: '#9ca3af', fontSize: 12 }}>Conectando HLS...</span>
          )}
          {status === 'error' && (
            <span style={{ color: '#fca5a5', fontSize: 12 }}>Reconectando em 5s...</span>
          )}
        </div>
        <button onClick={() => { parar(); onClose() }}
          style={{
            background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff',
            fontSize: 20, width: 36, height: 36, borderRadius: 8,
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
          ✕
        </button>
      </div>

      {/* Video HLS */}
      <div style={{ flex: 1, position: 'relative', background: '#000' }}>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
        />

        {status !== 'live' && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.55)', gap: 14,
          }}>
            {status === 'connecting' ? (
              <>
                <div style={{
                  width: 40, height: 40,
                  border: '3px solid rgba(255,255,255,0.15)',
                  borderTopColor: '#fff', borderRadius: '50%',
                  animation: 'spin 0.8s linear infinite',
                }} />
                <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
                <span style={{ color: '#9ca3af', fontSize: 14 }}>Carregando stream HLS...</span>
              </>
            ) : (
              <span style={{ color: '#fca5a5', fontSize: 14 }}>Sem sinal — reconectando...</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
