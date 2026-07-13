'use client'
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useAuth } from '../hooks/useAuth'

const API = process.env.NEXT_PUBLIC_API_URL || 'https://vms-platform-production.up.railway.app'

interface FreezerStatus {
  camera_id: string
  nivel_percentual: number
  status: 'ok' | 'baixo' | 'critico'
  nome: string
  threshold_alerta: number
  notificacao: string
  created_at: string
}

interface FreezerConfig {
  camera_id: string
  nome: string
  threshold_alerta: number
  notificacao: string
  ativo: boolean
}

function corStatus(status: string) {
  if (status === 'critico') return { bg: 'bg-red-900', text: 'text-red-300', barra: 'bg-red-500' }
  if (status === 'baixo') return { bg: 'bg-yellow-900', text: 'text-yellow-300', barra: 'bg-yellow-400' }
  return { bg: 'bg-green-900', text: 'text-green-300', barra: 'bg-green-500' }
}

function formatarTempo(iso: string) {
  const d = new Date(iso)
  const diff = Math.floor((Date.now() - d.getTime()) / 1000)
  if (diff < 60) return `${diff}s atrás`
  if (diff < 3600) return `${Math.floor(diff / 60)}min atrás`
  return `${Math.floor(diff / 3600)}h atrás`
}

function ModalConfig({ freezer, onClose, onSalvo }: {
  freezer: FreezerStatus
  onClose: () => void
  onSalvo: () => void
}) {
  const [nome, setNome] = useState(freezer.nome)
  const [threshold, setThreshold] = useState(freezer.threshold_alerta)
  const [notificacao, setNotificacao] = useState(freezer.notificacao)
  const [salvando, setSalvando] = useState(false)

  async function salvar() {
    setSalvando(true)
    try {
      await fetch(`${API}/freezer/config/${freezer.camera_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome, threshold_alerta: threshold, notificacao }),
      })
      onSalvo()
      onClose()
    } catch {}
    setSalvando(false)
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-xl p-5 max-w-sm w-full shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-white font-bold text-lg">Configurar Freezer</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl">x</button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-gray-400 text-xs mb-1 block">Nome do freezer</label>
            <input value={nome} onChange={e => setNome(e.target.value)}
              className="w-full bg-gray-900 text-white rounded-lg px-3 py-2 text-sm border border-gray-700 focus:border-blue-500 outline-none" />
          </div>

          <div>
            <label className="text-gray-400 text-xs mb-1 block">
              Alertar quando abaixo de <span className="text-white font-bold">{threshold}%</span>
            </label>
            <input type="range" min={10} max={70} step={5} value={threshold}
              onChange={e => setThreshold(Number(e.target.value))}
              className="w-full" />
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>10%</span><span>70%</span>
            </div>
          </div>

          <div>
            <label className="text-gray-400 text-xs mb-1 block">Como notificar</label>
            <select value={notificacao} onChange={e => setNotificacao(e.target.value)}
              className="w-full bg-gray-900 text-white rounded-lg px-3 py-2 text-sm border border-gray-700 focus:border-blue-500 outline-none">
              <option value="dashboard">Somente dashboard</option>
              <option value="push">Push + dashboard</option>
              <option value="none">Apenas registrar</option>
            </select>
          </div>
        </div>

        <div className="flex gap-2 mt-5">
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

function CardFreezer({ freezer, onConfig }: { freezer: FreezerStatus; onConfig: () => void }) {
  const cor = corStatus(freezer.status)
  const nivel = freezer.nivel_percentual

  return (
    <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-white font-bold">{freezer.nome}</h3>
          <p className="text-gray-500 text-xs mt-0.5">{formatarTempo(freezer.created_at)}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs px-2 py-1 rounded-full font-bold ${cor.bg} ${cor.text}`}>
            {freezer.status === 'critico' ? 'Critico' : freezer.status === 'baixo' ? 'Baixo' : 'OK'}
          </span>
          <button onClick={onConfig}
            className="bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs px-2 py-1 rounded-lg transition">
            Config
          </button>
        </div>
      </div>

      {/* Barra de nivel */}
      <div className="mb-2">
        <div className="flex justify-between text-xs text-gray-400 mb-1">
          <span>Nivel de produto</span>
          <span className="font-bold text-white">{nivel}%</span>
        </div>
        <div className="w-full bg-gray-700 rounded-full h-4 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${cor.barra}`}
            style={{ width: `${nivel}%` }}
          />
        </div>
      </div>

      {/* Indicador visual tipo freezer */}
      <div className="mt-3 bg-gray-900 rounded-lg p-3 relative overflow-hidden" style={{ height: 60 }}>
        <div className="absolute inset-0 flex items-end">
          <div
            className={`w-full transition-all duration-500 rounded-b-lg opacity-40 ${cor.barra}`}
            style={{ height: `${nivel}%` }}
          />
        </div>
        <div className="relative flex items-center justify-center h-full">
          <span className="text-2xl">🧊</span>
          {freezer.status === 'critico' && (
            <span className="ml-2 text-red-400 text-xs font-bold animate-pulse">REABASTECER!</span>
          )}
          {freezer.status === 'baixo' && (
            <span className="ml-2 text-yellow-400 text-xs font-bold">Estoque baixo</span>
          )}
        </div>
      </div>

      <p className="text-gray-600 text-xs mt-2">
        Alerta configurado: abaixo de {freezer.threshold_alerta}%
      </p>
    </div>
  )
}

export default function FreezersPage() {
  const { usuario } = useAuth()
  const [freezers, setFreezers] = useState<FreezerStatus[]>([])
  const [carregando, setCarregando] = useState(true)
  const [configAberto, setConfigAberto] = useState<FreezerStatus | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(true)

  const carregar = useCallback(async () => {
    if (!usuario) return
    try {
      const res = await fetch(`${API}/freezer/status?empresa_id=${usuario.empresa_id}`)
      const data = await res.json()
      setFreezers(Array.isArray(data) ? data : [])
    } catch {}
    setCarregando(false)
  }, [usuario])

  useEffect(() => { carregar() }, [carregar])

  useEffect(() => {
    if (!autoRefresh) return
    const interval = setInterval(carregar, 30000)
    return () => clearInterval(interval)
  }, [autoRefresh, carregar])

  const criticos = freezers.filter(f => f.status === 'critico').length
  const baixos = freezers.filter(f => f.status === 'baixo').length
  const oks = freezers.filter(f => f.status === 'ok').length

  return (
    <main className="min-h-screen bg-gray-950 text-white p-6">
      <div className="max-w-6xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-blue-400">Freezers</h1>
            <p className="text-gray-400 text-sm mt-1">Monitoramento de nivel de produto</p>
          </div>
          <div className="flex gap-3 items-center">
            <button onClick={() => setAutoRefresh(v => !v)}
              className={`px-3 py-2 rounded-lg text-xs font-bold transition ${autoRefresh ? 'bg-green-800 text-green-300' : 'bg-gray-700 text-gray-400'}`}>
              {autoRefresh ? 'Auto ON' : 'Auto OFF'}
            </button>
            <button onClick={carregar}
              className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg text-sm font-bold transition">
              Atualizar
            </button>
            <Link href="/cameras" className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg text-sm font-bold transition">
              Cameras
            </Link>
            <Link href="/" className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg text-sm font-bold transition">
              Dashboard
            </Link>
          </div>
        </div>

        {/* Resumo */}
        {freezers.length > 0 && (
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="bg-green-900/30 border border-green-800 rounded-xl p-4 text-center">
              <p className="text-3xl font-bold text-green-400">{oks}</p>
              <p className="text-green-600 text-sm mt-1">OK</p>
            </div>
            <div className="bg-yellow-900/30 border border-yellow-800 rounded-xl p-4 text-center">
              <p className="text-3xl font-bold text-yellow-400">{baixos}</p>
              <p className="text-yellow-600 text-sm mt-1">Baixo</p>
            </div>
            <div className="bg-red-900/30 border border-red-800 rounded-xl p-4 text-center">
              <p className="text-3xl font-bold text-red-400">{criticos}</p>
              <p className="text-red-600 text-sm mt-1">Critico</p>
            </div>
          </div>
        )}

        {carregando ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : freezers.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-gray-400 mb-2">Nenhum freezer monitorado ainda.</p>
            <p className="text-gray-600 text-sm">Ative o analítico "Freezer" no painel IA de cada câmera.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {freezers.map(f => (
              <CardFreezer key={f.camera_id} freezer={f} onConfig={() => setConfigAberto(f)} />
            ))}
          </div>
        )}
      </div>

      {configAberto && (
        <ModalConfig
          freezer={configAberto}
          onClose={() => setConfigAberto(null)}
          onSalvo={carregar}
        />
      )}
    </main>
  )
}
