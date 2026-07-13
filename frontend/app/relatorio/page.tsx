'use client'
import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '../hooks/useAuth'

const API = process.env.NEXT_PUBLIC_API_URL || 'https://vms-platform-production.up.railway.app'

const CAMERAS: Record<string, string> = {
  '53db3fd2-d6b6-4dff-b8f1-169ca2b866d6': 'estacionamento',
  'da512062-2fa8-450c-96d8-9817d85ead7f': 'bar',
  '6ee2c5a7-42e0-4b1c-9551-91d40141a9e1': 'salao',
  '610e1f97-01ff-434f-9a1e-45bca046b41f': 'deck',
  '855f39dc-e141-4730-bcf0-2e6db2df9707': 'matinho',
}

interface Evento {
  id: string
  camera_id: string
  tipo: string
  confianca: number
  criado_em: string
  video_url: string | null
}

export default function RelatorioPage() {
  const { usuario, carregando } = useAuth()
  const [eventos, setEventos] = useState<Evento[]>([])
  const [data, setData] = useState(new Date().toISOString().split('T')[0])
  const [carregandoDados, setCarregandoDados] = useState(false)

  const buscarEventos = useCallback(async () => {
    setCarregandoDados(true)
    try {
      const res = await fetch(`${API}/eventos/?limit=500`)
      const data_eventos: Evento[] = await res.json()
      setEventos(data_eventos)
    } catch (e) {
      console.error(e)
    } finally {
      setCarregandoDados(false)
    }
  }, [])

  useEffect(() => { buscarEventos() }, [buscarEventos])

  if (carregando) return null

  const eventosDia = eventos.filter(e => e.criado_em.startsWith(data))
  const entradas = eventosDia.filter(e => e.tipo === 'entrada')
  const saidas = eventosDia.filter(e => e.tipo === 'saida')
  const alertas = eventosDia.filter(e => !['entrada', 'saida'].includes(e.tipo))

  // Horarios de pico — agrupa por hora
  const porHora: Record<number, number> = {}
  eventosDia.forEach(e => {
    const h = new Date(e.criado_em).getHours()
    porHora[h] = (porHora[h] || 0) + 1
  })
  const horaPico = Object.entries(porHora).sort((a, b) => b[1] - a[1])[0]

  // Por camera
  const porCamera: Record<string, { entradas: number; saidas: number; alertas: number }> = {}
  Object.keys(CAMERAS).forEach(id => { porCamera[id] = { entradas: 0, saidas: 0, alertas: 0 } })
  eventosDia.forEach(e => {
    if (!porCamera[e.camera_id]) porCamera[e.camera_id] = { entradas: 0, saidas: 0, alertas: 0 }
    if (e.tipo === 'entrada') porCamera[e.camera_id].entradas++
    else if (e.tipo === 'saida') porCamera[e.camera_id].saidas++
    else porCamera[e.camera_id].alertas++
  })

  const hora = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  const dataFormatada = new Date(data + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })

  return (
    <main className="min-h-screen bg-gray-950 text-white p-6">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; color: black !important; }
          .print-page { background: white !important; color: black !important; }
        }
      `}</style>

      {/* Header */}
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6 no-print">
          <div>
            <h1 className="text-2xl font-bold text-blue-400">Relatório Diário</h1>
            <p className="text-gray-400 text-sm">VMS Platform — Monitoramento com IA</p>
          </div>
          <div className="flex gap-3 items-center">
            <input
              type="date"
              value={data}
              onChange={e => setData(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm"
            />
            <button
              onClick={() => window.print()}
              className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg font-bold text-sm transition"
            >
              📄 Exportar PDF
            </button>
            <button
              onClick={() => window.history.back()}
              className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg font-bold text-sm transition"
            >
              Voltar
            </button>
          </div>
        </div>

        {/* Conteudo do relatorio */}
        <div className="print-page bg-gray-900 rounded-2xl p-8 space-y-8">

          {/* Cabecalho */}
          <div className="border-b border-gray-700 pb-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-3xl font-bold text-white">VMS Platform</h2>
                <p className="text-gray-400 mt-1">Sistema de Monitoramento com Inteligência Artificial</p>
              </div>
              <div className="text-right">
                <div className="text-blue-400 font-bold text-lg">{dataFormatada}</div>
                <div className="text-gray-400 text-sm mt-1">Empresa: {usuario?.empresa_id?.slice(0, 8)}...</div>
              </div>
            </div>
          </div>

          {carregandoDados ? (
            <div className="text-center py-12 text-gray-400">Carregando dados...</div>
          ) : eventosDia.length === 0 ? (
            <div className="text-center py-12 text-gray-400">Nenhum evento registrado nesta data.</div>
          ) : (
            <>
              {/* Cards de resumo */}
              <div>
                <h3 className="text-lg font-bold text-gray-300 mb-4">Resumo do Dia</h3>
                <div className="grid grid-cols-4 gap-4">
                  {[
                    { label: 'Total de Eventos', valor: eventosDia.length, cor: '#3b82f6' },
                    { label: 'Entradas', valor: entradas.length, cor: '#22c55e' },
                    { label: 'Saídas', valor: saidas.length, cor: '#ef4444' },
                    { label: 'Alertas', valor: alertas.length, cor: '#f59e0b' },
                  ].map(card => (
                    <div key={card.label} style={{ borderLeft: `4px solid ${card.cor}` }}
                      className="bg-gray-800 rounded-lg p-4">
                      <div style={{ color: card.cor }} className="text-3xl font-bold">{card.valor}</div>
                      <div className="text-gray-400 text-sm mt-1">{card.label}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Horario de pico */}
              {horaPico && (
                <div className="bg-gray-800 rounded-lg p-4">
                  <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wide mb-2">Horário de Pico</h3>
                  <div className="flex items-center gap-4">
                    <div className="text-4xl font-bold text-blue-400">{horaPico[0]}h</div>
                    <div className="text-gray-300">{horaPico[1]} eventos registrados nessa hora</div>
                  </div>
                  {/* Grafico de barras por hora */}
                  <div className="mt-4 flex items-end gap-1 h-16">
                    {Array.from({ length: 24 }, (_, h) => {
                      const count = porHora[h] || 0
                      const max = Math.max(...Object.values(porHora), 1)
                      const pct = (count / max) * 100
                      return (
                        <div key={h} className="flex-1 flex flex-col items-center gap-1">
                          <div
                            style={{ height: `${pct}%`, background: h === parseInt(horaPico[0]) ? '#3b82f6' : '#374151', minHeight: count > 0 ? 4 : 0 }}
                            className="w-full rounded-t"
                          />
                        </div>
                      )
                    })}
                  </div>
                  <div className="flex justify-between text-xs text-gray-600 mt-1">
                    <span>00h</span><span>06h</span><span>12h</span><span>18h</span><span>23h</span>
                  </div>
                </div>
              )}

              {/* Por camera */}
              <div>
                <h3 className="text-lg font-bold text-gray-300 mb-4">Por Câmera</h3>
                <div className="space-y-2">
                  {Object.entries(CAMERAS).map(([id, nome]) => {
                    const c = porCamera[id] || { entradas: 0, saidas: 0, alertas: 0 }
                    const total = c.entradas + c.saidas + c.alertas
                    if (total === 0) return null
                    return (
                      <div key={id} className="bg-gray-800 rounded-lg px-4 py-3 flex items-center justify-between">
                        <span className="text-white font-medium capitalize">{nome}</span>
                        <div className="flex gap-6 text-sm">
                          <span className="text-green-400">↗ {c.entradas} entradas</span>
                          <span className="text-red-400">↙ {c.saidas} saídas</span>
                          {c.alertas > 0 && <span className="text-yellow-400">⚠ {c.alertas} alertas</span>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Alertas */}
              {alertas.length > 0 && (
                <div>
                  <h3 className="text-lg font-bold text-gray-300 mb-4">Alertas Registrados</h3>
                  <div className="space-y-2">
                    {alertas.map(e => (
                      <div key={e.id} className="bg-yellow-900/30 border border-yellow-700/50 rounded-lg px-4 py-3 flex items-center justify-between">
                        <div>
                          <span className="text-yellow-400 font-medium">{e.tipo.replace('_', ' ')}</span>
                          <span className="text-gray-400 text-sm ml-3">{CAMERAS[e.camera_id] || e.camera_id.slice(0, 8)}</span>
                        </div>
                        <div className="text-gray-400 text-sm">{hora(e.criado_em)} — {Math.round(e.confianca * 100)}% conf.</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Timeline de eventos */}
              <div>
                <h3 className="text-lg font-bold text-gray-300 mb-4">Timeline de Eventos</h3>
                <div className="space-y-1 max-h-80 overflow-y-auto no-print">
                  {eventosDia.map(e => (
                    <div key={e.id} className="flex items-center gap-3 py-2 border-b border-gray-800 text-sm">
                      <span className="text-gray-500 w-12 flex-shrink-0">{hora(e.criado_em)}</span>
                      <span className={`w-20 font-medium flex-shrink-0 ${e.tipo === 'entrada' ? 'text-green-400' : e.tipo === 'saida' ? 'text-red-400' : 'text-yellow-400'}`}>
                        {e.tipo.replace('_', ' ')}
                      </span>
                      <span className="text-gray-400 capitalize">{CAMERAS[e.camera_id] || e.camera_id.slice(0, 8)}</span>
                      <span className="text-gray-600 ml-auto">{Math.round(e.confianca * 100)}%</span>
                    </div>
                  ))}
                </div>
                {/* Versao impressa da timeline */}
                <div className="space-y-1 hidden print:block">
                  {eventosDia.slice(0, 30).map(e => (
                    <div key={e.id} className="flex items-center gap-3 py-1 border-b border-gray-200 text-sm text-black">
                      <span className="w-12">{hora(e.criado_em)}</span>
                      <span className="w-20 font-medium">{e.tipo.replace('_', ' ')}</span>
                      <span className="capitalize">{CAMERAS[e.camera_id] || e.camera_id.slice(0, 8)}</span>
                      <span className="ml-auto">{Math.round(e.confianca * 100)}%</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Rodape */}
              <div className="border-t border-gray-700 pt-4 text-center text-gray-500 text-xs">
                Relatório gerado em {new Date().toLocaleString('pt-BR')} — VMS Platform
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  )
}