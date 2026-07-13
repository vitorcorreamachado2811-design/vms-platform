'use client'
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useAuth } from '../hooks/useAuth'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts'

const API = process.env.NEXT_PUBLIC_API_URL || 'https://vms-platform-production.up.railway.app'

interface PorCamera {
  camera: string
  total: number
}

interface PorHora {
  hora: string
  total: number
}

interface Relatorio {
  total_geral: number
  periodo_dias: number
  por_camera: PorCamera[]
  por_hora: PorHora[]
}

const PERIODOS = [
  { label: 'Hoje', dias: 1 },
  { label: '7 dias', dias: 7 },
  { label: '30 dias', dias: 30 },
]

export default function ColposRelatorioPage() {
  const { usuario, carregando: authCarregando, logout } = useAuth()
  const [relatorio, setRelatorio] = useState<Relatorio | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [dias, setDias] = useState(1)
  const [autoRefresh, setAutoRefresh] = useState(true)

  const carregar = useCallback(async () => {
    if (!usuario) return
    try {
      const res = await fetch(`${API}/eventos/relatorio-copos?empresa_id=${usuario.empresa_id}&dias=${dias}`)
      const data = await res.json()
      setRelatorio(data)
    } catch {
      setRelatorio(null)
    }
    setCarregando(false)
  }, [usuario, dias])

  useEffect(() => { carregar() }, [carregar])

  useEffect(() => {
    if (!autoRefresh) return
    const interval = setInterval(carregar, 30000)
    return () => clearInterval(interval)
  }, [autoRefresh, carregar])

  if (authCarregando) {
    return (
      <main className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </main>
    )
  }

  const cameraComMaisContagem = relatorio?.por_camera?.[0]
  const horaComMaisMovimento = relatorio?.por_hora?.reduce(
    (max, item) => (item.total > max.total ? item : max),
    { hora: '-', total: 0 }
  )

  return (
    <main className="min-h-screen bg-gray-950 text-white p-6">
      <div className="max-w-6xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-yellow-400">🥤 Copos e Potes</h1>
            <p className="text-gray-400 text-sm mt-1">Relatorio de contagem pela IA</p>
          </div>
          <div className="flex gap-3 items-center flex-wrap">
            <div className="flex bg-gray-800 rounded-lg p-1">
              {PERIODOS.map(p => (
                <button
                  key={p.dias}
                  onClick={() => setDias(p.dias)}
                  className={`px-3 py-1.5 rounded-md text-xs font-bold transition ${
                    dias === p.dias ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
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

        {carregando ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : !relatorio || relatorio.total_geral === 0 ? (
          <div className="text-center py-20">
            <p className="text-gray-400 mb-2">Nenhum copo ou pote contado ainda no periodo.</p>
            <p className="text-gray-600 text-sm">
              Ative o analitico &quot;Contagem de Copos/Potes&quot; e desenhe a regiao &quot;Copos/Potes&quot; na camera desejada.
            </p>
          </div>
        ) : (
          <>
            {/* Resumo */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <div className="bg-gray-900 rounded-xl p-5 border border-gray-800">
                <p className="text-gray-400 text-sm">Total contado</p>
                <p className="text-3xl font-bold text-yellow-400 mt-1">{relatorio.total_geral}</p>
              </div>
              <div className="bg-gray-900 rounded-xl p-5 border border-gray-800">
                <p className="text-gray-400 text-sm">Camera com mais movimento</p>
                <p className="text-xl font-bold text-blue-400 mt-1">
                  {cameraComMaisContagem ? cameraComMaisContagem.camera : '-'}
                </p>
                {cameraComMaisContagem && (
                  <p className="text-gray-500 text-xs mt-1">{cameraComMaisContagem.total} contados</p>
                )}
              </div>
              <div className="bg-gray-900 rounded-xl p-5 border border-gray-800">
                <p className="text-gray-400 text-sm">Horario de pico</p>
                <p className="text-xl font-bold text-purple-400 mt-1">
                  {horaComMaisMovimento && horaComMaisMovimento.total > 0 ? horaComMaisMovimento.hora : '-'}
                </p>
              </div>
            </div>

            {/* Grafico por hora */}
            <div className="bg-gray-900 rounded-xl p-5 border border-gray-800 mb-6">
              <h2 className="font-bold text-lg mb-4">Contagem por hora do dia</h2>
              <div style={{ width: '100%', height: 260 }}>
                <ResponsiveContainer>
                  <BarChart data={relatorio.por_hora} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="hora" stroke="#9ca3af" fontSize={11} />
                    <YAxis stroke="#9ca3af" fontSize={11} allowDecimals={false} />
                    <Tooltip contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: 8 }} />
                    <Bar dataKey="total" fill="#eab308" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Por camera */}
            <div className="bg-gray-900 rounded-xl p-5 border border-gray-800">
              <h2 className="font-bold text-lg mb-4">Total por camera</h2>
              <div className="space-y-2">
                {relatorio.por_camera.map(pc => (
                  <div key={pc.camera} className="flex items-center justify-between bg-gray-800/60 rounded-lg px-4 py-3">
                    <span className="text-gray-300 text-sm">📷 {pc.camera}</span>
                    <span className="text-yellow-400 font-bold">{pc.total}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  )
}
