'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '../hooks/useAuth'

const API = 'https://vms-platform-production.up.railway.app'

interface Camera {
  id: string
  nome: string
}

interface Ponto {
  x: number
  y: number
  peso: number
}

interface HeatmapData {
  camera_id: string
  total_pontos: number
  horas: number
  grid: Ponto[]
}

export default function HeatmapPage() {
  const { usuario, carregando: authCarregando, logout } = useAuth()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)

  const [cameras, setCameras] = useState<Camera[]>([])
  const [cameraSelecionada, setCameraSelecionada] = useState<Camera | null>(null)
  const [snapshot, setSnapshot] = useState<string | null>(null)
  const [heatmapData, setHeatmapData] = useState<HeatmapData | null>(null)
  const [horas, setHoras] = useState(24)
  const [carregando, setCarregando] = useState(false)
  const [opacidade, setOpacidade] = useState(0.7)

  useEffect(() => {
    if (!authCarregando) carregarCameras()
  }, [authCarregando])

  useEffect(() => {
    if (cameraSelecionada) carregarHeatmap()
  }, [cameraSelecionada, horas])

  useEffect(() => {
    renderizarHeatmap()
  }, [heatmapData, opacidade])

  async function carregarCameras() {
    const data = await fetch(`${API}/cameras/`).then(r => r.json())
    setCameras(Array.isArray(data) ? data : [])
  }

  async function selecionarCamera(camera: Camera) {
    setCameraSelecionada(camera)
    setSnapshot(`${API}/cameras/${camera.id}/snapshot?t=${Date.now()}`)
    setHeatmapData(null)
  }

  async function carregarHeatmap() {
    if (!cameraSelecionada) return
    setCarregando(true)
    try {
      const res = await fetch(`${API}/heatmap/${cameraSelecionada.id}?horas=${horas}`)
      if (res.ok) {
        const data = await res.json()
        setHeatmapData(data)
      }
    } catch {}
    finally { setCarregando(false) }
  }

  async function limparHeatmap() {
    if (!cameraSelecionada) return
    await fetch(`${API}/heatmap/${cameraSelecionada.id}`, { method: 'DELETE' })
    setHeatmapData(null)
    carregarHeatmap()
  }

  function renderizarHeatmap() {
    const canvas = canvasRef.current
    const img = imgRef.current
    if (!canvas || !img || !img.complete || !img.naturalWidth) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const w = canvas.width
    const h = canvas.height

    // Desenha snapshot como fundo
    ctx.drawImage(img, 0, 0, w, h)

    if (!heatmapData || heatmapData.grid.length === 0) return

    // Encontra peso máximo para normalizar
    const maxPeso = Math.max(...heatmapData.grid.map(p => p.peso))
    if (maxPeso === 0) return

    // Tamanho do raio de cada ponto (2% da tela)
    const raio = w * 0.04

    // Cria canvas temporário para o heatmap
    const heatCanvas = document.createElement('canvas')
    heatCanvas.width = w
    heatCanvas.height = h
    const heatCtx = heatCanvas.getContext('2d')
    if (!heatCtx) return

    // Desenha cada ponto como um gradiente radial
    heatmapData.grid.forEach(ponto => {
      const px = ponto.x * w
      const py = ponto.y * h
      const intensidade = ponto.peso / maxPeso

      const gradient = heatCtx.createRadialGradient(px, py, 0, px, py, raio)

      // Cores baseadas na intensidade
      if (intensidade > 0.7) {
        // Alta — vermelho
        gradient.addColorStop(0, `rgba(255, 0, 0, ${intensidade})`)
        gradient.addColorStop(0.5, `rgba(255, 100, 0, ${intensidade * 0.6})`)
        gradient.addColorStop(1, 'rgba(255, 0, 0, 0)')
      } else if (intensidade > 0.4) {
        // Média — amarelo/laranja
        gradient.addColorStop(0, `rgba(255, 200, 0, ${intensidade})`)
        gradient.addColorStop(0.5, `rgba(255, 150, 0, ${intensidade * 0.6})`)
        gradient.addColorStop(1, 'rgba(255, 200, 0, 0)')
      } else if (intensidade > 0.2) {
        // Baixa-média — verde
        gradient.addColorStop(0, `rgba(0, 255, 100, ${intensidade})`)
        gradient.addColorStop(0.5, `rgba(0, 200, 100, ${intensidade * 0.6})`)
        gradient.addColorStop(1, 'rgba(0, 255, 100, 0)')
      } else {
        // Baixa — azul
        gradient.addColorStop(0, `rgba(0, 100, 255, ${intensidade})`)
        gradient.addColorStop(0.5, `rgba(0, 50, 255, ${intensidade * 0.6})`)
        gradient.addColorStop(1, 'rgba(0, 100, 255, 0)')
      }

      heatCtx.fillStyle = gradient
      heatCtx.beginPath()
      heatCtx.arc(px, py, raio, 0, Math.PI * 2)
      heatCtx.fill()
    })

    // Aplica o heatmap sobre o snapshot com opacidade
    ctx.globalAlpha = opacidade
    ctx.drawImage(heatCanvas, 0, 0)
    ctx.globalAlpha = 1

    // Legenda
    const legendaW = 120
    const legendaH = 20
    const legendaX = w - legendaW - 10
    const legendaY = h - 40

    const legGrad = ctx.createLinearGradient(legendaX, 0, legendaX + legendaW, 0)
    legGrad.addColorStop(0, 'rgba(0, 100, 255, 0.8)')
    legGrad.addColorStop(0.33, 'rgba(0, 255, 100, 0.8)')
    legGrad.addColorStop(0.66, 'rgba(255, 200, 0, 0.8)')
    legGrad.addColorStop(1, 'rgba(255, 0, 0, 0.8)')

    ctx.fillStyle = legGrad
    ctx.fillRect(legendaX, legendaY, legendaW, legendaH)

    ctx.fillStyle = 'white'
    ctx.font = '11px sans-serif'
    ctx.textAlign = 'left'
    ctx.fillText('Pouco', legendaX, legendaY - 4)
    ctx.textAlign = 'right'
    ctx.fillText('Muito', legendaX + legendaW, legendaY - 4)
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
            <h1 className="text-3xl font-bold text-blue-400">Mapa de Calor</h1>
            <p className="text-gray-400 mt-1">Visualize onde há mais movimento nas câmeras</p>
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

            {/* Seleção de câmera */}
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
                    {c.nome}
                  </button>
                ))}
              </div>
            </div>

            {/* Filtros */}
            <div className="bg-gray-800 rounded-xl p-6">
              <h2 className="text-lg font-bold mb-4">Filtros</h2>
              <div className="space-y-4">
                <div>
                  <label className="text-gray-400 text-sm mb-2 block">
                    Período: últimas {horas}h
                  </label>
                  <input
                    type="range"
                    min={1}
                    max={168}
                    value={horas}
                    onChange={e => setHoras(Number(e.target.value))}
                    className="w-full accent-blue-500"
                  />
                  <div className="flex justify-between text-xs text-gray-500 mt-1">
                    <span>1h</span>
                    <span>24h</span>
                    <span>7 dias</span>
                  </div>
                </div>

                <div>
                  <label className="text-gray-400 text-sm mb-2 block">
                    Opacidade: {Math.round(opacidade * 100)}%
                  </label>
                  <input
                    type="range"
                    min={10}
                    max={100}
                    value={opacidade * 100}
                    onChange={e => setOpacidade(Number(e.target.value) / 100)}
                    className="w-full accent-blue-500"
                  />
                </div>

                <button
                  onClick={carregarHeatmap}
                  disabled={!cameraSelecionada || carregando}
                  className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 py-2 rounded-lg font-bold transition"
                >
                  {carregando ? 'Carregando...' : '🔄 Atualizar'}
                </button>

                <button
                  onClick={limparHeatmap}
                  disabled={!cameraSelecionada}
                  className="w-full bg-red-900 hover:bg-red-800 disabled:bg-gray-700 py-2 rounded-lg font-bold transition text-red-300"
                >
                  🗑️ Limpar dados
                </button>
              </div>
            </div>

            {/* Stats */}
            {heatmapData && (
              <div className="bg-gray-800 rounded-xl p-6">
                <h2 className="text-lg font-bold mb-4">Estatísticas</h2>
                <div className="space-y-3">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Total detecções</span>
                    <span className="font-bold text-blue-400">{heatmapData.total_pontos}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Zonas ativas</span>
                    <span className="font-bold text-green-400">{heatmapData.grid.length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Período</span>
                    <span className="font-bold text-yellow-400">{horas}h</span>
                  </div>
                </div>
              </div>
            )}

            {/* Legenda */}
            <div className="bg-gray-800 rounded-xl p-6">
              <h2 className="text-lg font-bold mb-4">Legenda</h2>
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-3">
                  <div className="w-4 h-4 rounded-full bg-red-500"/>
                  <span className="text-gray-300">Alta concentração</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-4 h-4 rounded-full bg-yellow-400"/>
                  <span className="text-gray-300">Média concentração</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-4 h-4 rounded-full bg-green-400"/>
                  <span className="text-gray-300">Baixa concentração</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-4 h-4 rounded-full bg-blue-500"/>
                  <span className="text-gray-300">Passagem ocasional</span>
                </div>
              </div>
            </div>

          </div>

          {/* Canvas */}
          <div className="col-span-2">
            <div className="bg-gray-800 rounded-xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold">
                  {cameraSelecionada ? cameraSelecionada.nome : 'Selecione uma câmera'}
                </h2>
                {heatmapData && (
                  <span className="text-gray-400 text-sm">
                    {heatmapData.total_pontos} detecções nas últimas {horas}h
                  </span>
                )}
              </div>

              {cameraSelecionada ? (
                <div className="relative">
                  <img
                    ref={imgRef}
                    src={snapshot || ''}
                    className="hidden"
                    onLoad={renderizarHeatmap}
                    alt=""
                  />
                  <canvas
                    ref={canvasRef}
                    className="w-full rounded-lg"
                    style={{ maxHeight: '500px', objectFit: 'contain' }}
                  />
                  {!snapshot && (
                    <div className="absolute inset-0 flex items-center justify-center bg-gray-900 rounded-lg">
                      <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
                    </div>
                  )}
                  {heatmapData && heatmapData.total_pontos === 0 && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-lg">
                      <div className="text-center">
                        <div className="text-4xl mb-2">📊</div>
                        <p className="text-gray-300">Sem dados ainda</p>
                        <p className="text-gray-500 text-sm mt-1">O worker acumula dados a cada 60s</p>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="aspect-video bg-gray-900 rounded-lg flex items-center justify-center">
                  <div className="text-center text-gray-500">
                    <div className="text-5xl mb-3">🌡️</div>
                    <p>Selecione uma câmera para ver o mapa de calor</p>
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