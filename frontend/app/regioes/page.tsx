'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '../hooks/useAuth'

const API = 'https://vms-platform-production.up.railway.app'

interface Camera {
  id: string
  nome: string
  rtsp_url: string
  ativo: boolean
}

interface Regiao {
  id: string
  camera_id: string
  tipo: string
  x1: number
  y1: number
  x2: number
  y2: number
}

interface PontoInicio {
  x: number
  y: number
}

export default function RegioesPage() {
  const { usuario, carregando: authCarregando, logout } = useAuth()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)

  const [cameras, setCameras] = useState<Camera[]>([])
  const [cameraSelecionada, setCameraSelecionada] = useState<Camera | null>(null)
  const [snapshot, setSnapshot] = useState<string | null>(null)
  const [regioes, setRegioes] = useState<Regiao[]>([])
  const [desenhando, setDesenhando] = useState(false)
  const [pontoInicio, setPontoInicio] = useState<PontoInicio | null>(null)
  const [retanguloAtual, setRetanguloAtual] = useState<Regiao | null>(null)
  const [tipoSelecionado, setTipoSelecionado] = useState<string>('cama')
  const [salvando, setSalvando] = useState(false)
  const [mensagem, setMensagem] = useState('')
  const [mousePosicao, setMousePosicao] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (!authCarregando) carregarCameras()
  }, [authCarregando])

  useEffect(() => {
    desenharCanvas()
  }, [snapshot, regioes, retanguloAtual, mousePosicao])

  async function carregarCameras() {
    const data = await fetch(`${API}/cameras/`).then(r => r.json())
    setCameras(Array.isArray(data) ? data : [])
  }

  async function selecionarCamera(camera: Camera) {
    setCameraSelecionada(camera)
    setSnapshot(null)
    setRegioes([])
    setRetanguloAtual(null)
    setPontoInicio(null)
    setMensagem('')
    setSnapshot(`${API}/cameras/${camera.id}/snapshot?t=${Date.now()}`)
    carregarRegioes(camera.id)
  }

  async function carregarRegioes(cameraId: string) {
    try {
      const res = await fetch(`${API}/regioes/${cameraId}`)
      if (res.ok) setRegioes(await res.json())
    } catch {}
  }

  function getCorTipo(tipo: string) {
    switch (tipo) {
      case 'cama': return { borda: '#3B82F6', fundo: 'rgba(59,130,246,0.2)', label: '🛏️ Cama' }
      case 'area_risco': return { borda: '#EF4444', fundo: 'rgba(239,68,68,0.2)', label: '⚠️ Área de Risco' }
      case 'banheiro': return { borda: '#10B981', fundo: 'rgba(16,185,129,0.2)', label: '🚿 Banheiro' }
      default: return { borda: '#F59E0B', fundo: 'rgba(245,158,11,0.2)', label: tipo }
    }
  }

  function desenharCanvas() {
    const canvas = canvasRef.current
    const img = imgRef.current
    if (!canvas || !img || !img.complete || !img.naturalWidth) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const w = canvas.width
    const h = canvas.height

    ctx.drawImage(img, 0, 0, w, h)

    // Desenha regiões salvas
    regioes.forEach(r => {
      const cor = getCorTipo(r.tipo)
      ctx.fillStyle = cor.fundo
      ctx.strokeStyle = cor.borda
      ctx.lineWidth = 2
      ctx.setLineDash([])

      const rx = r.x1 * w
      const ry = r.y1 * h
      const rw = (r.x2 - r.x1) * w
      const rh = (r.y2 - r.y1) * h

      ctx.fillRect(rx, ry, rw, rh)
      ctx.strokeRect(rx, ry, rw, rh)

      // Label
      ctx.fillStyle = cor.borda
      ctx.font = 'bold 14px sans-serif'
      ctx.textAlign = 'left'
      ctx.fillText(cor.label, rx + 4, ry + 18)
    })

    // Desenha retângulo sendo desenhado
    if (pontoInicio && mousePosicao) {
      const cor = getCorTipo(tipoSelecionado)
      ctx.fillStyle = cor.fundo
      ctx.strokeStyle = cor.borda
      ctx.lineWidth = 2
      ctx.setLineDash([6, 3])

      const rx = pontoInicio.x * w
      const ry = pontoInicio.y * h
      const rw = (mousePosicao.x - pontoInicio.x) * w
      const rh = (mousePosicao.y - pontoInicio.y) * h

      ctx.fillRect(rx, ry, rw, rh)
      ctx.strokeRect(rx, ry, rw, rh)
      ctx.setLineDash([])
    }

    // Retângulo finalizado antes de salvar
    if (retanguloAtual) {
      const cor = getCorTipo(retanguloAtual.tipo)
      ctx.fillStyle = cor.fundo
      ctx.strokeStyle = cor.borda
      ctx.lineWidth = 3
      ctx.setLineDash([])

      const rx = retanguloAtual.x1 * w
      const ry = retanguloAtual.y1 * h
      const rw = (retanguloAtual.x2 - retanguloAtual.x1) * w
      const rh = (retanguloAtual.y2 - retanguloAtual.y1) * h

      ctx.fillRect(rx, ry, rw, rh)
      ctx.strokeRect(rx, ry, rw, rh)

      ctx.fillStyle = cor.borda
      ctx.font = 'bold 14px sans-serif'
      ctx.textAlign = 'left'
      ctx.fillText(cor.label + ' (não salvo)', rx + 4, ry + 18)
    }
  }

  function handleCanvasMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!desenhando) return
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height
    setPontoInicio({ x, y })
    setRetanguloAtual(null)
  }

  function handleCanvasMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!desenhando || !pontoInicio) return
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height
    setMousePosicao({ x, y })
  }

  function handleCanvasMouseUp(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!desenhando || !pontoInicio) return
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height

    // Garante que x1 < x2 e y1 < y2
    const regiao: Regiao = {
      id: '',
      camera_id: cameraSelecionada?.id || '',
      tipo: tipoSelecionado,
      x1: Math.min(pontoInicio.x, x),
      y1: Math.min(pontoInicio.y, y),
      x2: Math.max(pontoInicio.x, x),
      y2: Math.max(pontoInicio.y, y),
    }

    setRetanguloAtual(regiao)
    setPontoInicio(null)
    setMousePosicao(null)
    setDesenhando(false)
  }

  async function salvarRegiao() {
    if (!retanguloAtual || !cameraSelecionada) return
    setSalvando(true)
    setMensagem('')
    try {
      const res = await fetch(`${API}/regioes/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          camera_id: cameraSelecionada.id,
          tipo: retanguloAtual.tipo,
          x1: retanguloAtual.x1,
          y1: retanguloAtual.y1,
          x2: retanguloAtual.x2,
          y2: retanguloAtual.y2,
        })
      })
      if (res.ok) {
        setMensagem(`✅ Região "${tipoSelecionado}" salva! Worker vai usar em até 30s.`)
        setRetanguloAtual(null)
        carregarRegioes(cameraSelecionada.id)
      }
    } catch {
      setMensagem('❌ Erro ao salvar região.')
    } finally {
      setSalvando(false)
    }
  }

  async function deletarRegiao(tipo: string) {
    if (!cameraSelecionada) return
    await fetch(`${API}/regioes/${cameraSelecionada.id}/${tipo}`, { method: 'DELETE' })
    carregarRegioes(cameraSelecionada.id)
    setMensagem(`🗑️ Região "${tipo}" removida.`)
  }

  if (authCarregando) {
    return (
      <main className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-gray-950 text-white p-8">
      <div className="max-w-7xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-blue-400">Regiões Monitoradas</h1>
            <p className="text-gray-400 mt-1">Defina áreas de risco para detecção de quedas</p>
          </div>
          <div className="flex items-center gap-3">
            {usuario && <span className="text-gray-400 text-sm hidden md:block">👤 {usuario.nome}</span>}
            <Link href="/" className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg font-bold transition">
              ← Dashboard
            </Link>
            <button onClick={logout} className="bg-red-900 hover:bg-red-800 px-4 py-2 rounded-lg font-bold transition text-red-300">
              Sair
            </button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-8">

          {/* Coluna esquerda */}
          <div className="space-y-6">

            {/* Câmeras */}
            <div className="bg-gray-800 rounded-xl p-6">
              <h2 className="text-lg font-bold mb-4">Câmera</h2>
              <div className="space-y-2">
                {cameras.map(c => (
                  <button
                    key={c.id}
                    onClick={() => selecionarCamera(c)}
                    className={`w-full text-left px-4 py-3 rounded-lg transition ${
                      cameraSelecionada?.id === c.id
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
                    }`}
                  >
                    <p className="font-bold">{c.nome}</p>
                    <p className="text-xs opacity-70 truncate">{c.rtsp_url}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Tipo de região */}
            <div className="bg-gray-800 rounded-xl p-6">
              <h2 className="text-lg font-bold mb-4">Tipo de Região</h2>
              <div className="space-y-2">
                {[
                  { valor: 'cama', label: '🛏️ Cama', desc: 'Detecta queda do leito' },
                  { valor: 'area_risco', label: '⚠️ Área de Risco', desc: 'Alerta de presença' },
                  { valor: 'banheiro', label: '🚿 Banheiro', desc: 'Monitora entradas e quedas' },
                ].map(t => (
                  <button
                    key={t.valor}
                    onClick={() => setTipoSelecionado(t.valor)}
                    className={`w-full text-left px-4 py-3 rounded-lg transition ${
                      tipoSelecionado === t.valor
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
                    }`}
                  >
                    <p className="font-bold">{t.label}</p>
                    <p className="text-xs opacity-70">{t.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Regiões salvas */}
            {regioes.length > 0 && (
              <div className="bg-gray-800 rounded-xl p-6">
                <h2 className="text-lg font-bold mb-4">Regiões Configuradas</h2>
                <div className="space-y-2">
                  {regioes.map(r => {
                    const cor = getCorTipo(r.tipo)
                    return (
                      <div key={r.id} className="flex items-center justify-between bg-gray-700 rounded-lg px-3 py-2">
                        <span className="text-sm font-bold">{cor.label}</span>
                        <button
                          onClick={() => deletarRegiao(r.tipo)}
                          className="text-gray-400 hover:text-red-400 transition text-sm"
                        >
                          🗑️
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Instruções */}
            <div className="bg-gray-800 rounded-xl p-6">
              <h2 className="text-lg font-bold mb-3">Como usar</h2>
              <ol className="space-y-2 text-sm text-gray-400">
                <li className="flex gap-2"><span className="text-blue-400 font-bold">1.</span> Selecione a câmera</li>
                <li className="flex gap-2"><span className="text-blue-400 font-bold">2.</span> Escolha o tipo de região</li>
                <li className="flex gap-2"><span className="text-blue-400 font-bold">3.</span> Clique "Desenhar"</li>
                <li className="flex gap-2"><span className="text-blue-400 font-bold">4.</span> Arraste para criar o retângulo</li>
                <li className="flex gap-2"><span className="text-blue-400 font-bold">5.</span> Clique "Salvar região"</li>
              </ol>
            </div>
          </div>

          {/* Canvas */}
          <div className="col-span-2">
            <div className="bg-gray-800 rounded-xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold">
                  {cameraSelecionada ? cameraSelecionada.nome : 'Selecione uma câmera'}
                </h2>
                {cameraSelecionada && (
                  <div className="flex gap-2">
                    {!desenhando && (
                      <button
                        onClick={() => { setDesenhando(true); setRetanguloAtual(null) }}
                        className="bg-yellow-600 hover:bg-yellow-700 px-4 py-2 rounded-lg text-sm font-bold transition"
                      >
                        ✏️ Desenhar
                      </button>
                    )}
                    {desenhando && (
                      <button
                        onClick={() => { setDesenhando(false); setPontoInicio(null); setMousePosicao(null) }}
                        className="bg-gray-600 hover:bg-gray-500 px-4 py-2 rounded-lg text-sm font-bold transition"
                      >
                        Cancelar
                      </button>
                    )}
                    {retanguloAtual && !desenhando && (
                      <>
                        <button
                          onClick={() => setRetanguloAtual(null)}
                          className="bg-gray-600 hover:bg-gray-500 px-4 py-2 rounded-lg text-sm font-bold transition"
                        >
                          🗑️ Descartar
                        </button>
                        <button
                          onClick={salvarRegiao}
                          disabled={salvando}
                          className="bg-green-600 hover:bg-green-700 disabled:bg-gray-600 px-4 py-2 rounded-lg text-sm font-bold transition"
                        >
                          {salvando ? 'Salvando...' : '💾 Salvar região'}
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>

              {desenhando && (
                <div className="bg-yellow-900/30 border border-yellow-500/50 rounded-lg px-4 py-2 mb-4 text-sm text-yellow-300">
                  🖱️ Clique e arraste para desenhar a região <strong>{tipoSelecionado}</strong>
                </div>
              )}

              {mensagem && (
                <div className={`rounded-lg px-4 py-2 mb-4 text-sm ${
                  mensagem.startsWith('✅') ? 'bg-green-900/30 text-green-300' : 
                  mensagem.startsWith('🗑️') ? 'bg-gray-700 text-gray-300' :
                  'bg-red-900/30 text-red-300'
                }`}>
                  {mensagem}
                </div>
              )}

              {cameraSelecionada ? (
                <div className="relative">
                  <img
                    ref={imgRef}
                    src={snapshot || ''}
                    className="hidden"
                    onLoad={desenharCanvas}
                    alt=""
                  />
                  <canvas
                    ref={canvasRef}
                    onMouseDown={handleCanvasMouseDown}
                    onMouseMove={handleCanvasMouseMove}
                    onMouseUp={handleCanvasMouseUp}
                    className={`w-full rounded-lg ${desenhando ? 'cursor-crosshair' : 'cursor-default'}`}
                    style={{ maxHeight: '500px' }}
                  />
                  {!snapshot && (
                    <div className="absolute inset-0 flex items-center justify-center bg-gray-900 rounded-lg">
                      <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
                    </div>
                  )}
                </div>
              ) : (
                <div className="aspect-video bg-gray-900 rounded-lg flex items-center justify-center">
                  <div className="text-center text-gray-500">
                    <div className="text-5xl mb-3">🛏️</div>
                    <p>Selecione uma câmera para configurar regiões</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}