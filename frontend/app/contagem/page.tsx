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
  const imgRef    = useRef<HTMLImageElement>(null)

  const [cameras, setCameras]                     = useState<Camera[]>([])
  const [cameraSelecionada, setCameraSelecionada] = useState<Camera | null>(null)
  const [snapshot, setSnapshot]                   = useState<string | null>(null)
  const [linha, setLinha]                         = useState<Linha | null>(null)
  const [linhaSalva, setLinhaSalva]               = useState<Linha | null>(null)
  const [desenhando, setDesenhando]               = useState(false)
  const [pontoA, setPontoA]                       = useState<{ x: number; y: number } | null>(null)
  const [contagem, setContagem]                   = useState<Contagem | null>(null)
  const [salvando, setSalvando]                   = useState(false)
  const [mensagem, setMensagem]                   = useState('')

  useEffect(() => {
    if (!authCarregando) carregarCameras()
  }, [authCarregando])

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
    setSnapshot(`${API}/cameras/${camera.id}/snapshot?t=${Date.now()}`)
    try {
      const res = await fetch(`${API}/contagem/${camera.id}`)
      if (res.ok) {
        const data = await res.json()
        setLinhaSalva(data)
        setLinha(data)
      } else {
        setLinhaSalva(null)
      }
    } catch { setLinhaSalva(null) }
    carregarContagem(camera.id)
  }

  async function carregarContagem(cameraId: string) {
    try {
      const res = await fetch(`${API}/contagem/${cameraId}/contagem`)
      if (res.ok) setContagem(await res.json())
    } catch {}
  }

  useEffect(() => { desenharCanvas() }, [snapshot, linha, pontoA])

  function desenharCanvas() {
    const canvas = canvasRef.current
    const img    = imgRef.current
    if (!canvas || !img) return
    if (!img.naturalWidth && !img.complete) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.width  = img.naturalWidth  || img.width
    canvas.height = img.naturalHeight || img.height
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

    const w = canvas.width
    const h = canvas.height

    if (linhaSalva && !linha) {
      ctx.strokeStyle = '#6B7280'
      ctx.lineWidth   = 2
      ctx.setLineDash([5, 5])
      ctx.beginPath()
      ctx.moveTo(linhaSalva.x1 * w, linhaSalva.y1 * h)
      ctx.lineTo(linhaSalva.x2 * w, linhaSalva.y2 * h)
      ctx.stroke()
      ctx.setLineDash([])
    }

    if (linha) {
      ctx.strokeStyle = '#FBBF24'
      ctx.lineWidth   = 3
      ctx.setLineDash([])
      ctx.beginPath()
      ctx.moveTo(linha.x1 * w, linha.y1 * h)
      ctx.lineTo(linha.x2 * w, linha.y2 * h)
      ctx.stroke()

      ctx.fillStyle = '#10B981'
      ctx.beginPath()
      ctx.arc(linha.x1 * w, linha.y1 * h, 8, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = 'white'
      ctx.font = 'bold 12px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('A', linha.x1 * w, linha.y1 * h + 4)

      ctx.fillStyle = '#EF4444'
      ctx.beginPath()
      ctx.arc(linha.x2 * w, linha.y2 * h, 8, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = 'white'
      ctx.fillText('B', linha.x2 * w, linha.y2 * h + 4)

      const mx = (linha.x1 + linha.x2) / 2 * w
      const my = (linha.y1 + linha.y2) / 2 * h
      ctx.fillStyle = '#FBBF24'
      ctx.font = 'bold 14px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('-> entrada', mx + 20, my - 10)
    }

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
    const rect  = canvas.getBoundingClientRect()
    const scaleX = canvas.width  / rect.width
    const scaleY = canvas.height / rect.height
    const x = ((e.clientX - rect.left) * scaleX) / canvas.width
    const y = ((e.clientY - rect.top)  * scaleY) / canvas.height

    if (!pontoA) {
      setPontoA({ x, y })
    } else {
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
          x1: linha.x1, y1: linha.y1,
          x2: linha.x2, y2: linha.y2,
        })
      })
      if (res.ok) {
        setLinhaSalva(linha)
        setMensagem('Linha salva! O worker vai usar em ate 30 segundos.')
      } else {
        setMensagem('Erro ao salvar linha.')
      }
    } catch { setMensagem('Erro de conexao.') }
    finally { setSalvando(false) }
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

        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-blue-400">Linha de Contagem</h1>
            <p className="text-gray-400 mt-1">Desenhe uma linha para contar pessoas que cruzam</p>
          </div>
          <div className="flex gap-3">
            <Link href="/" className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg font-bold transition text-sm">
              Dashboard
            </Link>
            <button onClick={logout} className="bg-red-900 hover:bg-red-800 px-4 py-2 rounded-lg font-bold transition text-red-300 text-sm">
              Sair
            </button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-6">
          {/* Lista de cameras */}
          <div className="space-y-4">
            <div className="bg-gray-800 rounded-xl p-4">
              <h2 className="font-bold text-lg mb-3">Selecionar Camera</h2>
              {cameras.length === 0 ? (
                <p className="text-gray-400 text-sm">Nenhuma camera disponivel.</p>
              ) : (
                <div className="space-y-2">
                  {cameras.filter(c => c.ativo).map(c => (
                    <button key={c.id} onClick={() => selecionarCamera(c)}
                      className={`w-full text-left p-3 rounded-lg transition ${
                        cameraSelecionada?.id === c.id
                          ? 'bg-blue-700 text-white'
                          : 'bg-gray-700 hover:bg-gray-600 text-gray-200'
                      }`}>
                      <p className="font-bold text-sm">{c.nome}</p>
                      <p className="text-xs text-gray-400 truncate">{c.rtsp_url}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Contagem */}
            {contagem && (
              <div className="bg-gray-800 rounded-xl p-4">
                <h2 className="font-bold text-lg mb-3">Contagem em Tempo Real</h2>
                <div className="space-y-2">
                  <div className="bg-green-900/40 rounded-lg p-3">
                    <p className="text-green-400 text-xs font-bold">Entradas (A-B)</p>
                    <p className="text-3xl font-bold text-green-400">{contagem.entradas}</p>
                  </div>
                  <div className="bg-red-900/40 rounded-lg p-3">
                    <p className="text-red-400 text-xs font-bold">Saidas (B-A)</p>
                    <p className="text-3xl font-bold text-red-400">{contagem.saidas}</p>
                  </div>
                  <div className="bg-blue-900/40 rounded-lg p-3">
                    <p className="text-blue-400 text-xs font-bold">Saldo atual</p>
                    <p className="text-3xl font-bold text-blue-400">{contagem.saldo}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Como usar */}
            <div className="bg-gray-800 rounded-xl p-4">
              <h2 className="font-bold mb-3">Como usar</h2>
              <ol className="space-y-1 text-sm text-gray-400">
                <li><span className="text-blue-400 font-bold">1.</span> Selecione uma camera</li>
                <li><span className="text-blue-400 font-bold">2.</span> Clique em "Desenhar linha"</li>
                <li><span className="text-blue-400 font-bold">3.</span> Clique no ponto A <span className="text-green-400">(verde)</span></li>
                <li><span className="text-blue-400 font-bold">4.</span> Clique no ponto B <span className="text-red-400">(vermelho)</span></li>
                <li><span className="text-blue-400 font-bold">5.</span> Clique em "Salvar linha"</li>
                <li><span className="text-blue-400 font-bold">6.</span> A-B conta como <span className="text-green-400">entrada</span></li>
                <li><span className="text-blue-400 font-bold">7.</span> B-A conta como <span className="text-red-400">saida</span></li>
              </ol>
            </div>
          </div>

          {/* Canvas principal */}
          <div className="col-span-2">
            <div className="bg-gray-800 rounded-xl p-4">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-bold text-lg">
                  {cameraSelecionada ? cameraSelecionada.nome : 'Selecione uma camera'}
                </h2>
                {cameraSelecionada && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => { setDesenhando(true); setLinha(null); setPontoA(null) }}
                      className={`px-4 py-2 rounded-lg font-bold text-sm transition ${
                        desenhando ? 'bg-yellow-600 text-white' : 'bg-gray-700 hover:bg-gray-600 text-white'
                      }`}>
                      {desenhando
                        ? pontoA ? 'Clique no ponto B' : 'Clique no ponto A'
                        : 'Desenhar linha'}
                    </button>
                    {linha && (
                      <>
                        <button onClick={resetarLinha} className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg font-bold text-sm transition text-white">
                          Apagar
                        </button>
                        <button onClick={salvarLinha} disabled={salvando}
                          className="bg-green-600 hover:bg-green-700 disabled:bg-gray-600 px-4 py-2 rounded-lg font-bold text-sm transition text-white">
                          {salvando ? 'Salvando...' : 'Salvar linha'}
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>

              {mensagem && (
                <div className={`mb-3 p-2 rounded-lg text-sm ${mensagem.includes('Erro') ? 'bg-red-900/40 text-red-300' : 'bg-green-900/40 text-green-300'}`}>
                  {mensagem}
                </div>
              )}

              <div className="relative bg-black rounded-lg overflow-hidden" style={{ minHeight: '400px' }}>
                {snapshot ? (
                  <>
                    <img ref={imgRef} src={snapshot} alt="snapshot"
                      style={{position:"absolute",opacity:0,pointerEvents:"none",width:1,height:1}}
                      onLoad={desenharCanvas} />
                    <canvas ref={canvasRef}
                      className={`w-full h-auto ${desenhando ? 'cursor-crosshair' : 'cursor-default'}`}
                      onClick={handleCanvasClick} />
                  </>
                ) : (
                  <div className="flex items-center justify-center h-64 text-gray-500">
                    <div className="text-center">
                      <div className="text-5xl mb-2">[ ]</div>
                      <p>Selecione uma camera para comecar</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
