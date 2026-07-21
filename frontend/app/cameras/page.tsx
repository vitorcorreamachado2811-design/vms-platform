'use client'
import { useEffect, useRef, useState, useCallback } from 'react'
import { WebRTCPlayer } from '../../components/WebRTCPlayer'
import { DashboardAoVivo } from '../../components/DashboardAoVivo'
import Link from 'next/link'
import { useAuth } from '../hooks/useAuth'

const API = process.env.NEXT_PUBLIC_API_URL || 'https://vms-platform-production.up.railway.app'
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
  freezer: boolean
  caixa: boolean
  copos: boolean
  acompanhamento: boolean
}

interface Regiao {
  id: string
  camera_id: string
  tipo: string
  x1: number
  y1: number
  x2: number
  y2: number
  tempo_alerta_min: number
}

const ANALITICOS_DEFAULT: Analiticos = {
  queda_leito: false, queda_pe: false, pessoa: false,
  banheiro_tempo: false, gesto_socorro: false,
  linha_contagem: false, habitos: false,
  freezer: false, caixa: false, copos: false, acompanhamento: false,
}

const TIPOS_REGIAO = [
  { key: 'entrada',   label: 'Entrada/Saida', color: '#3b82f6' },
  { key: 'freezer',   label: 'Freezer',       color: '#06b6d4' },
  { key: 'caixa',     label: 'Caixa',         color: '#f59e0b' },
  { key: 'copos',     label: 'Copos/Potes',   color: '#eab308' },
  { key: 'cama',      label: 'Cama',          color: '#8b5cf6' },
  { key: 'banheiro',  label: 'Banheiro',      color: '#ec4899' },
  { key: 'cozinha',   label: 'Cozinha',       color: '#10b981' },
  { key: 'quarto',    label: 'Quarto',        color: '#f97316' },
  { key: 'acompanhamento', label: 'Acompanhamento', color: '#f43f5e' },
]

function mjpegUrl(cameraId: string) {
  return `${API}/cameras/${cameraId}/mjpeg`
}

