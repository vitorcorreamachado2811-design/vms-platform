'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

interface Evento {
  id: string
  camera_id: string
  tipo: string
  confianca: number
  criado_em: string
}

interface Camera {
  id: string
  nome: string
}

interface DadoGrafico {
  hora: string
  deteccoes: number
}

export default function EventosPage() {
  const [eventos, setEventos] = useState<Evento[]>([])
  const [cameras, setCameras] = useState<Camera[]>([])
  const [loading, setLoading] = useState(true)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [cameraSelecionada, setCameraSelecionada] = useState<string>('todas')

  useEffect(() => {
    carregarDados()
  }, [])

  useEffect(() => {
    if (!autoRefresh) return
    const interval = setInterval(carregarEventos, 3000)
    return () => clearInterval(interval)
  }, [autoRefresh])

  async function carregarDados() {
    const [e, c] = await Promise.all([
      fetch('http://localhost:8000/eventos/').then(r => r.json()),
      fetch('http://localhost:8000/cameras/').then(r => r.json()),
    ])
    setEventos(e)
    setCameras(c)
    setLoading(false)
  }

  async function carregarEventos() {
    const data = await fetch('http://localhost:8000/eventos/').then(r => r.json())
    setEventos(data)
  }

  const eventosFiltrados = cameraSelecionada === 'todas'
    ? eventos
    : eventos.filter(e => e.camera_id === cameraSelecionada)

  const totalHoje = eventosFiltrados.filter(e => {
    const hoje = new Date().toDateString()
    return new Date(e.criado_em).toDateString() === hoje
  }).length

  function dadosGrafico(): DadoGrafico[] {
    const contagem: Record<string, number> = {}
    for (let h = 0; h < 24; h++) {
      contagem[String(h).padStart(2, '0') + 'h'] = 0
    }
    eventosFiltrados.forEach(e => {
      const hora = new Date(e.criado_em).getHours()
      const chave = String(hora).padStart(2, '0') + 'h'
      contagem[chave] = (contagem[chave] || 0) + 1
    })
    return Object.entries(contagem).map(([hora, deteccoes]) => ({ hora, deteccoes }))
  }

  function formatarData(criado_em: string) {
    if (!criado_em) return '-'
    return new Date(criado_em).toLocaleString('pt-BR')
  }

  function corConfianca(confianca: number) {
    if (confianca >= 0.85) return 'text-green-400'
    if (confianca >= 0.65) return 'text-yellow-400'
    return 'text-red-400'
  }

  function nomeDaCamera(camera_id: string) {
    const cam = cameras.find(c => c.id === camera_id)
    return cam ? cam.nome : camera_id.slice(0, 8) + '...'
  }

  const horaComMaisDeteccoes = dadosGrafico().reduce((max, item) =>
    item.deteccoes > max.deteccoes ? item : max, { hora: '-', deteccoes: 0 })

  return (
    <main className="min-h-screen bg-gray-950 text-white p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-blue-400">VMS Platform</h1>
            <p className="text-gray-400 mt-1">Eventos detectados pela IA</p>
          </div>
          <Link href="/" className="bg-gray-800 hover:bg-gray-700 px-4 py-2 rounded-lg transition text-sm">
            Voltar ao Dashboard
          </Link>
        </div>

        <div className="grid grid-cols-4 gap-4 mb-8">
          <div className="bg-gray-800 rounded-xl p-4">
            <p className="text-gray-400 text-sm">Total de Eventos</p>
            <p className="text-3xl font-bold text-blue-400">{eventosFiltrados.length}</p>
          </div>
          <div className="bg-gray-800 rounded-xl p-4">
            <p className="text-gray-400 text-sm">Hoje</p>
            <p className="text-3xl font-bold text-green-400">{totalHoje}</p>
          </div>
          <div className="bg-gray-800 rounded-xl p-4">
            <p className="text-gray-400 text-sm">Hora com mais movimento</p>
            <p className="text-3xl font-bold text-yellow-400">{horaComMaisDeteccoes.hora}</p>
          </div>
          <div className="bg-gray-800 rounded-xl p-4">
            <p className="text-gray-400 text-sm">Auto-Refresh</p>
            <button
              onClick={() => setAutoRefresh(v => !v)}
              className={`mt-1 text-sm px-3 py-1 rounded-full font-bold transition ${autoRefresh ? 'bg-green-900 text-green-300' : 'bg-gray-700 text-gray-400'}`}
            >
              {autoRefresh ? 'Ativo (3s)' : 'Pausado'}
            </button>
          </div>
        </div>

        <div className="bg-gray-800 rounded-xl p-6 mb-8">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold">Deteccoes por hora do dia</h2>
            <select
              value={cameraSelecionada}
              onChange={e => setCameraSelecionada(e.target.value)}
              className="bg-gray-700 text-white px-4 py-2 rounded-lg text-sm"
            >
              <option value="todas">Todas as cameras</option>
              {cameras.map(c => (
                <option key={c.id} value={c.id}>{c.nome}</option>
              ))}
            </select>
          </div>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={dadosGrafico()} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="hora" tick={{ fill: '#9CA3AF', fontSize: 11 }} interval={1} />
              <YAxis tick={{ fill: '#9CA3AF', fontSize: 12 }} />
              <Tooltip
                contentStyle={{ backgroundColor: '#1F2937', border: 'none', borderRadius: '8px' }}
                labelStyle={{ color: '#F3F4F6' }}
                itemStyle={{ color: '#60A5FA' }}
              />
              <Bar dataKey="deteccoes" fill="#3B82F6" radius={[4, 4, 0, 0]} name="Deteccoes" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-gray-800 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold">Lista de Eventos</h2>
            <div className="flex gap-3 items-center">
              <select
                value={cameraSelecionada}
                onChange={e => setCameraSelecionada(e.target.value)}
                className="bg-gray-700 text-white px-4 py-2 rounded-lg text-sm"
              >
                <option value="todas">Todas as cameras ({eventos.length})</option>
                {cameras.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.nome} ({eventos.filter(e => e.camera_id === c.id).length})
                  </option>
                ))}
              </select>
              <button
                onClick={carregarEventos}
                className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg text-sm font-bold transition"
              >
                Atualizar
              </button>
            </div>
          </div>

          {loading ? (
            <p className="text-gray-400">Carregando eventos...</p>
          ) : eventosFiltrados.length === 0 ? (
            <p className="text-gray-400">Nenhum evento para esta camera ainda.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-400 border-b border-gray-700 text-left">
                    <th className="pb-3 pr-4">Tipo</th>
                    <th className="pb-3 pr-4">Confianca</th>
                    <th className="pb-3 pr-4">Camera</th>
                    <th className="pb-3">Data/Hora</th>
                  </tr>
                </thead>
                <tbody>
                  {[...eventosFiltrados].reverse().map(evento => (
                    <tr key={evento.id} className="border-b border-gray-700 hover:bg-gray-700 transition">
                      <td className="py-3 pr-4">
                        <span className="bg-blue-900 text-blue-300 px-2 py-1 rounded-full text-xs font-bold">
                          {evento.tipo}
                        </span>
                      </td>
                      <td className={`py-3 pr-4 font-bold ${corConfianca(evento.confianca)}`}>
                        {(evento.confianca * 100).toFixed(0)}%
                      </td>
                      <td className="py-3 pr-4 text-gray-300 text-xs">
                        {nomeDaCamera(evento.camera_id)}
                      </td>
                      <td className="py-3 text-gray-300">
                        {formatarData(evento.criado_em)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
