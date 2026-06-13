'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '../hooks/useAuth'

const API          = 'https://vms-platform-production.up.railway.app'
const SUPABASE_URL = 'https://wqoekhbwdrgryahoyjuo.supabase.co'
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const LIVE_FPS     = 10

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
  queda_leito:    false,
  queda_pe:       false,
  pessoa:         false,
  banheiro_tempo: false,
  gesto_socorro:  false,
  linha_contagem: false,
  habitos:        false,
}

const ANALITICOS_INFO: { key: keyof Analiticos; label: string; icon: string; cor: string }[] = [
  { key: 'queda_leito',    label: 'Queda do Leito',    icon: '🛏️', cor: '#EF4444' },
  { key: 'queda_pe',       label: 'Queda em Pé',       icon: '🚨', cor: '#F97316' },
  { key: 'pessoa',         label: 'Pessoa Detectada',  icon: '👤', cor: '#3B82F6' },
  { key: 'banheiro_tempo', label: 'Banheiro (tempo)',  icon: '🚿', cor: '#8B5CF6' },
  { key: 'gesto_socorro',  label: 'Gesto de Socorro',  icon: '🙋', cor: '#EC4899' },
  { key: 'linha_contagem', label: 'Linha de Contagem', icon: '↔️', cor: '#10B981' },
  { key: 'habitos',        label: 'Hábitos',           icon: '📊', cor: '#F59E0B' },
]

const ANALITICO_REGIOES: Partial<Record<keyof Analiticos, string[]>> = {
  queda_leito:    ['cama'],
  banheiro_tempo: ['banheiro'],
  gesto_socorro:  ['quarto'],
  habitos:        ['cozinha', 'quarto'],
  linha_contagem: ['linha'],
}

const CORES_REGIAO: Record<string, string> = {
  cama:     '#EF4444',
  banheiro: '#8B5CF6',
  cozinha:  '#F59E0B',
  quarto:   '#10B981',
  linha:    '#10B981',
}

function liveUrl(cameraId: string) {
  return `${SUPABASE_URL}/storage/v1/object/public/live-frames/live/${cameraId}.jpg`
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
    body: JSON.stringify({ camera_id: cameraId, ...analiticos, updated_at: new Date().toISOString() }),
  })
}

function Toggle({ ativo, onChange }: { ativo: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 focus:outline-none ${
        ativo ? 'bg-green-500' : 'bg-gray-600'
      }`}
    >
      <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform duration-200 ${ativo ? 'translate-x-4' : 'translate-x-1'}`} />
    </button>
  )
}

