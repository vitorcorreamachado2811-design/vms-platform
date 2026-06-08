'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import Hls from 'hls.js'

const API = 'https://vms-platform-production.up.railway.app'

interface Camera {
  id: string
  nome: string
  rtsp_url: string
  ativo: boolean
}

interface StreamStatus {
  iniciando: boolean
  ativo: boolean
  erro: string | null
}

function CameraPlayer({ camera }: { camera: Camera }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  const [status, setStatus] = useState<StreamStatus>({
    iniciando: false,
    ativo: false,
    erro: null,
  })
  const [snapshot, setSnapshot] = useState<string | null>(null)

  // Carrega snapshot ao montar
  useEffect(() => {
    setSnapshot(`${API}/cameras/${camera.id}/snapshot?t=${Date.now()}`)
  }, [camera.id])

  async function iniciarStream() {
    setStatus({ iniciando: true, ativo: false, erro: null })

    try {
      // Passo 1 — pede pro backend iniciar o FFmpeg
      const res = await fetch(`${API}/cameras/${camera.id}/stream/iniciar`, {
        method: 'POST',
      })

      if (!res.ok) {
        const erro = await res.json()
        throw new Error(erro.detail || 'Erro ao iniciar stream')
      }

      const data = await res.json()
      const playlistUrl = `${API}${data.playlist}`

      // Passo 2 — conecta o hls.js no elemento <video>
      if (!videoRef.current) return

      if (Hls.isSupported()) {
        // Chrome, Firefox, Edge — usa hls.js
        const hls = new Hls({
          liveSyncDurationCount: 3,   // Mantém 3 segmentos em buffer
          liveMaxLatencyDurationCount: 6,
        })
        hls.loadSource(playlistUrl)
        hls.attachMedia(videoRef.current)
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          videoRef.current?.play()
          setStatus({ iniciando: false, ativo: true, erro: null })
        })
        hls.on(Hls.Events.ERROR, (_, data) => {
          if (data.fatal) {
            setStatus({ iniciando: false, ativo: false, erro: 'Erro no stream' })
          }
        })
        hlsRef.current = hls
      } else if (videoRef.current.canPlayType('application/vnd.apple.mpegurl')) {
        // Safari — suporte nativo HLS
        videoRef.current.src = playlistUrl
        videoRef.current.play()
        setStatus({ iniciando: false, ativo: true, erro: null })
      }
    } catch (err: any) {
      setStatus({ iniciando: false, ativo: false, erro: err.message })
    }
  }

  async function pararStream() {
    // Para o hls.js
    if (hlsRef.current) {
      hlsRef.current.destroy()
      hlsRef.current = null
    }
    if (videoRef.current) {
      videoRef.current.src = ''
    }
    // Para o FFmpeg no backend
    await fetch(`${API}/cameras/${camera.id}/stream/parar`, { method: 'POST' })
    setStatus({ iniciando: false, ativo: false, erro: null })
  }

  function atualizarSnapshot() {
    setSnapshot(`${API}/cameras/${camera.id}/snapshot?t=${Date.now()}`)
  }

  // Limpa ao desmontar
  useEffect(() => {
    return () => {
      if (hlsRef.current) hlsRef.current.destroy()
    }
  }, [])

  return (
    <div className="bg-gray-800 rounded-xl overflow-hidden">
      {/* Área de vídeo */}
      <div className="relative bg-black aspect-video">
        {/* Video HLS — visível só quando stream ativo */}
        <video
          ref={videoRef}
          className={`w-full h-full object-cover ${status.ativo ? 'block' : 'hidden'}`}
          muted
          playsInline
        />

        {/* Snapshot — visível quando stream inativo */}
        {!status.ativo && snapshot && (
          <img
            src={snapshot}
            alt={camera.nome}
            className="w-full h-full object-cover"
            onError={() => setSnapshot(null)}
          />
        )}

        {/* Placeholder quando sem snapshot */}
        {!status.ativo && !snapshot && (
          <div className="w-full h-full flex items-center justify-center">
            <div className="text-center text-gray-500">
              <div className="text-4xl mb-2">📷</div>
              <p className="text-sm">Sem sinal</p>
            </div>
          </div>
        )}

        {/* Badge de status */}
        <div className="absolute top-2 left-2">
          {status.ativo && (
            <span className="bg-red-600 text-white text-xs px-2 py-1 rounded-full font-bold flex items-center gap-1">
              <span className="w-2 h-2 bg-white rounded-full animate-pulse" />
              AO VIVO
            </span>
          )}
          {status.iniciando && (
            <span className="bg-yellow-600 text-white text-xs px-2 py-1 rounded-full font-bold">
              Conectando...
            </span>
          )}
        </div>

        {/* Botão play centralizado quando inativo */}
        {!status.ativo && !status.iniciando && (
          <button
            onClick={iniciarStream}
            className="absolute inset-0 flex items-center justify-center bg-black/40 hover:bg-black/60 transition group"
          >
            <div className="w-16 h-16 bg-blue-600 rounded-full flex items-center justify-center group-hover:scale-110 transition">
              <span className="text-2xl ml-1">▶</span>
            </div>
          </button>
        )}

        {/* Loading spinner */}
        {status.iniciando && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60">
            <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>

      {/* Info e controles */}
      <div className="p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-bold text-white">{camera.nome}</h3>
          <span className={`text-xs px-2 py-1 rounded-full ${camera.ativo ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'}`}>
            {camera.ativo ? 'Ativa' : 'Inativa'}
          </span>
        </div>

        <p className="text-gray-400 text-xs truncate mb-3">{camera.rtsp_url}</p>

        {status.erro && (
          <p className="text-red-400 text-xs mb-3">⚠ {status.erro}</p>
        )}

        <div className="flex gap-2">
          {status.ativo ? (
            <button
              onClick={pararStream}
              className="flex-1 bg-red-600 hover:bg-red-700 text-white text-sm py-2 rounded-lg font-bold transition"
            >
              ⏹ Parar
            </button>
          ) : (
            <button
              onClick={iniciarStream}
              disabled={status.iniciando}
              className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white text-sm py-2 rounded-lg font-bold transition"
            >
              {status.iniciando ? 'Conectando...' : '▶ Ao Vivo'}
            </button>
          )}
          <button
            onClick={atualizarSnapshot}
            disabled={status.ativo}
            className="bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 text-white text-sm px-3 py-2 rounded-lg transition"
            title="Atualizar foto"
          >
            🔄
          </button>
        </div>
      </div>
    </div>
  )
}

