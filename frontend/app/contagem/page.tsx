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

interface Linha {
  x1: number
  y1: number
  x2: number
  y2: number
}

interface Contagem {
  entradas: number
  saidas: number
  saldo: number
}

export default function ContagemPage() {
  const { usuario, carregando: authCarregando, logout } = useAuth()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)

  const [cameras, setCameras] = useState<Camera[]>([])
  const [cameraSelecionada, setCameraSelecionada] = useState<Camera | null>(null)
  const [snapshot, setSnapshot] = useState<string | null>(null)
  const [linha, setLinha] = useState<Linha | null>(null)
  const [linhaSalva, setLinhaSalva] = useState<Linha | null>(null)
  const [desenhando, setDesenhando] = useState(false)
  const [pontoA, setPontoA] = useState<{ x: number; y: number } | null>(null)
  const [contagem, setContagem] = useState<Contagem | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [mensagem, setMensagem] = useState('')

  useEffect(() => {
    if (!authCarregando) carregarCameras()
  }, [authCarregando])

  // Auto-refresh contagem a cada 5s
  useEffect(() => {
    if (!cameraSelecionada) return
    const interval = setInterval(() => carregarContagem(cameraSelecionada.id), 5000)
    return () => clearInterval(interval)
  }, [cameraSelecionada])

  async function carregarCameras() {
    const data = await fetch(`${API}/cameras/?empresa_id=${usuario?.empresa_id}`).then(r => r.json())
    setCameras(Array.isArray(data) ? data : [])
  }

  async function selecionarCamera(camera: Camera) {
    setCameraSelecionada(camera)
    setLinha(null)
    setPontoA(null)
    setSnapshot(null)
    setContagem(null)

    // Carrega snapshot
    setSnapshot(`${API}/cameras/${camera.id}/snapshot?t=${Date.now()}`)

    // Carrega linha existente
    try {
      const res = await fetch(`${API}/contagem/${camera.id}`)
      if (res.ok) {
        const data = await res.json()
        setLinhaSalva(data)
        setLinha(data)
      } else {
        setLinhaSalva(null)
      }
    } catch {
      setLinhaSalva(null)
    }

    // Carrega contagem
    carregarContagem(camera.id)
  }

  async function carregarContagem(cameraId: string) {
    try {
      const res = await fetch(`${API}/contagem/${cameraId}/contagem`)
      if (res.ok) setContagem(await res.json())
    } catch {}
  }

  // Desenha no canvas quando snapshot ou linha muda
  useEffect(() => {
    desenharCanvas()
  }, [snapshot, linha, pontoA])

  function desenharCanvas() {
    const canvas = canvasRef.current
    const img = imgRef.current
    if (!canvas || !img || !img.complete) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.width = img.naturalWidth || img.width
    canvas.height = img.naturalHeight || img.height

    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

    const w = canvas.width
    const h = canvas.height

    // Desenha linha salva em cinza (se diferente da atual)
    if (linhaSalva && !linha) {
      ctx.strokeStyle = '#6B7280'
      ctx.lineWidth = 2
      ctx.setLineDash([5, 5])
      ctx.beginPath()
      ctx.moveTo(linhaSalva.x1 * w, linhaSalva.y1 * h)
      ctx.lineTo(linhaSalva.x2 * w, linhaSalva.y2 * h)
      ctx.stroke()
      ctx.setLineDash([])
    }

    // Desenha linha atual
    if (linha) {
      // Linha principal
      ctx.strokeStyle = '#FBBF24'
      ctx.lineWidth = 3
      ctx.setLineDash([])
      ctx.beginPath()
      ctx.moveTo(linha.x1 * w, linha.y1 * h)
      ctx.lineTo(linha.x2 * w, linha.y2 * h)
      ctx.stroke()

      // Ponto A (verde)
      ctx.fillStyle = '#10B981'
      ctx.beginPath()
      ctx.arc(linha.x1 * w, linha.y1 * h, 8, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = 'white'
      ctx.font = 'bold 12px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('A', linha.x1 * w, linha.y1 * h + 4)

      // Ponto B (vermelho)
      ctx.fillStyle = '#EF4444'
      ctx.beginPath()
      ctx.arc(linha.x2 * w, linha.y2 * h, 8, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = 'white'
      ctx.fillText('B', linha.x2 * w, linha.y2 * h + 4)

      // Seta de direÃ§Ã£o Aâ†’B
      const mx = (linha.x1 + linha.x2) / 2 * w
      const my = (linha.y1 + linha.y2) / 2 * h
      ctx.fillStyle = '#FBBF24'
      ctx.font = 'bold 14px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('â†’ entrada', mx + 20, my - 10)
    }

    // Ponto A temporÃ¡rio (durante desenho)
    if (pontoA && !linha) {
      ctx.fillStyle = '#10B981'
      ctx.beginPath()
      ctx.arc(pontoA.x * w, pontoA.y * h, 8, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = 'white'
      ctx.font = 'bold 12px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('A', pontoA.x * w, pontoA.y * h + 4)
    }
  }

  function handleCanvasClick(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!desenhando) return
    const canvas = canvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    const x = ((e.clientX - rect.left) * scaleX) / canvas.width
    const y = ((e.clientY - rect.top) * scaleY) / canvas.height

    if (!pontoA) {
      // Primeiro clique = ponto A
      setPontoA({ x, y })
    } else {
      // Segundo clique = ponto B â†’ linha completa
      setLinha({ x1: pontoA.x, y1: pontoA.y, x2: x, y2: y })
      setPontoA(null)
      setDesenhando(false)
    }
  }

  async function salvarLinha() {
    if (!linha || !cameraSelecionada) return
    setSalvando(true)
    setMensagem('')
    try {
      const res = await fetch(`${API}/contagem/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          camera_id: cameraSelecionada.id,
          x1: linha.x1,
          y1: linha.y1,
          x2: linha.x2,
          y2: linha.y2,
        })
      })
      if (res.ok) {
        setLinhaSalva(linha)
        setMensagem('âœ… Linha salva! O worker vai usar esta linha em atÃ© 30 segundos.')
      } else {
        setMensagem('âŒ Erro ao salvar linha.')
      }
    } catch {
      setMensagem('âŒ Erro de conexÃ£o.')
    } finally {
      setSalvando(false)
    }
  }

  function resetarLinha() {
    setLinha(null)
    setPontoA(null)
    setDesenhando(false)
    setMensagem('')
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
            <h1 className="text-3xl font-bold text-blue-400">Linha de Contagem</h1>
            <p className="text-gray-400 mt-1">Desenhe uma linha para contar pessoas que cruzam</p>
          </div>
          <div className="flex items-center gap-3">
            {usuario && <span className="text-gray-400 text-sm hidden md:block">ðŸ‘¤ {usuario.nome}</span>}
            <Link href="/" className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg font-bold transition">
              â† Dashboard
            </Link>
            <button onClick={logout} className="bg-red-900 hover:bg-red-800 px-4 py-2 rounded-lg font-bold transition text-red-300">
              Sair
            </button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-8">

          {/* Coluna esquerda â€” seleÃ§Ã£o de cÃ¢mera + contagem */}
          <div className="space-y-6">

            {/* SeleÃ§Ã£o de cÃ¢mera */}
            <div className="bg-gray-800 rounded-xl p-6">
              <h2 className="text-lg font-bold mb-4">Selecionar CÃ¢mera</h2>
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

            {/* Contagem */}
            {contagem && (
              <div className="bg-gray-800 rounded-xl p-6">
                <h2 className="text-lg font-bold mb-4">Contagem em Tempo Real</h2>
                <div className="space-y-3">
                  <div className="bg-green-900/30 border border-green-500/30 rounded-lg p-4">
                    <p className="text-gray-400 text-sm">Entradas (Aâ†’B)</p>
                    <p className="text-4xl font-bold text-green-400">{contagem.entradas}</p>
                  </div>
                  <div className="bg-red-900/30 border border-red-500/30 rounded-lg p-4">
                    <p className="text-gray-400 text-sm">SaÃ­das (Bâ†’A)</p>
                    <p className="text-4xl font-bold text-red-400">{contagem.saidas}</p>
                  </div>
                  <div className="bg-blue-900/30 border border-blue-500/30 rounded-lg p-4">
                    <p className="text-gray-400 text-sm">Pessoas dentro agora</p>
                    <p className="text-4xl font-bold text-blue-400">{contagem.saldo}</p>
                  </div>
                </div>
                <p className="text-gray-500 text-xs mt-3">Atualiza a cada 5s</p>
              </div>
            )}

            {/* InstruÃ§Ãµes */}
            <div className="bg-gray-800 rounded-xl p-6">
              <h2 className="text-lg font-bold mb-3">Como usar</h2>
              <ol className="space-y-2 text-sm text-gray-400">
                <li className="flex gap-2"><span className="text-blue-400 font-bold">1.</span> Selecione uma cÃ¢mera</li>
                <li className="flex gap-2"><span className="text-blue-400 font-bold">2.</span> Clique em "Desenhar linha"</li>
                <li className="flex gap-2"><span className="text-blue-400 font-bold">3.</span> Clique no ponto A <span className="text-green-400">(verde)</span></li>
                <li className="flex gap-2"><span className="text-blue-400 font-bold">4.</span> Clique no ponto B <span className="text-red-400">(vermelho)</span></li>
                <li className="flex gap-2"><span className="text-blue-400 font-bold">5.</span> Clique em "Salvar linha"</li>
                <li className="flex gap-2"><span className="text-blue-400 font-bold">6.</span> Aâ†’B conta como <span className="text-green-400">entrada</span></li>
                <li className="flex gap-2"><span className="text-blue-400 font-bold">7.</span> Bâ†’A conta como <span className="text-red-400">saÃ­da</span></li>
              </ol>
            </div>

          </div>

          {/* Coluna direita â€” canvas */}
          <div className="col-span-2">
            <div className="bg-gray-800 rounded-xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold">
                  {cameraSelecionada ? cameraSelecionada.nome : 'Selecione uma cÃ¢mera'}
                </h2>
                {cameraSelecionada && (
                  <div className="flex gap-2">
                    {!desenhando && (
                      <button
                        onClick={() => { setDesenhando(true); setLinha(null); setPontoA(null) }}
                        className="bg-yellow-600 hover:bg-yellow-700 px-4 py-2 rounded-lg text-sm font-bold transition"
                      >
                        âœï¸ Desenhar linha
                      </button>
                    )}
                    {desenhando && (
                      <button
                        onClick={resetarLinha}
                        className="bg-gray-600 hover:bg-gray-500 px-4 py-2 rounded-lg text-sm font-bold transition"
                      >
                        Cancelar
                      </button>
                    )}
                    {linha && !desenhando && (
                      <>
                        <button
                          onClick={resetarLinha}
                          className="bg-gray-600 hover:bg-gray-500 px-4 py-2 rounded-lg text-sm font-bold transition"
                        >
                          ðŸ—‘ï¸ Apagar
                        </button>
                        <button
                          onClick={salvarLinha}
                          disabled={salvando}
                          className="bg-green-600 hover:bg-green-700 disabled:bg-gray-600 px-4 py-2 rounded-lg text-sm font-bold transition"
                        >
                          {salvando ? 'Salvando...' : 'ðŸ’¾ Salvar linha'}
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* InstruÃ§Ã£o durante desenho */}
              {desenhando && (
                <div className="bg-yellow-900/30 border border-yellow-500/50 rounded-lg px-4 py-2 mb-4 text-sm text-yellow-300">
                  {!pontoA
                    ? 'ðŸ–±ï¸ Clique para definir o ponto A (inÃ­cio da linha)'
                    : 'ðŸ–±ï¸ Clique para definir o ponto B (fim da linha)'}
                </div>
              )}

              {/* Mensagem de status */}
              {mensagem && (
                <div className={`rounded-lg px-4 py-2 mb-4 text-sm ${
                  mensagem.startsWith('âœ…') ? 'bg-green-900/30 text-green-300' : 'bg-red-900/30 text-red-300'
                }`}>
                  {mensagem}
                </div>
              )}

              {/* Canvas com snapshot */}
              {cameraSelecionada ? (
                <div className="relative">
                  {/* Imagem oculta para carregar o snapshot */}
                  <img
                    ref={imgRef}
                    src={snapshot || ''}
                    className="hidden"
                    onLoad={desenharCanvas}
                    alt=""
                  />
                  <canvas
                    ref={canvasRef}
                    onClick={handleCanvasClick}
                    className={`w-full rounded-lg ${desenhando ? 'cursor-crosshair' : 'cursor-default'}`}
                    style={{ maxHeight: '500px', objectFit: 'contain' }}
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
                    <div className="text-5xl mb-3">ðŸ“·</div>
                    <p>Selecione uma cÃ¢mera para comeÃ§ar</p>
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
