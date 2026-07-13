'use client'
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useAuth } from '../hooks/useAuth'

const API = process.env.NEXT_PUBLIC_API_URL || 'https://vms-platform-production.up.railway.app'
const SUPABASE_URL = 'https://wqoekhbwdrgryahoyjuo.supabase.co'
const SUPABASE_KEY = 'sb_publishable_0UZ6n5qJEkfAbiKveWTE0A_ixc_w9MY'

interface Camera {
  id: string
  nome: string
  ativo: boolean
}

interface Evento {
  id: string
  camera_id: string
  tipo: string
  confianca: number
  criado_em: string
}

interface ContagemCamera {
  camera_id: string
  nome: string
  entradas: number
  saidas: number
  dentro: number
  ultima_atividade: string | null
}

interface PorHora {
  hora: string
  entradas: number
  saidas: number
}

function formatarHora(iso: string) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

function formatarDataHora(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit'
  })
}

export default function ContagemPage() {
  const { usuario } = useAuth()
  const [cameras, setCameras] = useState<Camera[]>([])
  const [contagens, setContagens] = useState<ContagemCamera[]>([])
  const [porHora, setPorHora] = useState<PorHora[]>([])
  const [totalHoje, setTotalHoje] = useState({ entradas: 0, saidas: 0, dentro: 0, pico: 0 })
  const [carregando, setCarregando] = useState(true)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [ultimaAtualizacao, setUltimaAtualizacao] = useState('')

  const carregar = useCallback(async () => {
    if (!usuario) return
    try {
      // Busca cameras
      const resCameras = await fetch(`${API}/cameras/?empresa_id=${usuario.empresa_id}`)
      const dataCameras: Camera[] = await resCameras.json()
      setCameras(Array.isArray(dataCameras) ? dataCameras : [])

      // Busca eventos de entrada/saida de hoje
      const hoje = new Date()
      hoje.setHours(0, 0, 0, 0)
      const hojeIso = hoje.toISOString()

      const resEventos = await fetch(
        `${SUPABASE_URL}/rest/v1/eventos?empresa_id=eq.${usuario.empresa_id}&tipo=in.(entrada,saida)&criado_em=gte.${hojeIso}&order=criado_em.asc&limit=1000`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
      )
      const eventos: Evento[] = await resEventos.json()

      if (!Array.isArray(eventos)) return

      // Calcula contagem por camera
      const mapaContagem: Record<string, ContagemCamera> = {}
      for (const cam of dataCameras) {
        mapaContagem[cam.id] = {
          camera_id: cam.id,
          nome: cam.nome,
          entradas: 0,
          saidas: 0,
          dentro: 0,
          ultima_atividade: null,
        }
      }

      for (const ev of eventos) {
        if (!mapaContagem[ev.camera_id]) continue
        if (ev.tipo === 'entrada') {
          mapaContagem[ev.camera_id].entradas++
          mapaContagem[ev.camera_id].dentro++
        } else if (ev.tipo === 'saida') {
          mapaContagem[ev.camera_id].saidas++
          mapaContagem[ev.camera_id].dentro = Math.max(0, mapaContagem[ev.camera_id].dentro - 1)
        }
        mapaContagem[ev.camera_id].ultima_atividade = ev.criado_em
      }

      const contagensArr = Object.values(mapaContagem)
      setContagens(contagensArr)

      // Totais gerais
      const totalEntradas = contagensArr.reduce((s, c) => s + c.entradas, 0)
      const totalSaidas   = contagensArr.reduce((s, c) => s + c.saidas, 0)
      const totalDentro   = contagensArr.reduce((s, c) => s + c.dentro, 0)

      // Pico do dia — maximo de pessoas dentro ao mesmo tempo
      let pico = 0; let atual = 0
      for (const ev of eventos) {
        if (ev.tipo === 'entrada') { atual++; pico = Math.max(pico, atual) }
        else if (ev.tipo === 'saida') { atual = Math.max(0, atual - 1) }
      }
      setTotalHoje({ entradas: totalEntradas, saidas: totalSaidas, dentro: totalDentro, pico })

      // Agrupa por hora para o grafico
      const mapaHoras: Record<string, { entradas: number; saidas: number }> = {}
      for (const ev of eventos) {
        const hora = new Date(ev.criado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
        if (!mapaHoras[hora]) mapaHoras[hora] = { entradas: 0, saidas: 0 }
        if (ev.tipo === 'entrada') mapaHoras[hora].entradas++
        else mapaHoras[hora].saidas++
      }
      const porHoraArr = Object.entries(mapaHoras)
        .map(([hora, v]) => ({ hora, ...v }))
        .sort((a, b) => a.hora.localeCompare(b.hora))
      setPorHora(porHoraArr)

      setUltimaAtualizacao(new Date().toLocaleTimeString('pt-BR'))
    } catch (e) {
      console.error(e)
    }
    setCarregando(false)
  }, [usuario])

  useEffect(() => { carregar() }, [carregar])

  useEffect(() => {
    if (!autoRefresh) return
    const interval = setInterval(carregar, 15000)
    return () => clearInterval(interval)
  }, [autoRefresh, carregar])

  const maxBarra = Math.max(...porHora.map(h => h.entradas + h.saidas), 1)

  return (
    <main className="min-h-screen bg-gray-950 text-white p-6">
      <div className="max-w-6xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-blue-400">Contagem de Pessoas</h1>
            <p className="text-gray-400 text-sm mt-1">
              Hoje — atualizado {ultimaAtualizacao || '...'}
            </p>
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
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
                <p className="text-gray-400 text-sm mb-1">Dentro agora</p>
                <p className="text-4xl font-bold text-white">{totalHoje.dentro}</p>
                <p className="text-gray-500 text-xs mt-1">pessoas</p>
              </div>
              <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
                <p className="text-gray-400 text-sm mb-1">Entradas hoje</p>
                <p className="text-4xl font-bold text-green-400">{totalHoje.entradas}</p>
              </div>
              <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
                <p className="text-gray-400 text-sm mb-1">Saidas hoje</p>
                <p className="text-4xl font-bold text-red-400">{totalHoje.saidas}</p>
              </div>
              <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
                <p className="text-gray-400 text-sm mb-1">Pico do dia</p>
                <p className="text-4xl font-bold text-yellow-400">{totalHoje.pico}</p>
                <p className="text-gray-500 text-xs mt-1">max simultaneos</p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">

              {/* Por camera */}
              <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
                <h2 className="text-white font-bold mb-4">Por Camera</h2>
                {contagens.filter(c => c.entradas > 0 || c.saidas > 0).length === 0 ? (
                  <p className="text-gray-500 text-sm">Nenhuma movimentacao hoje. Ative o analítico "Linha de Contagem" e configure a linha no botao [R].</p>
                ) : (
                  <div className="space-y-3">
                    {contagens.map(c => (
                      <div key={c.camera_id} className="bg-gray-900 rounded-lg p-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-white font-bold text-sm">{c.nome}</span>
                          <span className="bg-blue-900 text-blue-300 text-xs px-2 py-0.5 rounded-full font-bold">
                            {c.dentro} dentro
                          </span>
                        </div>
                        <div className="flex gap-4 text-xs">
                          <span className="text-green-400">+{c.entradas} entradas</span>
                          <span className="text-red-400">-{c.saidas} saidas</span>
                          {c.ultima_atividade && (
                            <span className="text-gray-500">ultimo: {formatarHora(c.ultima_atividade)}</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Grafico por hora */}
              <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
                <h2 className="text-white font-bold mb-4">Movimentacao por Hora</h2>
                {porHora.length === 0 ? (
                  <p className="text-gray-500 text-sm">Sem dados ainda.</p>
                ) : (
                  <div className="space-y-2 max-h-72 overflow-y-auto">
                    {porHora.map((h, i) => (
                      <div key={i} className="flex items-center gap-3">
                        <span className="text-gray-400 text-xs w-12 text-right">{h.hora}</span>
                        <div className="flex-1 flex gap-1">
                          {/* Barra entradas */}
                          <div className="flex-1 bg-gray-700 rounded-l h-5 overflow-hidden">
                            <div
                              className="h-full bg-green-600 rounded-l transition-all"
                              style={{ width: `${(h.entradas / maxBarra) * 100}%` }}
                            />
                          </div>
                          {/* Barra saidas */}
                          <div className="flex-1 bg-gray-700 rounded-r h-5 overflow-hidden">
                            <div
                              className="h-full bg-red-600 rounded-r transition-all"
                              style={{ width: `${(h.saidas / maxBarra) * 100}%` }}
                            />
                          </div>
                        </div>
                        <span className="text-gray-500 text-xs w-16 text-right">
                          +{h.entradas} -{h.saidas}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex gap-4 mt-3 text-xs">
                  <span className="flex items-center gap-1"><span className="w-3 h-3 bg-green-600 rounded inline-block" /> Entradas</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-3 bg-red-600 rounded inline-block" /> Saidas</span>
                </div>
              </div>
            </div>

            {/* Instrucoes se nao tiver dados */}
            {totalHoje.entradas === 0 && (
              <div className="bg-gray-800 border border-gray-700 rounded-xl p-5">
                <h3 className="text-white font-bold mb-2">Como configurar a contagem</h3>
                <div className="space-y-2 text-sm text-gray-400">
                  <p>1. Va em <Link href="/cameras" className="text-blue-400 hover:underline">Cameras</Link> e clique em <span className="bg-gray-700 px-1 rounded font-mono">[R]</span> na camera da entrada</p>
                  <p>2. Desenhe a linha virtual na imagem onde as pessoas cruzam</p>
                  <p>3. Clique em <span className="bg-gray-700 px-1 rounded font-mono">IA</span> e ative o toggle <strong>Linha de Contagem</strong></p>
                  <p>4. Volte aqui — as contagens aparecerão em tempo real</p>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  )
}