export default function CamerasPage() {
  const [cameras, setCameras] = useState<Camera[]>([])
  const [carregando, setCarregando] = useState(true)

  useEffect(() => {
    fetch(`${API}/cameras/`)
      .then(r => r.json())
      .then(data => {
        setCameras(Array.isArray(data) ? data : [])
        setCarregando(false)
      })
      .catch(() => setCarregando(false))
  }, [])

  return (
    <main className="min-h-screen bg-gray-950 text-white p-8">
      <div className="max-w-7xl mx-auto">

        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-blue-400">Câmeras ao Vivo</h1>
            <p className="text-gray-400 mt-1">{cameras.length} câmera{cameras.length !== 1 ? 's' : ''} cadastrada{cameras.length !== 1 ? 's' : ''}</p>
          </div>
          <Link href="/" className="bg-gray-800 hover:bg-gray-700 px-4 py-2 rounded-lg transition">
            ← Dashboard
          </Link>
        </div>

        {carregando ? (
          <div className="flex items-center justify-center h-64">
            <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : cameras.length === 0 ? (
          <div className="text-center py-24 text-gray-500">
            <div className="text-6xl mb-4">📷</div>
            <p className="text-xl">Nenhuma câmera cadastrada</p>
            <Link href="/" className="text-blue-400 hover:underline mt-2 block">
              Cadastrar câmera →
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {cameras.map(camera => (
              <CameraPlayer key={camera.id} camera={camera} />
            ))}
          </div>
        )}

      </div>
    </main>
  )
}