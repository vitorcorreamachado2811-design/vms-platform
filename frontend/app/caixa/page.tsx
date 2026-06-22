'use client'
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useAuth } from '../hooks/useAuth'

const API = 'https://vms-platform-production.up.railway.app'

interface Venda {
  id: string
  peso_gramas: number | null
  valor_balanca: number
  cedula_recebida: number
  troco_calculado: number
  troco_detectado: number | null
  status: 'ok' | 'inconsistente'
  observacao: string | null
  criado_em: string
}

interface Resumo {
  total_vendas: number
  total_valor: number
  total_inconsistentes: number
  total_diferenca: number
}

interface LeituraBalanca {
  peso_gramas: number
  valor_balanca: number
  timestamp: string
}

function formatarHora(iso: string) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function formatarMoeda(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function CardVenda({ venda }: { venda: Venda }) {
  const inconsistente = venda.status === 'inconsistente'
  return (
    <div className={`rounded-xl p-4 border ${inconsistente ? 'bg-red-950 border-red-800' : 'bg-gray-800 border-gray-700'}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className={`text-xs px-2 py-1 rounded-full font-bold ${inconsistente ? 'bg-red-800 text-red-300' : 'bg-green-900 text-green-300'}`}>
            {inconsistente ? 'INCONSISTENTE' : 'OK'}
          </span>
          <span className="text-gray-400 text-xs">{formatarHora(venda.criado_em)}</span>
        </div>
        <span className="text-white font-bold">{formatarMoeda(venda.valor_balanca)}</span>
      </div>

      <div className="grid grid-cols-3 gap-3 text-center">
        <div className="bg-gray-900 rounded-lg p-2">
          <p className="text-gray-500 text-xs">Valor</p>
          <p className="text-white font-bold text-sm">{formatarMoeda(venda.valor_balanca)}</p>
          {venda.peso_gramas && (
            <p className="text-gray-600 text-xs">{venda.peso_gramas.toFixed(0)}g</p>
          )}
        </div>
        <div className="bg-gray-900 rounded-lg p-2">
          <p className="text-gray-500 text-xs">Cedula</p>
          <p className="text-green-400 font-bold text-sm">{formatarMoeda(venda.cedula_recebida)}</p>
        </div>
        <div className={`rounded-lg p-2 ${inconsistente ? 'bg-red-900' : 'bg-gray-900'}`}>
          <p className="text-gray-500 text-xs">Troco</p>
          <p className={`font-bold text-sm ${inconsistente ? 'text-red-300' : 'text-white'}`}>
            {formatarMoeda(venda.troco_calculado)}
          </p>
          {venda.troco_detectado !== null && venda.troco_detectado !== venda.troco_calculado && (
            <p className="text-red-400 text-xs">det: {formatarMoeda(venda.troco_detectado)}</p>
          )}
        </div>
      </div>

      {venda.observacao && (
        <p className="text-red-400 text-xs mt-2 font-medium">{venda.observacao}</p>
      )}
    </div>
  )
}

export default function CaixaPage() {
  const { usuario } = useAuth()
  const [vendas, setVendas] = useState<Venda[]>([])
  const [resumo, setResumo] = useState<Resumo | null>(null)
  const [leitura, setLeitura] = useState<LeituraBalanca | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [filtro, setFiltro] = useState<'todas' | 'inconsistentes'>('todas')

  const carregar = useCallback(async () => {
    if (!usuario) return
    try {
      const [rVendas, rResumo, rLeitura] = await Promise.all([
        fetch(`${API}/caixa/vendas?empresa_id=${usuario.empresa_id}&limit=50`),
        fetch(`${API}/caixa/resumo?empresa_id=${usuario.empresa_id}`),
        fetch(`${API}/caixa/leitura/${usuario.empresa_id}`).catch(() => null),
      ])
      const [dVendas, dResumo] = await Promise.all([rVendas.json(), rResumo.json()])
      setVendas(Array.isArray(dVendas) ? dVendas : [])
      setResumo(dResumo)
      if (rLeitura?.ok) {
        setLeitura(await rLeitura.json())
      }
    } catch {}
    setCarregando(false)
  }, [usuario])

  useEffect(() => { carregar() }, [carregar])

  useEffect(() => {
    if (!autoRefresh) return
    const interval = setInterval(carregar, 5000)
    return () => clearInterval(interval)
  }, [autoRefresh, carregar])

  const vendasFiltradas = filtro === 'inconsistentes'
    ? vendas.filter(v => v.status === 'inconsistente')
    : vendas

  return (
    <main className="min-h-screen bg-gray-950 text-white p-6">
      <div className="max-w-5xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-blue-400">Auditoria de Caixa</h1>
            <p className="text-gray-400 text-sm mt-1">Balanca Toledo + camera de cima</p>
          </div>
          <div className="flex gap-3 items-center">
            <button onClick={() => setAutoRefresh(v => !v)}
              className={`px-3 py-2 rounded-lg text-xs font-bold transition ${autoRefresh ? 'bg-green-800 text-green-300' : 'bg-gray-700 text-gray-400'}`}>
              {autoRefresh ? 'Auto ON' : 'Auto OFF'}
            </button>
            <Link href="/cameras" className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg text-sm font-bold transition">
              Cameras
            </Link>
            <Link href="/" className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg text-sm font-bold transition">
              Dashboard
            </Link>
          </div>
        </div>

        {/* Leitura ao vivo da balanca */}
        {leitura && (
          <div className="bg-blue-950 border border-blue-800 rounded-xl p-4 mb-6 flex items-center justify-between">
            <div>
              <p className="text-blue-300 text-xs font-bold mb-1">BALANCA AO VIVO</p>
              <p className="text-white text-2xl font-bold">{formatarMoeda(leitura.valor_balanca)}</p>
              {leitura.peso_gramas > 0 && (
                <p className="text-blue-400 text-sm">{leitura.peso_gramas.toFixed(0)}g</p>
              )}
            </div>
            <div className="text-right">
              <p className="text-blue-600 text-xs">Ultima leitura</p>
              <p className="text-blue-400 text-sm">{formatarHora(leitura.timestamp)}</p>
            </div>
          </div>
        )}

        {/* Metricas do dia */}
        {resumo && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
              <p className="text-gray-400 text-xs mb-1">Vendas hoje</p>
              <p className="text-3xl font-bold text-white">{resumo.total_vendas}</p>
            </div>
            <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
              <p className="text-gray-400 text-xs mb-1">Faturamento</p>
              <p className="text-2xl font-bold text-green-400">{formatarMoeda(resumo.total_valor)}</p>
            </div>
            <div className={`rounded-xl p-4 border ${resumo.total_inconsistentes > 0 ? 'bg-red-950 border-red-800' : 'bg-gray-800 border-gray-700'}`}>
              <p className="text-gray-400 text-xs mb-1">Inconsistencias</p>
              <p className={`text-3xl font-bold ${resumo.total_inconsistentes > 0 ? 'text-red-400' : 'text-white'}`}>
                {resumo.total_inconsistentes}
              </p>
            </div>
            <div className={`rounded-xl p-4 border ${resumo.total_diferenca > 0 ? 'bg-red-950 border-red-800' : 'bg-gray-800 border-gray-700'}`}>
              <p className="text-gray-400 text-xs mb-1">Diferenca total</p>
              <p className={`text-2xl font-bold ${resumo.total_diferenca > 0 ? 'text-red-400' : 'text-white'}`}>
                {formatarMoeda(resumo.total_diferenca)}
              </p>
            </div>
          </div>
        )}

        {/* Filtros */}
        <div className="flex gap-2 mb-4">
          <button onClick={() => setFiltro('todas')}
            className={`px-4 py-2 rounded-lg text-sm font-bold transition ${filtro === 'todas' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400'}`}>
            Todas ({vendas.length})
          </button>
          <button onClick={() => setFiltro('inconsistentes')}
            className={`px-4 py-2 rounded-lg text-sm font-bold transition ${filtro === 'inconsistentes' ? 'bg-red-700 text-white' : 'bg-gray-800 text-gray-400'}`}>
            Inconsistentes ({vendas.filter(v => v.status === 'inconsistente').length})
          </button>
        </div>

        {carregando ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : vendasFiltradas.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-gray-400 mb-2">Nenhuma venda registrada ainda.</p>
            <div className="bg-gray-800 border border-gray-700 rounded-xl p-5 text-left max-w-lg mx-auto mt-4">
              <h3 className="text-white font-bold mb-3">Como configurar</h3>
              <div className="space-y-2 text-sm text-gray-400">
                <p>1. Conecte a balanca Toledo ao PC do caixa via USB</p>
                <p>2. Execute o leitor serial:</p>
                <code className="block bg-gray-900 rounded p-2 text-xs text-green-400 my-1">
                  python toledo_reader.py --port COM3 --empresa_id {usuario?.empresa_id} --camera_id ID_CAMERA
                </code>
                <p>3. Ative o analítico <strong>Caixa</strong> no painel IA da camera acima do caixa</p>
                <p>4. As vendas aparecerao aqui automaticamente</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {vendasFiltradas.map(v => (
              <CardVenda key={v.id} venda={v} />
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