function CameraPlayer({ camera }: { camera: Camera }) {
  const [aoVivo, setAoVivo]           = useState(false)
  const [bufA, setBufA]               = useState<string>('')
  const [bufB, setBufB]               = useState<string>('')
  const [ativo, setAtivo]             = useState<'A' | 'B'>('A')
  const [online, setOnline]           = useState(true)
  const [modoDesenho, setModoDesenho] = useState(false)
  const [tipoSelecionado, setTipoSelecionado] = useState('')
  const [regioes, setRegioes]         = useState<Regiao[]>([])
  const [desenhando, setDesenhando]   = useState(false)
  const [inicio, setInicio]           = useState<{x: number, y: number} | null>(null)
  const [preview, setPreview]         = useState<{x1:number,y1:number,x2:number,y2:number} | null>(null)
  const [erro, setErro]               = useState<string | null>(null)
  const [abaAtiva, setAbaAtiva]       = useState<'regioes' | 'analiticos' | null>(null)
  const [analiticos, setAnaliticos]   = useState<Analiticos>({ ...ANALITICOS_DEFAULT })
  const [carregouAnaliticos, setCarregouAnaliticos] = useState(false)
  const [salvando, setSalvando]       = useState(false)

  const intervalRef  = useRef<NodeJS.Timeout | null>(null)
  const ativoRef     = useRef<'A' | 'B'>('A')
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => { ativoRef.current = ativo }, [ativo])

  useEffect(() => {
    fetch(`${API}/regioes/${camera.id}`)
      .then(r => r.json())
      .then(data => setRegioes(Array.isArray(data) ? data : []))
      .catch(() => {})
    carregarAnaliticos(camera.id).then(a => {
      setAnaliticos(a)
      setCarregouAnaliticos(true)
      const tipos = getTiposLiberados(a)
      if (tipos.length > 0) setTipoSelecionado(tipos.filter(t => t !== 'linha')[0] || '')
    })
  }, [camera.id])

  useEffect(() => {
    if (!aoVivo) {
      if (intervalRef.current) clearInterval(intervalRef.current)
      return
    }
    setBufA(`${liveUrl(camera.id)}?t=${Date.now()}`)
    intervalRef.current = setInterval(() => {
      const nextUrl = `${liveUrl(camera.id)}?t=${Date.now()}`
      const proximo = ativoRef.current === 'A' ? 'B' : 'A'
      const img = new Image()
      img.onload = () => {
        if (proximo === 'B') setBufB(nextUrl)
        else setBufA(nextUrl)
        setAtivo(proximo)
        setOnline(true)
      }
      img.onerror = () => setOnline(false)
      img.src = nextUrl
    }, 1000 / LIVE_FPS)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [aoVivo, camera.id])

  function getTiposLiberados(a: Analiticos): string[] {
    const tipos = new Set<string>()
    for (const [key, regioesList] of Object.entries(ANALITICO_REGIOES)) {
      if (a[key as keyof Analiticos]) {
        regioesList?.forEach(r => tipos.add(r))
      }
    }
    return Array.from(tipos)
  }

  const tiposLiberados = getTiposLiberados(analiticos)
  const regioesVisiveis = regioes.filter(r => tiposLiberados.includes(r.tipo))

  async function toggleAnalitico(key: keyof Analiticos) {
    const novo = { ...analiticos, [key]: !analiticos[key] }
    setAnaliticos(novo)
    setSalvando(true)
    await salvarAnaliticos(camera.id, novo)
    setSalvando(false)
    const tipos = getTiposLiberados(novo)
    const tiposDesenho = tipos.filter(t => t !== 'linha')
    if (!tiposDesenho.includes(tipoSelecionado)) {
      setTipoSelecionado(tiposDesenho[0] || '')
    }
  }

  function coordsRelativas(e: React.MouseEvent) {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top)  / rect.height,
    }
  }

  function onMouseDown(e: React.MouseEvent) {
    if (!modoDesenho || !tipoSelecionado || tipoSelecionado === 'linha') return
    e.preventDefault()
    setDesenhando(true)
    setInicio(coordsRelativas(e))
    setPreview(null)
  }

  function onMouseMove(e: React.MouseEvent) {
    if (!modoDesenho || !desenhando || !inicio) return
    const p = coordsRelativas(e)
    setPreview({
      x1: Math.min(inicio.x, p.x), y1: Math.min(inicio.y, p.y),
      x2: Math.max(inicio.x, p.x), y2: Math.max(inicio.y, p.y),
    })
  }

  async function onMouseUp(e: React.MouseEvent) {
    if (!modoDesenho || !desenhando || !inicio) return
    setDesenhando(false)
    const p = coordsRelativas(e)
    const nova: Regiao = {
      camera_id: camera.id, tipo: tipoSelecionado,
      x1: Math.min(inicio.x, p.x), y1: Math.min(inicio.y, p.y),
      x2: Math.max(inicio.x, p.x), y2: Math.max(inicio.y, p.y),
    }
    if (nova.x2 - nova.x1 < 0.02 || nova.y2 - nova.y1 < 0.02) return
    setPreview(null); setInicio(null)
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
    } catch { setErro('Erro ao salvar região') }
  }

  async function deletarRegiao(tipo: string) {
    const alvo = regioes.find(r => r.tipo === tipo)
    if (!alvo?.id) return
    await fetch(`${API}/regioes/${alvo.id}`, { method: 'DELETE' }).catch(() => {})
    setRegioes(prev => prev.filter(r => r.tipo !== tipo))
  }

  const ativos = Object.values(analiticos).filter(Boolean).length

  return (
    <div className="bg-gray-800 rounded-xl overflow-hidden">
      <div
        ref={containerRef}
        className={`relative bg-black aspect-video select-none ${modoDesenho && tipoSelecionado && tipoSelecionado !== 'linha' ? 'cursor-crosshair' : 'cursor-default'}`}
        onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp}
      >
        <img src={bufA} alt={camera.nome} draggable={false}
          className="absolute inset-0 w-full h-full object-cover transition-opacity duration-75"
          style={{ opacity: ativo === 'A' ? 1 : 0 }} />
        <img src={bufB} alt={camera.nome} draggable={false}
          className="absolute inset-0 w-full h-full object-cover transition-opacity duration-75"
          style={{ opacity: ativo === 'B' ? 1 : 0 }} />

        {!bufA && !bufB && (
          <div className="absolute inset-0 flex items-center justify-center text-gray-500">
            <div className="text-center"><div className="text-4xl mb-2">📷</div><p className="text-sm">Sem sinal</p></div>
          </div>
        )}

        <svg className="absolute inset-0 w-full h-full pointer-events-none">
          {regioesVisiveis.map(r => (
            <rect key={r.tipo} x={`${r.x1*100}%`} y={`${r.y1*100}%`}
              width={`${(r.x2-r.x1)*100}%`} height={`${(r.y2-r.y1)*100}%`}
              fill={(CORES_REGIAO[r.tipo]||'#fff')+'33'} stroke={CORES_REGIAO[r.tipo]||'#fff'} strokeWidth="2" rx="4" />
          ))}
          {regioesVisiveis.map(r => (
            <text key={r.tipo+'_label'} x={`${r.x1*100+1}%`} y={`${r.y1*100+5}%`}
              fill={CORES_REGIAO[r.tipo]||'#fff'} fontSize="12" fontWeight="bold">{r.tipo.toUpperCase()}</text>
          ))}
          {preview && modoDesenho && tipoSelecionado && tipoSelecionado !== 'linha' && (
            <rect x={`${preview.x1*100}%`} y={`${preview.y1*100}%`}
              width={`${(preview.x2-preview.x1)*100}%`} height={`${(preview.y2-preview.y1)*100}%`}
              fill={(CORES_REGIAO[tipoSelecionado]||'#fff')+'44'} stroke={CORES_REGIAO[tipoSelecionado]||'#fff'}
              strokeWidth="2" strokeDasharray="6,3" rx="4" />
          )}
        </svg>

        <div className="absolute top-2 left-2 flex gap-2">
          {aoVivo && (
            <span className={`text-white text-xs px-2 py-1 rounded-full font-bold flex items-center gap-1 ${online ? 'bg-red-600' : 'bg-gray-600'}`}>
              <span className={`w-2 h-2 rounded-full ${online ? 'bg-white animate-pulse' : 'bg-gray-400'}`} />
              {online ? 'AO VIVO' : 'SEM SINAL'}
            </span>
          )}
          {modoDesenho && tipoSelecionado && tipoSelecionado !== 'linha' && (
            <span className="text-white text-xs px-2 py-1 rounded-full font-bold"
              style={{ backgroundColor: (CORES_REGIAO[tipoSelecionado]||'#8B5CF6')+'CC' }}>
              ✏️ {tipoSelecionado.toUpperCase()}
            </span>
          )}
        </div>

        {!aoVivo && !modoDesenho && (
          <button onClick={() => { setErro(null); setAoVivo(true) }}
            className="absolute inset-0 flex items-center justify-center bg-black/40 hover:bg-black/60 transition group">
            <div className="w-16 h-16 bg-blue-600 rounded-full flex items-center justify-center group-hover:scale-110 transition">
              <span className="text-2xl ml-1">▶</span>
            </div>
          </button>
        )}
      </div>

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
            <button onClick={() => { setAoVivo(false); if (intervalRef.current) clearInterval(intervalRef.current) }}
              className="flex-1 bg-red-600 hover:bg-red-700 text-white text-sm py-2 rounded-lg font-bold transition">
              ⏹ Parar
            </button>
          ) : (
            <button onClick={() => { setErro(null); setAoVivo(true) }}
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-sm py-2 rounded-lg font-bold transition">
              ▶ Ao Vivo
            </button>
          )}
          <button onClick={() => { const url = `${liveUrl(camera.id)}?t=${Date.now()}`; setBufA(url); setAtivo('A') }}
            className="bg-gray-700 hover:bg-gray-600 text-white text-sm px-3 py-2 rounded-lg transition" title="Atualizar">
            🔄
          </button>
          <button
            onClick={() => {
              const next = abaAtiva === 'regioes' ? null : 'regioes'
              setAbaAtiva(next)
              setModoDesenho(next === 'regioes')
              setPreview(null)
            }}
            className={`text-white text-sm px-3 py-2 rounded-lg transition font-bold ${abaAtiva === 'regioes' ? 'bg-purple-600 hover:bg-purple-700' : 'bg-gray-700 hover:bg-gray-600'}`}
          >
            ✏️
          </button>
          <button
            onClick={() => setAbaAtiva(v => v === 'analiticos' ? null : 'analiticos')}
            className={`relative text-white text-sm px-3 py-2 rounded-lg transition font-bold ${abaAtiva === 'analiticos' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-gray-700 hover:bg-gray-600'}`}
          >
            🧠
            <span className="absolute -top-1 -right-1 bg-green-500 text-white text-xs w-4 h-4 rounded-full flex items-center justify-center font-bold">
              {ativos}
            </span>
          </button>
        </div>

        {abaAtiva === 'regioes' && (
          <div className="bg-gray-900 rounded-lg p-3">
            <p className="text-gray-400 text-xs mb-2 font-bold">REGIÕES DE IA — clique e arraste na imagem</p>
            {!carregouAnaliticos ? (
              <p className="text-gray-500 text-xs">Carregando...</p>
            ) : tiposLiberados.length === 0 ? (
              <p className="text-yellow-500 text-xs">Ative ao menos um analítico com região no painel 🧠</p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2 mb-3">
                  {tiposLiberados.filter(t => t !== 'linha').map(tipo => (
                    <button key={tipo} onClick={() => setTipoSelecionado(tipo)}
                      className={`text-xs py-1.5 px-2 rounded-lg font-bold transition border-2 ${
                        tipoSelecionado === tipo ? 'text-white' : 'bg-gray-800 text-gray-400 border-gray-700'
                      }`}
                      style={tipoSelecionado === tipo ? {
                        backgroundColor: (CORES_REGIAO[tipo]||'#fff')+'CC',
                        borderColor: CORES_REGIAO[tipo]||'#fff'
                      } : {}}>
                      {tipo.toUpperCase()}{regioes.find(r => r.tipo === tipo) ? ' ✓' : ''}
                    </button>
                  ))}
                </div>
                {tiposLiberados.includes('linha') && (
                  <div className="mb-2 p-2 rounded-lg border border-green-700 bg-green-900/20">
                    <p className="text-green-400 text-xs font-bold">↔️ Linha de Contagem</p>
                    <p className="text-gray-400 text-xs mt-0.5">Configure em <Link href="/contagem" className="underline text-green-400">Contagem</Link></p>
                  </div>
                )}
                {regioesVisiveis.length > 0 && (
                  <div className="space-y-1 mt-2">
                    {regioesVisiveis.map(r => (
                      <div key={r.tipo} className="flex items-center justify-between text-xs">
                        <span style={{ color: CORES_REGIAO[r.tipo]||'#fff' }} className="font-bold">■ {r.tipo.toUpperCase()}</span>
                        <button onClick={() => deletarRegiao(r.tipo)} className="text-red-400 hover:text-red-300 transition">🗑 remover</button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {abaAtiva === 'analiticos' && (
          <div className="bg-gray-900 rounded-lg p-3">
            <div className="flex items-center justify-between mb-3">
              <p className="text-gray-400 text-xs font-bold">ANALÍTICOS DE IA</p>
              {salvando && <span className="text-xs text-gray-500 animate-pulse">Salvando...</span>}
            </div>
            <div className="space-y-2">
              {ANALITICOS_INFO.map(({ key, label, icon, cor }) => {
                const temRegiao = !!ANALITICO_REGIOES[key]
                return (
                  <div key={key} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm">{icon}</span>
                      <span className="text-xs text-gray-300">{label}</span>
                      {analiticos[key] && (
                        <span className="text-xs px-1.5 py-0.5 rounded-full font-bold"
                          style={{ backgroundColor: cor + '33', color: cor }}>ON</span>
                      )}
                      {analiticos[key] && temRegiao && (
                        <span className="text-xs text-gray-500">✏️</span>
                      )}
                    </div>
                    <Toggle ativo={analiticos[key]} onChange={() => toggleAnalitico(key)} />
                  </div>
                )
              })}
            </div>
            <p className="text-gray-600 text-xs mt-3">✏️ = possui região de IA configurável</p>
          </div>
        )}
      </div>
    </div>
  )
}

export default function CamerasPage() {
  const { usuario } = useAuth()
  const [cameras, setCameras]       = useState<Camera[]>([])
  const [carregando, setCarregando] = useState(true)

  useEffect(() => {
    if (!usuario) return
    fetch(`${API}/cameras/?empresa_id=${usuario.empresa_id}`)
      .then(r => r.json())
      .then(data => { setCameras(Array.isArray(data) ? data : []); setCarregando(false) })
      .catch(() => setCarregando(false))
  }, [usuario])

  return (
    <main className="min-h-screen bg-gray-950 text-white p-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-blue-400">Câmeras ao Vivo</h1>
            <p className="text-gray-400 mt-1">{cameras.length} câmera{cameras.length !== 1 ? 's' : ''} cadastrada{cameras.length !== 1 ? 's' : ''}</p>
          </div>
          <div className="flex gap-3">
            <Link href="/eventos" className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg transition text-sm font-bold">⚡ Eventos</Link>
            <Link href="/" className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg transition text-sm font-bold">← Dashboard</Link>
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
            <Link href="/" className="mt-4 inline-block bg-blue-600 hover:bg-blue-700 px-6 py-3 rounded-lg font-bold transition">+ Adicionar câmera</Link>
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