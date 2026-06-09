'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine
} from 'recharts'

const API = 'https://vms-platform-production.up.railway.app'

// ─────────────────────────────────────────────
// TIPOS
// ─────────────────────────────────────────────
type TipoHabito = 'sono' | 'refeicao' | 'banho' | 'atividade'

interface Camera {
  id: string
  nome: string
  ativo: boolean
}

interface PerfilHabito {
  id: string
  tipo: TipoHabito
  hora_media: number
  desvio_padrao: number
  threshold_alerta: number
  amostras_count: number
  aprendizado_completo: boolean
  ultima_atualizacao: string
}

interface AlertaHabito {
  id: string
  camera_id: string
  tipo: TipoHabito
  horario_esperado: string
  horario_real: string | null
  desvio_minutos: number
  status: 'pendente' | 'enviado' | 'resolvido' | 'falso_positivo'
  created_at: string
}

interface RegistroHabito {
  id: string
  tipo: TipoHabito
  horario_evento: string
  duracao_minutos?: number
  metadata?: { hora_decimal: number }
}

// ─────────────────────────────────────────────
// UTILITÁRIOS
// ─────────────────────────────────────────────
function decimalParaHora(decimal: number): string {
  const h = Math.floor(decimal)
  const m = Math.round((decimal - h) * 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

const ICONES: Record<TipoHabito, string> = {
  sono: '🌙', refeicao: '🍽️', banho: '🚿', atividade: '🚶'
}
const LABELS: Record<TipoHabito, string> = {
  sono: 'Sono', refeicao: 'Refeição', banho: 'Banho', atividade: 'Atividade'
}
const CORES: Record<TipoHabito, string> = {
  sono: '#6366f1', refeicao: '#f59e0b', banho: '#06b6d4', atividade: '#22c55e'
}

// ─────────────────────────────────────────────
// CARD PERFIL
// ─────────────────────────────────────────────
function CardPerfil({ perfil }: { perfil: PerfilHabito }) {
  const progresso = Math.min((perfil.amostras_count / 3) * 100, 100)
  return (
    <div className="bg-gray-800 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-2xl">{ICONES[perfil.tipo]}</span>
          <div>
            <p className="font-semibold text-white">{LABELS[perfil.tipo]}</p>
            <p className="text-xs text-gray-400">{perfil.amostras_count} amostras</p>
          </div>
        </div>
        {perfil.aprendizado_completo ? (
          <span className="text-xs bg-green-900 text-green-400 px-2 py-1 rounded-full">✓ Aprendido</span>
        ) : (
          <span className="text-xs bg-yellow-900 text-yellow-400 px-2 py-1 rounded-full">Aprendendo...</span>
        )}
      </div>

      {!perfil.aprendizado_completo && (
        <div className="mb-3">
          <div className="flex justify-between text-xs text-gray-500 mb-1">
            <span>Progresso do aprendizado</span>
            <span>{perfil.amostras_count}/3 dias</span>
          </div>
          <div className="h-1.5 bg-gray-700 rounded-full">
            <div className="h-1.5 bg-blue-500 rounded-full transition-all" style={{ width: `${progresso}%` }} />
          </div>
        </div>
      )}

      {perfil.aprendizado_completo && (
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="bg-gray-700 rounded-lg p-2">
            <p className="text-lg font-bold text-white">{decimalParaHora(perfil.hora_media)}</p>
            <p className="text-xs text-gray-400">Média</p>
          </div>
          <div className="bg-gray-700 rounded-lg p-2">
            <p className="text-lg font-bold text-white">±{Math.round(perfil.desvio_padrao * 60)}min</p>
            <p className="text-xs text-gray-400">Desvio</p>
          </div>
          <div className="bg-red-900/50 rounded-lg p-2">
            <p className="text-lg font-bold text-red-400">{decimalParaHora(perfil.threshold_alerta)}</p>
            <p className="text-xs text-gray-400">Limite</p>
          </div>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────
// CARD ALERTA
// ─────────────────────────────────────────────
function CardAlerta({ alerta, cameraNome, onResolver, onFalsoPositivo }: {
  alerta: AlertaHabito
  cameraNome: string
  onResolver: (id: string) => void
  onFalsoPositivo: (id: string) => void
}) {
  const data = new Date(alerta.created_at)
  const dataStr = data.toLocaleDateString('pt-BR')
  const horaStr = data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })

  const bordas = {
    pendente: 'border-l-red-500',
    enviado: 'border-l-yellow-500',
    resolvido: 'border-l-green-500',
    falso_positivo: 'border-l-gray-500',
  }

  return (
    <div className={`bg-gray-800 border border-gray-700 border-l-4 ${bordas[alerta.status]} rounded-xl p-4`}>
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xl">{ICONES[alerta.tipo]}</span>
          <div>
            <p className="font-semibold text-white">
              {LABELS[alerta.tipo]} — {alerta.desvio_minutos}min de atraso
            </p>
            <p className="text-sm text-gray-400">{cameraNome} · {dataStr} às {horaStr}</p>
          </div>
        </div>
        <span className={`text-xs px-2 py-1 rounded-full ${
          alerta.status === 'pendente' ? 'bg-red-900 text-red-400' :
          alerta.status === 'resolvido' ? 'bg-green-900 text-green-400' :
          alerta.status === 'falso_positivo' ? 'bg-gray-700 text-gray-400' :
          'bg-yellow-900 text-yellow-400'
        }`}>
          {alerta.status.replace('_', ' ')}
        </span>
      </div>

      <div className="mt-3 flex gap-4 text-sm text-gray-400">
        <span>⏰ Esperado até: <strong className="text-white">{alerta.horario_esperado.slice(0, 5)}</strong></span>
        {alerta.horario_real
          ? <span>🕐 Ocorreu às: <strong className="text-white">{alerta.horario_real.slice(0, 5)}</strong></span>
          : <span className="text-red-400">⚠️ Não ocorreu ainda</span>
        }
      </div>

      {alerta.status === 'pendente' && (
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => onResolver(alerta.id)}
            className="text-xs bg-green-700 hover:bg-green-600 text-white px-3 py-1.5 rounded-lg transition"
          >
            ✓ Resolver
          </button>
          <button
            onClick={() => onFalsoPositivo(alerta.id)}
            className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-3 py-1.5 rounded-lg transition"
          >
            Falso positivo
          </button>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────
// GRÁFICO HISTÓRICO
// ─────────────────────────────────────────────
function GraficoHistorico({ registros, perfil }: {
  registros: RegistroHabito[]
  perfil: PerfilHabito | undefined
}) {
  const dados = registros.map(r => ({
    data: new Date(r.horario_evento).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
    hora: r.metadata?.hora_decimal ?? 0,
  }))

  if (dados.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 text-gray-600">
        <div className="text-center">
          <p className="text-3xl mb-2">📊</p>
          <p className="text-sm">Sem registros ainda</p>
        </div>
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={dados} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
        <XAxis dataKey="data" tick={{ fill: '#9ca3af', fontSize: 11 }} />
        <YAxis domain={['auto', 'auto']} tickFormatter={decimalParaHora} tick={{ fill: '#9ca3af', fontSize: 11 }} />
        <Tooltip
          formatter={(v: number | string) => [decimalParaHora(Number(v)), 'Horário']}
          contentStyle={{ background: '#1f2937', border: '1px solid #374151', borderRadius: '8px' }}
          labelStyle={{ color: '#9ca3af' }}
        />
        {perfil?.aprendizado_completo && (
          <>
            <ReferenceLine y={perfil.hora_media} stroke="#6366f1" strokeDasharray="4 4"
              label={{ value: 'Média', fill: '#6366f1', fontSize: 10 }} />
            <ReferenceLine y={perfil.threshold_alerta} stroke="#ef4444" strokeDasharray="4 4"
              label={{ value: 'Limite', fill: '#ef4444', fontSize: 10 }} />
          </>
        )}
        <Line type="monotone" dataKey="hora" stroke="#6366f1" strokeWidth={2}
          dot={{ fill: '#6366f1', r: 4 }} activeDot={{ r: 6 }} />
      </LineChart>
    </ResponsiveContainer>
  )
}

// ─────────────────────────────────────────────
// PÁGINA PRINCIPAL
// ─────────────────────────────────────────────
export default function HabitosPage() {
  const [cameras, setCameras] = useState<Camera[]>([])
  const [cameraSelecionada, setCameraSelecionada] = useState<string>('')
  const [perfis, setPerfis] = useState<PerfilHabito[]>([])
  const [alertas, setAlertas] = useState<AlertaHabito[]>([])
  const [registros, setRegistros] = useState<RegistroHabito[]>([])
  const [tipoSelecionado, setTipoSelecionado] = useState<TipoHabito>('sono')
  const [aba, setAba] = useState<'perfil' | 'alertas' | 'historico'>('perfil')
  const [carregando, setCarregando] = useState(true)

  // Carrega câmeras ao montar
  useEffect(() => {
    fetch(`${API}/cameras/`)
      .then(r => r.json())
      .then(data => {
        const ativas = Array.isArray(data) ? data.filter((c: Camera) => c.ativo) : []
        setCameras(ativas)
        if (ativas.length > 0) setCameraSelecionada(ativas[0].id)
      })
      .catch(() => setCarregando(false))
  }, [])

  // Carrega dados quando câmera ou tipo muda
  useEffect(() => {
    if (!cameraSelecionada) return
    carregarDados()
  }, [cameraSelecionada, tipoSelecionado])

  async function carregarDados() {
    setCarregando(true)
    try {
      const [resPerfis, resAlertas, resRegistros] = await Promise.all([
        fetch(`${API}/habitos/perfil/${cameraSelecionada}`).then(r => r.json()),
        fetch(`${API}/habitos/alertas`).then(r => r.json()),
        fetch(`${API}/habitos/registros/${cameraSelecionada}?tipo=${tipoSelecionado}&dias=14`).then(r => r.json()),
      ])
      setPerfis(Array.isArray(resPerfis) ? resPerfis : [])
      setAlertas(Array.isArray(resAlertas) ? resAlertas.filter((a: AlertaHabito) => a.camera_id === cameraSelecionada) : [])
      setRegistros(Array.isArray(resRegistros) ? resRegistros : [])
    } catch (e) {
      console.error(e)
    } finally {
      setCarregando(false)
    }
  }

  async function resolver(id: string) {
    await fetch(`${API}/habitos/alertas/${id}/resolver`, { method: 'PATCH' })
    carregarDados()
  }

  async function falsoPositivo(id: string) {
    await fetch(`${API}/habitos/alertas/${id}/falso-positivo`, { method: 'PATCH' })
    carregarDados()
  }

  const alertasPendentes = alertas.filter(a => a.status === 'pendente').length
  const perfilAtual = perfis.find(p => p.tipo === tipoSelecionado)
  const cameraNome = cameras.find(c => c.id === cameraSelecionada)?.nome ?? 'Câmera'

  return (
    <main className="min-h-screen bg-gray-950 text-white p-8">
      <div className="max-w-4xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-blue-400">🧠 Análise de Hábitos</h1>
            <p className="text-gray-400 mt-1">IA aprende a rotina e alerta desvios</p>
          </div>
          <div className="flex items-center gap-3">
            {alertasPendentes > 0 && (
              <div className="bg-red-900 border border-red-700 rounded-xl px-4 py-2 text-center">
                <p className="text-2xl font-bold text-red-400">{alertasPendentes}</p>
                <p className="text-xs text-red-300">alerta{alertasPendentes > 1 ? 's' : ''}</p>
              </div>
            )}
            <Link href="/" className="bg-gray-800 hover:bg-gray-700 px-4 py-2 rounded-lg transition">
              ← Dashboard
            </Link>
          </div>
        </div>

        {/* Seletor de câmera */}
        {cameras.length > 1 && (
          <div className="mb-6">
            <label className="text-sm text-gray-400 mb-2 block">Câmera</label>
            <div className="flex gap-2 flex-wrap">
              {cameras.map(c => (
                <button
                  key={c.id}
                  onClick={() => setCameraSelecionada(c.id)}
                  className={`px-4 py-2 rounded-lg text-sm transition ${
                    cameraSelecionada === c.id
                      ? 'bg-blue-600 text-white font-medium'
                      : 'bg-gray-800 text-gray-400 hover:text-white'
                  }`}
                >
                  📷 {c.nome}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Abas */}
        <div className="flex gap-1 bg-gray-900 p-1 rounded-xl mb-6">
          {(['perfil', 'alertas', 'historico'] as const).map(a => (
            <button
              key={a}
              onClick={() => setAba(a)}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${
                aba === a ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'
              }`}
            >
              {a === 'perfil' && '🧠 Perfis'}
              {a === 'alertas' && `🔔 Alertas${alertasPendentes > 0 ? ` (${alertasPendentes})` : ''}`}
              {a === 'historico' && '📊 Histórico'}
            </button>
          ))}
        </div>

        {carregando ? (
          <div className="flex items-center justify-center h-64">
            <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {/* ABA PERFIS */}
            {aba === 'perfil' && (
              <div className="space-y-4">
                {perfis.length === 0 ? (
                  <div className="text-center py-24 text-gray-500">
                    <p className="text-6xl mb-4">🧠</p>
                    <p className="text-xl">Aprendendo padrões...</p>
                    <p className="text-sm mt-2 text-gray-600">
                      O sistema precisa de 3 dias de monitoramento para aprender a rotina.
                      Configure as regiões <strong className="text-gray-500">quarto</strong>,{' '}
                      <strong className="text-gray-500">banheiro</strong> e{' '}
                      <strong className="text-gray-500">cozinha</strong> na câmera.
                    </p>
                    <Link href="/regioes" className="text-blue-400 hover:underline mt-3 block">
                      Configurar regiões →
                    </Link>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {perfis.map(p => <CardPerfil key={p.id} perfil={p} />)}
                  </div>
                )}
              </div>
            )}

            {/* ABA ALERTAS */}
            {aba === 'alertas' && (
              <div className="space-y-3">
                {alertas.length === 0 ? (
                  <div className="text-center py-24 text-gray-500">
                    <p className="text-6xl mb-4">✅</p>
                    <p className="text-xl">Nenhum alerta registrado</p>
                    <p className="text-sm mt-2 text-gray-600">Tudo dentro do padrão esperado</p>
                  </div>
                ) : (
                  alertas.map(a => (
                    <CardAlerta
                      key={a.id}
                      alerta={a}
                      cameraNome={cameraNome}
                      onResolver={resolver}
                      onFalsoPositivo={falsoPositivo}
                    />
                  ))
                )}
              </div>
            )}

            {/* ABA HISTÓRICO */}
            {aba === 'historico' && (
              <div>
                {/* Seletor de tipo */}
                <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
                  {(['sono', 'refeicao', 'banho', 'atividade'] as TipoHabito[]).map(t => (
                    <button
                      key={t}
                      onClick={() => setTipoSelecionado(t)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition ${
                        tipoSelecionado === t ? 'text-white font-medium' : 'bg-gray-800 text-gray-400 hover:text-white'
                      }`}
                      style={tipoSelecionado === t ? { backgroundColor: CORES[t] } : {}}
                    >
                      {ICONES[t]} {LABELS[t]}
                    </button>
                  ))}
                </div>

                <div className="bg-gray-800 rounded-xl p-4 mb-4">
                  <p className="text-sm text-gray-400 mb-3">
                    Horários dos últimos 14 dias — {LABELS[tipoSelecionado]}
                  </p>
                  <GraficoHistorico registros={registros} perfil={perfilAtual} />
                </div>

                {perfilAtual?.aprendizado_completo && (
                  <div className="bg-gray-800 rounded-xl p-4">
                    <p className="text-sm font-medium text-white mb-2">📊 Interpretação</p>
                    <p className="text-sm text-gray-400">
                      A pessoa normalmente{' '}
                      {tipoSelecionado === 'sono' ? 'acorda' : 'realiza essa atividade'} às{' '}
                      <strong className="text-white">{decimalParaHora(perfilAtual.hora_media)}</strong>,
                      com variação de ±{Math.round(perfilAtual.desvio_padrao * 60)} minutos.
                      Um alerta é gerado se passar das{' '}
                      <strong className="text-red-400">{decimalParaHora(perfilAtual.threshold_alerta)}</strong>{' '}
                      sem que o hábito seja detectado.
                    </p>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </main>
  )
}
