'use client'
import { useEffect, useRef, useState } from 'react'

// URL do MediaMTX via backend proxy — evita CORS
const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'https://vms-platform-production.up.railway.app'

interface WebRTCPlayerProps {
  cameraId: string
  cameraName: string
  onClose: () => void
}

type Status = 'connecting' | 'live' | 'error'

export function WebRTCPlayer({ cameraId, cameraName, onClose }: WebRTCPlayerProps) {
  const videoRef   = useRef<HTMLVideoElement>(null)
  const pcRef      = useRef<RTCPeerConnection | null>(null)
  const [status, setStatus]   = useState<Status>('connecting')
  const [latency, setLatency] = useState<number | null>(null)
  const startRef   = useRef(Date.now())

  useEffect(() => {
    conectar()
    return () => desconectar()
  }, [cameraId])

  async function conectar() {
    setStatus('connecting')
    startRef.current = Date.now()

    try {
      // Cria PeerConnection
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
      })
      pcRef.current = pc

      // Recebe o stream de video
      pc.ontrack = (evt) => {
        if (videoRef.current && evt.streams[0]) {
          videoRef.current.srcObject = evt.streams[0]
          videoRef.current.play()
            .then(() => {
              setStatus('live')
              setLatency(Date.now() - startRef.current)
            })
            .catch((e) => {
              console.error('[WebRTC] Play error:', e)
              // Tenta sem audio
              videoRef.current!.muted = true
              videoRef.current!.play().then(() => {
                setStatus('live')
                setLatency(Date.now() - startRef.current)
              })
            })
        }
      }

      pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
          setStatus('error')
          setTimeout(() => conectar(), 8000)  // Aumentado para 8s
        }
      }

      // Adiciona transceiver de video (so recebe)
      pc.addTransceiver('video', { direction: 'recvonly' })
      pc.addTransceiver('audio', { direction: 'recvonly' })

      // Cria offer
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)

      // Aguarda ICE gathering
      await new Promise<void>((resolve) => {
        if (pc.iceGatheringState === 'complete') { resolve(); return }
        pc.onicegatheringstatechange = () => {
          if (pc.iceGatheringState === 'complete') resolve()
        }
        setTimeout(resolve, 3000) // timeout de seguranca
      })

      // Envia offer para o backend que faz proxy para o MediaMTX
      const res = await fetch(`${API_BASE}/cameras/${cameraId}/webrtc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp' },
        body: pc.localDescription?.sdp,
      })

      if (!res.ok) {
        throw new Error(`MediaMTX respondeu ${res.status}`)
      }

      const answerSdp = await res.text()
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp })

    } catch (e) {
      console.error('[WebRTC] Erro:', e)
      setStatus('error')
      setTimeout(() => conectar(), 8000)
    }
  }

  function desconectar() {
    if (pcRef.current) {
      pcRef.current.close()
      pcRef.current = null
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
    // Notifica backend que viewer fechou
    fetch(`${API_BASE}/cameras/${cameraId}/webrtc`, { method: 'DELETE' }).catch(() => {})
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
            <span style={{ color: '#9ca3af', fontSize: 12 }}>
              WebRTC {latency}ms
            </span>
          )}
          {status === 'connecting' && (
            <span style={{ color: '#9ca3af', fontSize: 12 }}>Conectando WebRTC...</span>
          )}
          {status === 'error' && (
            <span style={{ color: '#fca5a5', fontSize: 12 }}>Reconectando em 3s...</span>
          )}
        </div>
        <button onClick={() => { desconectar(); onClose() }}
          style={{
            background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff',
            fontSize: 20, width: 36, height: 36, borderRadius: 8,
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
          x
        </button>
      </div>

      {/* Video WebRTC */}
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
                <span style={{ color: '#9ca3af', fontSize: 14 }}>Aguardando WebRTC...</span>
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
