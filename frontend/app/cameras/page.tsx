'use client'
import { useEffect, useRef, useState, useCallback } from 'react'
import Link from 'next/link'
import { useAuth } from '../hooks/useAuth'

const API = 'https://vms-platform-production.up.railway.app'
const SUPABASE_URL = 'https://wqoekhbwdrgryahoyjuo.supabase.co'
const SUPABASE_KEY = 'sb_publishable_0UZ6n5qJEkfAbiKveWTE0A_ixc_w9MY'

interface Camera {
  id: string
  nome: string
  rtsp_url: string
  http_url?: string
  ativo: boolean
  empresa_id: string
}

interface Analiticos {
  queda_leito: boolean
  queda_pe: boolean
  pessoa: boolean
  banheiro_tempo: boolean
  gesto_socorro: boolean
  linha_contagem: boolean
  habitos: boolean
}

const ANALITICOS_DEFAULT: Analiticos = {
  queda_leito: false, queda_pe: false, pessoa: false,
  banheiro_tempo: false, gesto_socorro: false,
  linha_contagem: false, habitos: false,
}

function liveUrl(cameraId: string) {
  return `${API}/cameras/${cameraId}/frame`
}

async function carregarAnaliticos(cameraId: string): Promise<Analiticos> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/camera_analiticos?camera_id=eq.${cameraId}&select=*`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    )
    const data = await res.json()
    if (data && data[0]) {
      const { camera_id, updated_at, ...rest } = data[0]
      return { ...ANALITICOS_DEFAULT, ...rest } as Analiticos
    }
  } catch {}
  return { ...ANALITICOS_DEFAULT }
}

async function salvarAnaliticos(cameraId: string, analiticos: Analiticos) {
  await fetch(`${SUPABASE_URL}/rest/v1/camera_analiticos`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify({ camera_id: cameraId, ...analiticos }),
  })
}

function BtnIcon({ onClick, title, children, className = '' }: {
  onClick: () => void; title: string; children: React.ReactNode; className?: string
}) {
  return (
    <button onClick={onClick} title={title}
      className={`w-9 h-9 rounded-lg flex items-center justify-center text-sm font-bold transition ${className}`}>
      {children}
    </button>
  )
}

function PainelAnaliticos({ cameraId, onClose }: { cameraId: string; onClose: () => void }) {
  const [analiticos, setAnaliticos] = useState<Analiticos>(ANALITICOS_DEFAULT)
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    carregarAnaliticos(cameraId).then(setAnaliticos)
  }, [cameraId])

  async function toggle(key: keyof Analiticos) {
    const novo = { ...analiticos, [key]: !analiticos[key] }
    setAnaliticos(novo)
    setSalvando(true)
    await salvarAnaliticos(cameraId, novo)
    setSalvando(false)
  }

  const items: { key: keyof Analiticos; label: string }[] = [
    { key: 'queda_leito', label: 'Queda do Leito' },
    { key: 'queda_pe', label: 'Queda em Pe' },
    { key: 'pessoa', label: 'Detectar Pessoa' },
    { key: 'banheiro_tempo', label: 'Tempo no Banheiro' },
    { key: 'gesto_socorro', label: 'Gesto de Socorro' },
    { key: 'linha_contagem', label: 'Linha de Contagem' },
    { key: 'habitos', label: 'Monitorar Habitos' },
  ]

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-xl p-5 max-w-xs w-full shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-white font-bold text-lg">Analiticos IA</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl">x</button>
        </div>
        {salvando && <p className="text-blue-400 text-xs mb-2">Salvando...</p>}
        <div className="space-y-2">
          {items.map(({ key, label }) => (
            <div key={key} className="flex items-center justify-between bg-gray-900 rounded-lg px-3 py-2">
              <span className="text-gray-300 text-sm">{label}</span>
              <button onClick={() => toggle(key)}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${analiticos[key] ? 'bg-blue-600' : 'bg-gray-600'}`}>
                <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${analiticos[key] ? 'translate-x-5' : 'translate-x-1'}`} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function CameraPlayer({ camera, cameraAoVivoId, setCameraAoVivoId }: {
  camera: Camera
  cameraAoVivoId: string | null
  setCameraAoVivoId: (id: string | null) => void
}) {
  const aoVivo = cameraAoVivoId === camera.id
  function setAoVivo(v: boolean) { setCameraAoVivoId(v ? camera.id : null) }

  const [bufA, setBufA] = useState<string>('')
  const [bufB, setBufB] = useState<string>('')
  const [ativo, setAtivo] = useState<'A' | 'B'>('A')
  const [showAnaliticos, setShowAnaliticos] = useState(false)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    if (aoVivo) {
      setBufA(`${liveUrl(camera.id)}?t=${Date.now()}`)
      intervalRef.current = setInterval(() => {
        const nextUrl = `${liveUrl(camera.id)}?t=${Date.now()}`
        if (ativo === 'A') { setBufB(nextUrl); setAtivo('B') }
        else { setBufA(nextUrl); setAtivo('A') }
      }, 1000)
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [aoVivo, camera.id])

  const snapshotUrl = `${API}/cameras/${camera.id}/snapshot`

  return (
    <>
      {showAnaliticos && (
        <PainelAnaliticos cameraId={camera.id} onClose={() => setShowAnaliticos(false)} />
      )}
      <div className="bg-gray-800 rounded-xl overflow-hidden shadow-lg">
        {/* Video area */}
        <div className="relative aspect-video bg-black">
          {aoVivo ? (
            <>
              <img src={bufA} alt={camera.nome} className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${ativo === 'A' ? 'opacity-100' : 'opacity-0'}`} />
              <img src={bufB} alt={camera.nome} className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${ativo === 'B' ? 'opacity-100' : 'opacity-0'}`} />
              <div className="absolute top-2 left-2 flex items-center gap-1.5 bg-red-600 rounded-full px-2 py-0.5">
                <div className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                <span className="text-white text-xs font-bold">AO VIVO</span>
              </div>
            </>
          ) : (
            <>
              <img src={snapshotUrl} alt={camera.nome} className="w-full h-full object-cover opacity-60" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
              <button onClick={() => setAoVivo(true)}
                className="absolute inset-0 flex items-center justify-center bg-black/30 hover:bg-black/40 transition">
                <div className="w-14 h-14 bg-blue-600 rounded-full flex items-center justify-center shadow-lg">
                  <span className="text-white text-2xl ml-1">&#9654;</span>
                </div>
              </button>
            </>
          )}
        </div>

        {/* Controls */}
        <div className="p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-white font-bold">{camera.nome}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${camera.ativo ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'}`}>
              {camera.ativo ? 'Ativa' : 'Inativa'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {aoVivo ? (
              <button onClick={() => setAoVivo(false)}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white text-sm font-bold py-1.5 rounded-lg transition flex items-center justify-center gap-1">
                <span>&#9632;</span> Parar
              </button>
            ) : (
              <button onClick={() => setAoVivo(true)}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold py-1.5 rounded-lg transition flex items-center justify-center gap-1">
                <span>&#9654;</span> Ao Vivo
              </button>
            )}
            <BtnIcon onClick={() => {}} title="Regioes" className="bg-gray-700 hover:bg-gray-600 text-white">
              [R]
            </BtnIcon>
            <BtnIcon onClick={() => {}} title="Editar" className="bg-gray-700 hover:bg-gray-600 text-white">
              [E]
            </BtnIcon>
            <div className="relative">
              <BtnIcon onClick={() => setShowAnaliticos(true)} title="Analiticos IA" className="bg-gray-700 hover:bg-gray-600 text-purple-300">
                IA
              </BtnIcon>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

export default function CamerasPage() {
  const { usuario } = useAuth()
  const [cameras, setCameras] = useState<Camera[]>([])
  const [carregando, setCarregando] = useState(true)
  const [cameraAoVivoId, setCameraAoVivoId] = useState<string | null>(null)

  useEffect(() => {
    if (!usuario) return
    fetch(`${API}/cameras/?empresa_id=${usuario.empresa_id}`)
      .then(r => r.json())
      .then(data => { setCameras(Array.isArray(data) ? data : []); setCarregando(false) })
      .catch(() => setCarregando(false))
  }, [usuario])

  return (
    <main className="min-h-screen bg-gray-950 text-white p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-blue-400">Cameras ao Vivo</h1>
            <p className="text-gray-400 text-sm mt-1">{cameras.length} cameras cadastradas</p>
          </div>
          <div className="flex gap-3">
            <Link href="/eventos" className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg font-bold text-sm transition">
              Eventos
            </Link>
            <Link href="/" className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg font-bold text-sm transition">
              Dashboard
            </Link>
          </div>
        </div>

        {carregando ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : cameras.length === 0 ? (
          <div className="text-center py-20 text-gray-400">Nenhuma camera cadastrada.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {cameras.map(camera => (
              <CameraPlayer
                key={camera.id}
                camera={camera}
                cameraAoVivoId={cameraAoVivoId}
                setCameraAoVivoId={setCameraAoVivoId}
              />
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
