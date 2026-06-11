'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'

const API          = 'https://vms-platform-production.up.railway.app'
const SUPABASE_URL = 'https://wqoekhbwdrgryahoyjuo.supabase.co'
const LIVE_FPS = 20  // frames por segundo

interface Camera {
  id: string
  nome: string
  rtsp_url: string
  http_url?: string
  ativo: boolean
}

interface Regiao {
  id?: string
  camera_id: string
  tipo: string
  x1: number
  y1: number
  x2: number
  y2: number
}

const CORES_REGIAO: Record<string, string> = {
  cama:     '#3B82F6',
  banheiro: '#8B5CF6',
  cozinha:  '#F59E0B',
  quarto:   '#10B981',
}

const TIPOS_REGIAO = ['cama', 'banheiro', 'cozinha', 'quarto']

function liveUrl(cameraId: string) {
  return `${SUPABASE_URL}/storage/v1/object/public/live-frames/live/${cameraId}.jpg`
}

function CameraPlayer({ camera }: { camera: Camera }) {
  const [aoVivo, setAoVivo]           = useState(false)
  const [src, setSrc]                 = useState<string>(`${liveUrl(camera.id)}?t=${Date.now()}`)
  const [online, setOnline]           = useState(true)
  const [modoDesenho, setModoDesenho] = useState(false)
  const [tipoSelecionado, setTipoSelecionado] = useState('quarto')
  const [regioes, setRegioes]         = useState<Regiao[]>([])
  const [desenhando, setDesenhando]   = useState(false)
  const [inicio, setInicio]           = useState<{x: number, y: number} | null>(null)
  const [preview, setPreview]         = useState<{x1:number,y1:number,x2:number,y2:number} | null>(null)
  const [erro, setErro]               = useState<string | null>(null)

  const intervalRef  = useRef<NodeJS.Timeout | null>(null)
  const imgRef       = useRef<HTMLImageElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Carrega regiões existentes
  useEffect(() => {
    fetch(`${API}/regioes/${camera.id}`)
      .then(r => r.json())
      .then(data => setRegioes(Array.isArray(data) ? data : []))
      .catch(() => {})
  }, [camera.id])

  // Loop ao vivo via CDN Supabase
  useEffect(() => {
    if (!aoVivo) {
      if (intervalRef.current) clearInterval(intervalRef.current)
      return
    }
    intervalRef.current = setInterval(() => {
      setSrc(`${liveUrl(camera.id)}?t=${Date.now()}`)
    }, 1000 / LIVE_FPS)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [aoVivo, camera.id])

  function iniciarAoVivo() {
    setErro(null)
    setAoVivo(true)
    setSrc(`${liveUrl(camera.id)}?t=${Date.now()}`)
  }

  function pararAoVivo() {
    setAoVivo(false)
  }

  function atualizarSnapshot() {
    setSrc(`${liveUrl(camera.id)}?t=${Date.now()}`)
  }

  // ── Desenho de regiões ──────────────────────────────────
  function coordsRelativas(e: React.MouseEvent) {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top)  / rect.height,
    }
  }

  function onMouseDown(e: React.MouseEvent) {
    if (!modoDesenho) return
    e.preventDefault()
    const p = coordsRelativas(e)
    setDesenhando(true)
    setInicio(p)
    setPreview(null)
  }

  function onMouseMove(e: React.MouseEvent) {
    if (!modoDesenho || !desenhando || !inicio) return
    const p = coordsRelativas(e)
    setPreview({
      x1: Math.min(inicio.x, p.x),
      y1: Math.min(inicio.y, p.y),
      x2: Math.max(inicio.x, p.x),
      y2: Math.max(inicio.y, p.y),
    })
  }

  async function onMouseUp(e: React.MouseEvent) {
    if (!modoDesenho || !desenhando || !inicio) return
    setDesenhando(false)
    const p = coordsRelativas(e)
    const nova: Regiao = {
      camera_id: camera.id,
      tipo: tipoSelecionado,
      x1: Math.min(inicio.x, p.x),
      y1: Math.min(inicio.y, p.y),
      x2: Math.max(inicio.x, p.x),
      y2: Math.max(inicio.y, p.y),
    }
    if (nova.x2 - nova.x1 < 0.02 || nova.y2 - nova.y1 < 0.02) return
    setPreview(null)
    setInicio(null)

    const antigas = regioes.filter(r => r.tipo === tipoSelecionado)
    for (const r of antigas) {
      if (r.id) await fetch(`${API}/regioes/${r.id}`, { method: 'DELETE' }).catch(() => {})
    }

    try {
      const res = await fetch(`${API}/regioes/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nova),
      })
      const salva = await res.json()
      setRegioes(prev => [...prev.filter(r => r.tipo !== tipoSelecionado), salva])
    } catch {
      setErro('Erro ao salvar região')
    }
  }

  async function deletarRegiao(tipo: string) {
    const alvo = regioes.find(r => r.tipo === tipo)
    if (!alvo?.id) return
    await fetch(`${API}/regioes/${alvo.id}`, { method: 'DELETE' }).catch(() => {})
    setRegioes(prev => prev.filter(r => r.tipo !== tipo))
  }

  return (
    <div className="bg-gray-800 rounded-xl overflow-hidden">
      {/* Área de vídeo */}
      <div
        ref={containerRef}
        className={`relative bg-black aspect-video select-none ${modoDesenho ? 'cursor-crosshair' : 'cursor-default'}`}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
      >
        <img
          ref={imgRef}
          src={src}
          alt={camera.nome}
          className="w-full h-full object-cover"
          onLoad={() => setOnline(true)}
          onError={() => setOnline(false)}
          draggable={false}
        />

        {/* SVG overlay: regiões salvas + preview */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none">
          {regioes.map(r => (
            <rect
              key={r.tipo}
              x={`${r.x1 * 100}%`}
              y={`${r.y1 * 100}%`}
              width={`${(r.x2 - r.x1) * 100}%`}
              height={`${(r.y2 - r.y1) * 100}%`}
              fill={CORES_REGIAO[r.tipo] + '33'}
              stroke={CORES_REGIAO[r.tipo]}
              strokeWidth="2"
              rx="4"
            />
          ))}
          {regioes.map(r => (
            <text
              key={r.tipo + '_label'}
              x={`${r.x1 * 100 + 1}%`}
              y={`${r.y1 * 100 + 5}%`}
              fill={CORES_REGIAO[r.tipo]}
              fontSize="12"
              fontWeight="bold"
            >
              {r.tipo.toUpperCase()}
            </text>
          ))}
          {preview && (
            <rect
              x={`${preview.x1 * 100}%`}
              y={`${preview.y1 * 100}%`}
              width={`${(preview.x2 - preview.x1) * 100}%`}
              height={`${(preview.y2 - preview.y1) * 100}%`}
              fill={CORES_REGIAO[tipoSelecionado] + '44'}
              stroke={CORES_REGIAO[tipoSelecionado]}
              strokeWidth="2"
              strokeDasharray="6,3"
              rx="4"
            />
          )}
        </svg>

        {/* Badges status */}
        <div className="absolute top-2 left-2 flex gap-2">
          {aoVivo && (
            <span className={`text-white text-xs px-2 py-1 rounded-full font-bold flex items-center gap-1 ${online ? 'bg-red-600' : 'bg-gray-600'}`}>
              <span className={`w-2 h-2 rounded-full ${online ? 'bg-white animate-pulse' : 'bg-gray-400'}`} />
              {online ? 'AO VIVO' : 'SEM SINAL'}
            </span>
          )}
          {modoDesenho && (
            <span className="bg-purple-600 text-white text-xs px-2 py-1 rounded-full font-bold">
              ✏️ Desenhando {tipoSelecionado}
            </span>
          )}
        </div>

        {/* Botão play quando inativo */}
        {!aoVivo && !modoDesenho && (
          <button
            onClick={iniciarAoVivo}
            className="absolute inset-0 flex items-center justify-center bg-black/40 hover:bg-black/60 transition group"
          >
            <div className="w-16 h-16 bg-blue-600 rounded-full flex items-center justify-center group-hover:scale-110 transition">
              <span className="text-2xl ml-1">▶</span>
            </div>
          </button>
        )}
      </div>

      {/* Controles */}
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-white">{camera.nome}</h3>
          <span className={`text-xs px-2 py-1 rounded-full ${camera.ativo ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'}`}>
            {camera.ativo ? 'Ativa' : 'Inativa'}
          </span>
        </div>

        {erro && <p className="text-red-400 text-xs mb-3">⚠ {erro}</p>}

        <div className="flex gap-2 mb-3">
          {aoVivo ? (
            <button onClick={pararAoVivo} className="flex-1 bg-red-600 hover:bg-red-700 text-white text-sm py-2 rounded-lg font-bold transition">
              ⏹ Parar
            </button>
          ) : (
            <button onClick={iniciarAoVivo} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-sm py-2 rounded-lg font-bold transition">
              ▶ Ao Vivo
            </button>
          )}
          <button
            onClick={atualizarSnapshot}
            className="bg-gray-700 hover:bg-gray-600 text-white text-sm px-3 py-2 rounded-lg transition"
            title="Atualizar foto"
          >
            🔄
          </button>
          <button
            onClick={() => { setModoDesenho(v => !v); setPreview(null) }}
            className={`text-white text-sm px-3 py-2 rounded-lg transition font-bold ${modoDesenho ? 'bg-purple-600 hover:bg-purple-700' : 'bg-gray-700 hover:bg-gray-600'}`}
            title="Desenhar regiões de IA"
          >
            ✏️
          </button>
        </div>

        {/* Painel de desenho */}
        {modoDesenho && (
          <div className="bg-gray-900 rounded-lg p-3">
            <p className="text-gray-400 text-xs mb-2 font-bold">REGIÕES DE IA — clique e arraste na imagem</p>
            <div className="grid grid-cols-2 gap-2 mb-3">
              {TIPOS_REGIAO.map(tipo => (
                <button
                  key={tipo}
                  onClick={() => setTipoSelecionado(tipo)}
                  className={`text-xs py-1.5 px-2 rounded-lg font-bold transition border-2 ${
                    tipoSelecionado === tipo
                      ? 'text-white'
                      : 'bg-gray-800 text-gray-400 border-gray-700'
                  }`}
                  style={tipoSelecionado === tipo ? {
                    backgroundColor: CORES_REGIAO[tipo] + 'CC',
                    borderColor: CORES_REGIAO[tipo]
                  } : {}}
                >
                  {tipo.toUpperCase()}
                  {regioes.find(r => r.tipo === tipo) ? ' ✓' : ''}
                </button>
              ))}
            </div>
            {regioes.length > 0 && (
              <div className="space-y-1">
                {regioes.map(r => (
                  <div key={r.tipo} className="flex items-center justify-between text-xs">
                    <span style={{ color: CORES_REGIAO[r.tipo] }} className="font-bold">
                      ■ {r.tipo.toUpperCase()}
                    </span>
                    <button
                      onClick={() => deletarRegiao(r.tipo)}
                      className="text-red-400 hover:text-red-300 transition"
                    >
                      🗑 remover
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default function CamerasPage() {
  const [cameras, setCameras]     = useState<Camera[]>([])
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
          <div className="flex gap-3">
            <Link href="/eventos" className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg transition text-sm font-bold">
              ⚡ Eventos
            </Link>
            <Link href="/" className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg transition text-sm font-bold">
              ← Dashboard
            </Link>
          </div>
        </div>

        {carregando ? (
          <div className="flex items-center justify-center h-64">
            <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : cameras.length === 0 ? (
          <div className="text-center py-20 text-gray-500">
            <div className="text-5xl mb-4">📷</div>
            <p className="text-xl">Nenhuma câmera cadastrada</p>
            <Link href="/configuracoes" className="mt-4 inline-block bg-blue-600 hover:bg-blue-700 px-6 py-3 rounded-lg font-bold transition">
              + Adicionar câmera
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {cameras.filter(c => c.ativo).map(camera => (
              <CameraPlayer key={camera.id} camera={camera} />
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