// Tipos de regiao desenhados como LINHA (cruzamento lado A -> lado B),
// em vez de retangulo (area/presenca). "entrada" e a linha de contagem
// (entrada/saida) e vive numa tabela separada (/contagem), nao em /regioes -
// ver o tratamento especial em onMouseUp/deletarRegiao/useEffect abaixo.
const TIPOS_LINHA: string[] = ['entrada']
function ehLinha(tipo: string) {
  return TIPOS_LINHA.includes(tipo)
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

async function salvarAnaliticos(cameraId: string, analiticos: Analiticos): Promise<boolean> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/camera_analiticos`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify({ camera_id: cameraId, ...analiticos }),
    })
    if (!res.ok) {
      const texto = await res.text().catch(() => '')
      console.error('Erro ao salvar analiticos:', res.status, texto)
      return false
    }
    return true
  } catch (e) {
    console.error('Erro ao salvar analiticos:', e)
    return false
  }
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

// ─── MODAL EDITAR CAMERA ────────────────────────────────────────────────────
function ModalEditar({ camera, onClose, onSalvo }: {
  camera: Camera
  onClose: () => void
  onSalvo: (c: Camera) => void
}) {
  const [nome, setNome] = useState(camera.nome)
  const [rtsp, setRtsp] = useState(camera.rtsp_url)
  const [httpUrl, setHttpUrl] = useState(camera.http_url || '')
  const [ativo, setAtivo] = useState(camera.ativo)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  async function salvar() {
    setSalvando(true)
    setErro('')
    try {
      const res = await fetch(`${API}/cameras/${camera.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome, rtsp_url: rtsp, http_url: httpUrl || null, ativo }),
      })
      if (!res.ok) throw new Error('Erro ao salvar')
      const data = await res.json()
      onSalvo(data)
      onClose()
    } catch (e: any) {
      setErro(e.message || 'Erro desconhecido')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-xl p-5 max-w-sm w-full shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-white font-bold text-lg">Editar Camera</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl">x</button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-gray-400 text-xs mb-1 block">Nome</label>
            <input value={nome} onChange={e => setNome(e.target.value)}
              className="w-full bg-gray-900 text-white rounded-lg px-3 py-2 text-sm border border-gray-700 focus:border-blue-500 outline-none" />
          </div>
          <div>
            <label className="text-gray-400 text-xs mb-1 block">URL RTSP</label>
            <input value={rtsp} onChange={e => setRtsp(e.target.value)}
              className="w-full bg-gray-900 text-white rounded-lg px-3 py-2 text-sm border border-gray-700 focus:border-blue-500 outline-none font-mono" />
          </div>
          <div>
            <label className="text-gray-400 text-xs mb-1 block">URL HTTP (snapshot, opcional)</label>
            <input value={httpUrl} onChange={e => setHttpUrl(e.target.value)}
              className="w-full bg-gray-900 text-white rounded-lg px-3 py-2 text-sm border border-gray-700 focus:border-blue-500 outline-none font-mono" />
          </div>
          <div className="flex items-center justify-between bg-gray-900 rounded-lg px-3 py-2">
            <span className="text-gray-300 text-sm">Camera ativa</span>
            <button onClick={() => setAtivo(v => !v)}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${ativo ? 'bg-green-600' : 'bg-gray-600'}`}>
              <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${ativo ? 'translate-x-5' : 'translate-x-1'}`} />
            </button>
          </div>
        </div>

        {erro && <p className="text-red-400 text-xs mt-2">{erro}</p>}

        <div className="flex gap-2 mt-4">
          <button onClick={onClose}
            className="flex-1 bg-gray-700 hover:bg-gray-600 text-white text-sm font-bold py-2 rounded-lg transition">
            Cancelar
          </button>
          <button onClick={salvar} disabled={salvando}
            className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-bold py-2 rounded-lg transition">
            {salvando ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── MODAL REGIOES ───────────────────────────────────────────────────────────
function ModalRegioes({ camera, onClose }: { camera: Camera; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const [regioes, setRegioes] = useState<Regiao[]>([])
  const [tipoSelecionado, setTipoSelecionado] = useState('cama')
  const [desenhando, setDesenhando] = useState(false)
  const [inicio, setInicio] = useState<{ x: number; y: number } | null>(null)
  const [atual, setAtual] = useState<{ x: number; y: number } | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [imgCarregada, setImgCarregada] = useState(false)

  const snapshotUrl = `${API}/cameras/${camera.id}/snapshot`

  useEffect(() => {
    fetch(`${API}/regioes/${camera.id}`)
      .then(r => r.json())
      .then(data => setRegioes(Array.isArray(data) ? data : []))
      .catch(() => {})

    // Linha de entrada/saida vive em /contagem, tabela separada de /regioes
    fetch(`${API}/contagem/${camera.id}`)
      .then(r => r.ok ? r.json() : null)
      .then(linha => {
        if (!linha) return
        setRegioes(prev => [...prev.filter(r => r.tipo !== 'entrada'), {
          id: linha.id, camera_id: camera.id, tipo: 'entrada',
          x1: linha.x1, y1: linha.y1, x2: linha.x2, y2: linha.y2,
          tempo_alerta_min: 0,
        }])
      })
      .catch(() => {})

    // Usa frame ao vivo em vez de snapshot — mais rapido e confiavel
    const img = new Image()
    img.crossOrigin = 'anonymous'
    // Tenta frame ao vivo primeiro, fallback para snapshot
    const liveUrl = `${API}/cameras/${camera.id}/frame`
    img.src = liveUrl
    img.onload = () => { imgRef.current = img; setImgCarregada(true) }
    img.onerror = () => {
      // Fallback para snapshot
      const snap = new Image()
      snap.crossOrigin = 'anonymous'
      snap.src = `${API}/cameras/${camera.id}/snapshot`
      snap.onload = () => { imgRef.current = snap; setImgCarregada(true) }
      snap.onerror = () => setImgCarregada(true)
    }
  }, [camera.id])

  useEffect(() => {
    desenharCanvas()
  }, [regioes, atual, inicio, imgCarregada])

  function desenharCanvas() {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, canvas.width, canvas.height)

    if (imgRef.current) {
      ctx.drawImage(imgRef.current, 0, 0, canvas.width, canvas.height)
    } else {
      ctx.fillStyle = '#111'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
    }

    // Desenha regioes salvas
    regioes.forEach(r => {
      const tipo = TIPOS_REGIAO.find(t => t.key === r.tipo)
      const color = tipo?.color || '#fff'

      if (ehLinha(r.tipo)) {
        const xa = r.x1 * canvas.width, ya = r.y1 * canvas.height
        const xb = r.x2 * canvas.width, yb = r.y2 * canvas.height
        ctx.strokeStyle = color
        ctx.lineWidth = 3
        ctx.setLineDash([])
        ctx.beginPath()
        ctx.moveTo(xa, ya)
        ctx.lineTo(xb, yb)
        ctx.stroke()

        const pontos: { label: string; px: number; py: number }[] = [
          { label: 'A', px: xa, py: ya },
          { label: 'B', px: xb, py: yb },
        ]
        pontos.forEach(p => {
          ctx.beginPath()
          ctx.arc(p.px, p.py, 6, 0, Math.PI * 2)
          ctx.fillStyle = color
          ctx.fill()
          ctx.fillStyle = '#fff'
          ctx.font = 'bold 11px sans-serif'
          ctx.fillText(p.label, p.px - 3, p.py - 10)
        })

        ctx.fillStyle = color
        ctx.font = 'bold 12px sans-serif'
        ctx.fillText(tipo?.label || r.tipo, Math.min(xa, xb) + 4, Math.min(ya, yb) - 6)
        return
      }

      const x = r.x1 * canvas.width
      const y = r.y1 * canvas.height
      const w = (r.x2 - r.x1) * canvas.width
      const h = (r.y2 - r.y1) * canvas.height

      ctx.strokeStyle = color
      ctx.lineWidth = 2
      ctx.setLineDash([])
      ctx.strokeRect(x, y, w, h)

      ctx.fillStyle = color + '33'
      ctx.fillRect(x, y, w, h)

      ctx.fillStyle = color
      ctx.font = 'bold 12px sans-serif'
      ctx.fillText(tipo?.label || r.tipo, x + 6, y + 16)
    })

    // Desenha o retangulo OU a linha sendo desenhado(a) agora
    if (desenhando && inicio && atual) {
      const tipo = TIPOS_REGIAO.find(t => t.key === tipoSelecionado)
      const color = tipo?.color || '#fff'

      if (ehLinha(tipoSelecionado)) {
        ctx.strokeStyle = color
        ctx.lineWidth = 3
        ctx.setLineDash([6, 3])
        ctx.beginPath()
        ctx.moveTo(inicio.x, inicio.y)
        ctx.lineTo(atual.x, atual.y)
        ctx.stroke()
        return
      }

      const x = Math.min(inicio.x, atual.x)
      const y = Math.min(inicio.y, atual.y)
      const w = Math.abs(atual.x - inicio.x)
      const h = Math.abs(atual.y - inicio.y)

      ctx.strokeStyle = color
      ctx.lineWidth = 2
      ctx.setLineDash([6, 3])
      ctx.strokeRect(x, y, w, h)
      ctx.fillStyle = color + '22'
      ctx.fillRect(x, y, w, h)
    }
  }

  function getPosCanvas(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    }
  }

  function onMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    const pos = getPosCanvas(e)
    setInicio(pos)
    setAtual(pos)
    setDesenhando(true)
  }

  function onMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!desenhando) return
    setAtual(getPosCanvas(e))
  }

  async function onMouseUp(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!desenhando || !inicio) return
    setDesenhando(false)

    const canvas = canvasRef.current!
    const pos = getPosCanvas(e)

    let x1: number, y1: number, x2: number, y2: number

    if (ehLinha(tipoSelecionado)) {
      // Linha: preserva a direcao exata do arrasto (ponto A -> ponto B),
      // pois o lado do cruzamento importa para a contagem.
      x1 = inicio.x / canvas.width
      y1 = inicio.y / canvas.height
      x2 = pos.x / canvas.width
      y2 = pos.y / canvas.height
      const comprimento = Math.hypot(x2 - x1, y2 - y1)
      if (comprimento < 0.04) return  // linha muito curta
    } else {
      x1 = Math.min(inicio.x, pos.x) / canvas.width
      y1 = Math.min(inicio.y, pos.y) / canvas.height
      x2 = Math.max(inicio.x, pos.x) / canvas.width
      y2 = Math.max(inicio.y, pos.y) / canvas.height
      if (x2 - x1 < 0.02 || y2 - y1 < 0.02) return  // retangulo muito pequeno
    }

    setSalvando(true)
    try {
      if (tipoSelecionado === 'entrada') {
        // Linha de contagem: tabela/endpoint separado de /regioes.
        const res = await fetch(`${API}/contagem/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ camera_id: camera.id, x1, y1, x2, y2 }),
        })
        const linha = await res.json()
        setRegioes(prev => [...prev.filter(r => r.tipo !== 'entrada'), {
          id: linha.id, camera_id: camera.id, tipo: 'entrada',
          x1: linha.x1, y1: linha.y1, x2: linha.x2, y2: linha.y2,
          tempo_alerta_min: 0,
        }])
      } else {
        const res = await fetch(`${API}/regioes/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ camera_id: camera.id, tipo: tipoSelecionado, x1, y1, x2, y2 }),
        })
        const nova = await res.json()
        setRegioes(prev => [...prev.filter(r => r.tipo !== tipoSelecionado), nova])
      }
    } catch {}
    setSalvando(false)
    setInicio(null)
    setAtual(null)
  }

  async function deletarRegiao(tipo: string) {
    try {
      if (tipo === 'entrada') {
        await fetch(`${API}/contagem/${camera.id}`, { method: 'DELETE' })
      } else {
        await fetch(`${API}/regioes/${camera.id}/${tipo}`, { method: 'DELETE' })
      }
      setRegioes(prev => prev.filter(r => r.tipo !== tipo))
    } catch {}
  }

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-xl shadow-2xl w-full max-w-2xl flex flex-col gap-4 p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-white font-bold text-lg">Regioes Monitoradas</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl">x</button>
        </div>

        <p className="text-gray-400 text-xs">
          {ehLinha(tipoSelecionado)
            ? 'Selecione o tipo e desenhe uma LINHA na imagem (clique no ponto A e arraste ate o ponto B).'
            : 'Selecione um tipo e desenhe o retangulo na imagem.'}
        </p>

        {/* Seletor de tipo */}
        <div className="flex gap-2 flex-wrap">
          {TIPOS_REGIAO.map(t => (
            <button key={t.key} onClick={() => setTipoSelecionado(t.key)}
              style={{ borderColor: t.color, color: tipoSelecionado === t.key ? '#fff' : t.color,
                background: tipoSelecionado === t.key ? t.color : 'transparent' }}
              className="px-3 py-1 rounded-lg text-sm font-bold border-2 transition">
              {t.label}
            </button>
          ))}
        </div>

        {/* Canvas */}
        <div className="relative rounded-lg overflow-hidden bg-black" style={{ aspectRatio: '16/9' }}>
          <canvas
            ref={canvasRef}
            width={640}
            height={360}
            className="w-full h-full cursor-crosshair"
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
          />
          {salvando && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/40">
              <span className="text-white text-sm">Salvando...</span>
            </div>
          )}
        </div>

        {/* Lista de regioes salvas */}
        {regioes.length > 0 && (
          <div className="space-y-1">
            <p className="text-gray-400 text-xs mb-1">Regioes salvas:</p>
            {regioes.map(r => {
              const tipo = TIPOS_REGIAO.find(t => t.key === r.tipo)
              return (
                <div key={r.id} className="flex items-center justify-between bg-gray-900 rounded-lg px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span style={{ background: tipo?.color }} className="w-3 h-3 rounded-sm inline-block" />
                    <span className="text-gray-300 text-sm">{tipo?.label || r.tipo}</span>
                  </div>
                  <button onClick={() => deletarRegiao(r.tipo)}
                    className="text-red-400 hover:text-red-300 text-xs font-bold px-2 py-1 rounded">
                    Remover
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── PAINEL ANALITICOS ───────────────────────────────────────────────────────
function PainelAnaliticos({ cameraId, onClose }: { cameraId: string; onClose: () => void }) {
  const [analiticos, setAnaliticos] = useState<Analiticos>(ANALITICOS_DEFAULT)
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    carregarAnaliticos(cameraId).then(setAnaliticos)
  }, [cameraId])

  const [erro, setErro] = useState<string | null>(null)

  async function toggle(key: keyof Analiticos) {
    const anterior = analiticos
    const novo = { ...analiticos, [key]: !analiticos[key] }
    setAnaliticos(novo)
    setSalvando(true)
    setErro(null)
    const ok = await salvarAnaliticos(cameraId, novo)
    if (!ok) {
      setAnaliticos(anterior)
      setErro('Nao foi possivel salvar. Veja o console (F12) para detalhes.')
    }
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
    { key: 'freezer', label: 'Nivel do Freezer' },
    { key: 'caixa', label: 'Monitorar Caixa' },
    { key: 'copos', label: 'Contagem de Copos/Potes' },
    { key: 'acompanhamento', label: 'Balcao de Acompanhamentos' },
  ]

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-xl p-5 max-w-xs w-full shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-white font-bold text-lg">Analiticos IA</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl">x</button>
        </div>
        {salvando && <p className="text-blue-400 text-xs mb-2">Salvando...</p>}
        {erro && <p className="text-red-400 text-xs mb-2">{erro}</p>}
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

// ─── MJPEG PLAYER ───────────────────────────────────────────────────────────
function MjpegPlayer({ camera, onClose }: { camera: Camera; onClose: () => void }) {
  const imgRef = useRef<HTMLImageElement>(null)
  const [status, setStatus] = useState<'connecting' | 'live' | 'error'>('connecting')
  const reconnectRef = useRef<NodeJS.Timeout | null>(null)

  const url = mjpegUrl(camera.id)

  function conectar() {
    if (!imgRef.current) return
    setStatus('connecting')
    imgRef.current.src = `${url}?t=${Date.now()}`
  }

  useEffect(() => {
    conectar()
    return () => {
      if (imgRef.current) imgRef.current.src = ''
      if (reconnectRef.current) clearTimeout(reconnectRef.current)
    }
  }, [camera.id])

  function handleLoad() {
    setStatus('live')
    if (reconnectRef.current) clearTimeout(reconnectRef.current)
  }

  function handleError() {
    setStatus('error')
    reconnectRef.current = setTimeout(() => conectar(), 3000)
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.95)',
      zIndex: 9999, display: 'flex', flexDirection: 'column',
    }}>
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
          <span style={{ color: '#fff', fontWeight: 600, fontSize: 15 }}>{camera.nome}</span>
          {status === 'live' && (
            <span style={{
              background: '#dc2626', color: '#fff', fontSize: 10,
              fontWeight: 700, padding: '2px 7px', borderRadius: 4, letterSpacing: 1,
            }}>AO VIVO</span>
          )}
          {status === 'connecting' && (
            <span style={{ color: '#9ca3af', fontSize: 12 }}>Conectando...</span>
          )}
          {status === 'error' && (
            <span style={{ color: '#fca5a5', fontSize: 12 }}>Reconectando em 3s...</span>
          )}
        </div>
        <button onClick={onClose}
          style={{
            background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff',
            fontSize: 20, width: 36, height: 36, borderRadius: 8,
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
          x
        </button>
      </div>

      <div style={{ flex: 1, position: 'relative', background: '#000' }}>
        <img ref={imgRef} onLoad={handleLoad} onError={handleError} alt={camera.nome}
          style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
        {status !== 'live' && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.55)', gap: 14,
          }}>
            {status === 'connecting' ? (
              <>
                <div style={{
                  width: 40, height: 40, border: '3px solid rgba(255,255,255,0.15)',
                  borderTopColor: '#fff', borderRadius: '50%',
                  animation: 'spin 0.8s linear infinite',
                }} />
                <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
                <span style={{ color: '#9ca3af', fontSize: 14 }}>Aguardando stream...</span>
              </>
            ) : (
              <span style={{ color: '#fca5a5', fontSize: 14 }}>Sem sinal - reconectando...</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── CAMERA PLAYER CARD ──────────────────────────────────────────────────────
function CameraPlayer({ camera, cameraAoVivoId, setCameraAoVivoId, onCameraAtualizada, podeEditar }: {
  camera: Camera
  cameraAoVivoId: string | null
  setCameraAoVivoId: (id: string | null) => void
  onCameraAtualizada: (c: Camera) => void
  podeEditar?: boolean
}) {
  const aoVivo = cameraAoVivoId === camera.id
  const [showAnaliticos, setShowAnaliticos] = useState(false)
  const [showRegioes, setShowRegioes] = useState(false)
  const [showEditar, setShowEditar] = useState(false)

  const snapshotUrl = `${API}/cameras/${camera.id}/snapshot`

  return (
    <>
      {showAnaliticos && (
        <PainelAnaliticos cameraId={camera.id} onClose={() => setShowAnaliticos(false)} />
      )}
      {showRegioes && (
        <ModalRegioes camera={camera} onClose={() => setShowRegioes(false)} />
      )}
      {showEditar && (
        <ModalEditar camera={camera} onClose={() => setShowEditar(false)} onSalvo={onCameraAtualizada} />
      )}
      {aoVivo && (
        <WebRTCPlayer cameraId={camera.id} cameraName={camera.nome} onClose={() => setCameraAoVivoId(null)} />
      )}

      <div className="bg-gray-800 rounded-xl overflow-hidden shadow-lg">
        <div className="relative aspect-video bg-black">
          <img src={snapshotUrl} alt={camera.nome}
            className="w-full h-full object-cover opacity-60"
            onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
          <button onClick={() => setCameraAoVivoId(camera.id)}
            className="absolute inset-0 flex items-center justify-center bg-black/30 hover:bg-black/40 transition">
            <div className="w-14 h-14 bg-blue-600 rounded-full flex items-center justify-center shadow-lg">
              <span className="text-white text-2xl ml-1">&#9654;</span>
            </div>
          </button>
        </div>

        <div className="p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-white font-bold">{camera.nome}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${camera.ativo ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'}`}>
              {camera.ativo ? 'Ativa' : 'Inativa'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setCameraAoVivoId(camera.id)}
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold py-1.5 rounded-lg transition flex items-center justify-center gap-1">
              <span>&#9654;</span> Ao Vivo
            </button>
            <BtnIcon onClick={() => setShowRegioes(true)} title="Regioes monitoradas"
              className="bg-gray-700 hover:bg-emerald-700 text-emerald-300">
              [R]
            </BtnIcon>
            {podeEditar && <BtnIcon onClick={() => setShowEditar(true)} title="Editar camera"
              className="bg-gray-700 hover:bg-yellow-700 text-yellow-300">
              [E]</BtnIcon>}
            <BtnIcon onClick={() => setShowAnaliticos(true)} title="Analiticos IA"
              className="bg-gray-700 hover:bg-gray-600 text-purple-300">
              IA
            </BtnIcon>
          </div>
        </div>
      </div>
    </>
  )
}

// ─── PAGE ────────────────────────────────────────────────────────────────────
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

  function onCameraAtualizada(atualizada: Camera) {
    setCameras(prev => prev.map(c => c.id === atualizada.id ? atualizada : c))
  }

  return (
    <main className="min-h-screen bg-gray-950 text-white p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-blue-400">Cameras ao Vivo</h1>
            <p className="text-gray-400 text-sm mt-1">{cameras.length} cameras cadastradas</p>
          </div>
          <div className="flex gap-3">
            <Link href="/relatorio" className="bg-green-700 hover:bg-green-600 px-4 py-2 rounded-lg font-bold text-sm transition">
              Relatório
            </Link>
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
          <div className="flex flex-col gap-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {cameras.map(camera => (
              <CameraPlayer
                key={camera.id}
                camera={camera}
                cameraAoVivoId={cameraAoVivoId}
                setCameraAoVivoId={setCameraAoVivoId}
                onCameraAtualizada={onCameraAtualizada}
                podeEditar={true}
              />
            ))}
            </div>
          </div>
        )}
      </div>
    </main>
  )
}



