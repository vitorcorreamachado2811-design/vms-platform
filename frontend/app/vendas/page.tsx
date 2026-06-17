'use client'
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useAuth } from '../hooks/useAuth'

const API = 'https://vms-platform-production.up.railway.app'

interface Venda {
  id: string
  camera_id: string
  empresa_id: string
  quantidade: number
  tipos: string[]
  created_at: string
}

interface Resumo {
  hora: string
  total_vendas: number
  total_embalagens: number
  media_embalagens: number
}

interface Totais {
  total_vendas: number
  total_embalagens: number
  media_embalagens: number
  ultima_venda: string | null
}

function formatarHora(iso: string) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

function formatarDataHora(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  })
}

function CardMetrica({ label, valor, sub }: { label: string; valor: string | number; sub?: string }) {
  return (
    <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
      <p className="text-gray-400 text-sm mb-1">{label}</p>
      <p className="text-white text-3xl font-bold">{valor}</p>
      {sub && <p className="text-gray-500 text-xs mt-1">{sub}</p>}
    </div>
  )
}

function BarraHora({ resumo }: { resumo: Resumo }) {
  const hora = new Date(resumo.hora).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  const max = 20 // referencia visual
  const pct = Math.min((resumo.total_embalagens / max) * 100, 100)

  return (
    <div className="flex items-center gap-3">
      <span className="text-gray-400 text-xs w-12 text-right">{hora}</span>
      <div className="flex-1 bg-gray-700 rounded-full h-6 overflow-hidden">
        <div
          className="h-full bg-blue-600 rounded-full flex items-center px-2 transition-all"
          style={{ width: `${Math.max(pct, 4)}%` }}
        >
          <span className="text-white text-xs font-bold">{resumo.total_embalagens}</span>
        </div>
      </div>
      <span className="text-gray-500 text-xs w-16">{resumo.total_vendas} vendas</span>
    </div>
  )
}

export default function VendasPage() {
  const { usuario } = useAuth()
  const [vendas, setVendas] = useState<Venda[]>([])
  const [resumo, setResumo] = useState<Resumo[]>([])
  const [totais, setTotais] = useState<Totais | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [autoRefresh, setAutoRefresh] = useState(true)

  const carregar = useCallback(async () => {
    if (!usuario) return
    try {
      const [rVendas, rResumo, rTotais] = await Promise.all([
        fetch(`${API}/vendas/?empresa_id=${usuario.empresa_id}&limit=50`),
        fetch(`${API}/vendas/resumo?empresa_id=${usuario.empresa_id}`),
        fetch(`${API}/vendas/hoje?empresa_id=${usuario.empresa_id}`),
      ])
      const [dVendas, dResumo, dTotais] = await Promise.all([
        rVendas.json(), rResumo.json(), rTotais.json(),
      ])
      setVendas(Array.isArray(dVendas) ? dVendas : [])
      setResumo(Array.isArray(dResumo) ? dResumo : [])
      setTotais(dTotais)
    } catch {}
    setCarregando(false)
  }, [usuario])

  useEffect(() => {
    carregar()
  }, [carregar])

  useEffect(() => {
    if (!autoRefresh) return
    const interval = setInterval(carregar, 10000) // atualiza a cada 10s
    return () => clearInterval(interval)
  }, [autoRefresh, carregar])

  return (
    <main className="min-h-screen bg-gray-950 text-white p-6">
      <div className="max-w-6xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-blue-400">Vendas por Embalagem</h1>
            <p className="text-gray-400 text-sm mt-1">Deteccao automatica via camera da balanca</p>
          </div>
          <div className="flex gap-3 items-center">
            <button
              onClick={() => setAutoRefresh(v => !v)}
              className={`px-3 py-2 rounded-lg text-xs font-bold transition ${autoRefresh ? 'bg-green-800 text-green-300' : 'bg-gray-700 text-gray-400'}`}
            >
              {autoRefresh ? 'Auto ON' : 'Auto OFF'}
            </button>
            <button onClick={carregar} className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg text-sm font-bold transition">
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

        {carregando ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {/* Metricas do dia */}
            {totais && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                <CardMetrica label="Vendas Hoje" valor={totais.total_vendas} />
                <CardMetrica label="Embalagens Hoje" valor={totais.total_embalagens} />
                <CardMetrica
                  label="Media por Venda"
                  valor={totais.media_embalagens.toFixed(1)}
                  sub="embalagens"
                />
                <CardMetrica
                  label="Ultima Venda"
                  valor={totais.ultima_venda ? formatarHora(totais.ultima_venda) : '--'}
                  sub={totais.ultima_venda ? formatarDataHora(totais.ultima_venda) : 'Nenhuma ainda'}
                />
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

              {/* Grafico por hora */}
              <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
                <h2 className="text-white font-bold mb-4">Embalagens por Hora (24h)</h2>
                {resumo.length === 0 ? (
                  <p className="text-gray-500 text-sm">Nenhum dado ainda.</p>
                ) : (
                  <div className="space-y-2">
                    {resumo.slice(0, 12).map((r, i) => (
                      <BarraHora key={i} resumo={r} />
                    ))}
                  </div>
                )}
              </div>

              {/* Ultimas vendas */}
              <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
                <h2 className="text-white font-bold mb-4">Ultimas Vendas Detectadas</h2>
                {vendas.length === 0 ? (
                  <p className="text-gray-500 text-sm">Nenhuma venda detectada ainda.</p>
                ) : (
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {vendas.map(v => (
                      <div key={v.id} className="flex items-center justify-between bg-gray-900 rounded-lg px-3 py-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-white font-bold text-sm">
                              {v.quantidade} embalagem{v.quantidade > 1 ? 'ns' : ''}
                            </span>
                            {v.tipos.map(t => (
                              <span key={t} className="bg-blue-900 text-blue-300 text-xs px-2 py-0.5 rounded-full">
                                {t}
                              </span>
                            ))}
                          </div>
                          <p className="text-gray-500 text-xs mt-0.5">{formatarDataHora(v.created_at)}</p>
                        </div>
                        <span className="text-2xl">🍦</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  )
}
