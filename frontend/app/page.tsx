'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useAuth } from './hooks/useAuth'

const API = 'https://vms-platform-production.up.railway.app'

interface Camera {
  id: string
  nome: string
  rtsp_url: string
  ativo: boolean
}

interface Empresa {
  id: string
  nome: string
  email: string
}

function ModalConfirmar({
  nome,
  onConfirmar,
  onCancelar,
  deletando,
}: {
  nome: string
  onConfirmar: () => void
  onCancelar: () => void
  deletando: boolean
}) {
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-xl p-6 max-w-sm w-full mx-4 shadow-2xl">
        <div className="text-4xl mb-4 text-center">🗑️</div>
        <h2 className="text-xl font-bold text-white text-center mb-2">Deletar câmera?</h2>
        <p className="text-gray-400 text-center mb-6">
          Tem certeza que deseja deletar <span className="text-white font-bold">"{nome}"</span>? Esta ação não pode ser desfeita.
        </p>
        <div className="flex gap-3">
          <button
            onClick={onCancelar}
            disabled={deletando}
            className="flex-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white py-2 rounded-lg font-bold transition"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirmar}
            disabled={deletando}
            className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white py-2 rounded-lg font-bold transition flex items-center justify-center gap-2"
          >
            {deletando ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Deletando...
              </>
            ) : 'Deletar'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Dashboard() {
  const { usuario, carregando: authCarregando, logout } = useAuth()
  const [cameras, setCameras] = useState<Camera[]>([])
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [nomeCamera, setNomeCamera] = useState('')
  const [rtspUrl, setRtspUrl] = useState('')
  const [empresaId, setEmpresaId] = useState('')
  const [marca, setMarca] = useState('')
  const [camIp, setCamIp] = useState('')
  const [camPorta, setCamPorta] = useState('')
  const [camUsuario, setCamUsuario] = useState('admin')
  const [camSenha, setCamSenha] = useState('')
  const [camCanal, setCamCanal] = useState('1')
  const [nomeEmpresa, setNomeEmpresa] = useState('')
  const [emailEmpresa, setEmailEmpresa] = useState('')
  const [aba, setAba] = useState('cameras')
  const [cameraParaDeletar, setCameraParaDeletar] = useState<Camera | null>(null)
  const [deletando, setDeletando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [criando, setCriando] = useState(false)

  useEffect(() => {
    if (!authCarregando) carregarDados()
  }, [authCarregando])

  async function carregarDados() {
    try {
      const [c, e] = await Promise.all([
        fetch(`${API}/cameras/`).then(r => r.json()),
        fetch(`${API}/empresas/`).then(r => r.json()),
      ])
      setCameras(Array.isArray(c) ? c : [])
      setEmpresas(Array.isArray(e) ? e : [])
    } catch {
      setCameras([])
      setEmpresas([])
    }
  }

  const MARCAS: Record<string, { label: string; template: (u:string,s:string,ip:string,porta:string,canal:string) => string; portaPadrao: string }> = {
    intelbras: {
      label: 'Intelbras',
      template: (u,s,ip,p,c) => `rtsp://${u}:${s}@${ip}:${p}/cam/realmonitor?channel=${c}&subtype=0`,
      portaPadrao: '554',
    },
    hikvision: {
      label: 'Hikvision',
      template: (u,s,ip,p,c) => `rtsp://${u}:${s}@${ip}:${p}/Streaming/Channels/${c}01`,
      portaPadrao: '554',
    },
    dahua: {
      label: 'Dahua',
      template: (u,s,ip,p,c) => `rtsp://${u}:${s}@${ip}:${p}/cam/realmonitor?channel=${c}&subtype=0`,
      portaPadrao: '554',
    },
    axis: {
      label: 'Axis',
      template: (u,s,ip,p,c) => `rtsp://${u}:${s}@${ip}:${p}/axis-media/media.amp?camera=${c}`,
      portaPadrao: '554',
    },
    generico: {
      label: 'Genérico (URL livre)',
      template: () => '',
      portaPadrao: '554',
    },
  }

  function gerarUrl() {
    if (!marca || marca === 'generico') return
    const m = MARCAS[marca]
    if (m && camIp) {
      setRtspUrl(m.template(camUsuario, camSenha, camIp, camPorta || m.portaPadrao, camCanal))
    }
  }

  function onMarcaChange(m: string) {
    setMarca(m)
    setCamPorta(MARCAS[m]?.portaPadrao || '554')
    setRtspUrl('')
  }

  async function criarCamera() {
    if (!nomeCamera || !rtspUrl || !empresaId) return
    setCriando(true)
    setErro(null)
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 10000)
      const res = await fetch(`${API}/cameras/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: nomeCamera, rtsp_url: rtspUrl, empresa_id: empresaId }),
        signal: controller.signal,
      })
      clearTimeout(timeout)
      if (!res.ok) throw new Error('Erro ao cadastrar câmera')
      setNomeCamera(''); setRtspUrl(''); setEmpresaId('')
      await carregarDados()
    } catch (e: any) {
      setErro(e.name === 'AbortError' ? 'Timeout — tente novamente' : 'Erro ao cadastrar câmera')
    } finally {
      setCriando(false)
    }
  }

  async function criarEmpresa() {
    if (!nomeEmpresa || !emailEmpresa) return
    setErro(null)
    try {
      await fetch(`${API}/empresas/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: nomeEmpresa, email: emailEmpresa })
      })
      setNomeEmpresa(''); setEmailEmpresa('')
      await carregarDados()
    } catch {
      setErro('Erro ao cadastrar empresa')
    }
  }

  async function deletarCamera(camera: Camera) {
    setDeletando(true)
    setErro(null)
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 8000) // timeout 8s
      const res = await fetch(`${API}/cameras/remover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ camera_id: camera.id }),
        signal: controller.signal,
      })
      clearTimeout(timeout)
      if (!res.ok) throw new Error('Erro ao deletar')
      // Remove da lista imediatamente sem precisar recarregar
      setCameras(prev => prev.filter(c => c.id !== camera.id))
      setCameraParaDeletar(null)
    } catch (e: any) {
      setErro(e.name === 'AbortError' ? 'Timeout ao deletar — tente novamente' : 'Erro ao deletar câmera')
      setCameraParaDeletar(null)
    } finally {
      setDeletando(false)
    }
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
      <div className="max-w-6xl mx-auto">

        {cameraParaDeletar && (
          <ModalConfirmar
            nome={cameraParaDeletar.nome}
            onConfirmar={() => deletarCamera(cameraParaDeletar)}
            onCancelar={() => !deletando && setCameraParaDeletar(null)}
            deletando={deletando}
          />
        )}

        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-blue-400">VMS Platform</h1>
            <p className="text-gray-400 mt-1">Sistema de monitoramento com IA</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {usuario && (
              <span className="text-gray-400 text-sm hidden md:block">👤 {usuario.nome}</span>
            )}
            <Link href="/cameras" className="bg-gray-700 hover:bg-gray-600 px-3 py-2 rounded-lg font-bold transition text-sm">
              📷 Ao Vivo
            </Link>
            <Link href="/contagem" className="bg-gray-700 hover:bg-gray-600 px-3 py-2 rounded-lg font-bold transition text-sm">
              📊 Contagem
            </Link>
            <Link href="/heatmap" className="bg-gray-700 hover:bg-gray-600 px-3 py-2 rounded-lg font-bold transition text-sm">
              🌡️ Heatmap
            </Link>
            <Link href="/eventos" className="bg-blue-600 hover:bg-blue-700 px-3 py-2 rounded-lg font-bold transition text-sm">
              ⚡ Eventos
            </Link>
            <Link href="/habitos" className="bg-purple-600 hover:bg-purple-700 px-3 py-2 rounded-lg font-bold transition text-sm">
              🏃 Hábitos
            </Link>
            <button
              onClick={logout}
              className="bg-red-900 hover:bg-red-800 px-3 py-2 rounded-lg font-bold transition text-red-300 text-sm"
            >
              Sair
            </button>
          </div>
        </div>

        {/* Erro global */}
        {erro && (
          <div className="bg-red-900/40 border border-red-500 rounded-xl p-4 mb-6 flex items-center justify-between">
            <span className="text-red-300">⚠️ {erro}</span>
            <button onClick={() => setErro(null)} className="text-red-400 hover:text-red-300 text-xl">×</button>
          </div>
        )}

        {/* Cards resumo */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          <div className="bg-gray-800 rounded-xl p-4">
            <p className="text-gray-400 text-sm">Câmeras</p>
            <p className="text-3xl font-bold text-blue-400">{cameras.length}</p>
          </div>
          <div className="bg-gray-800 rounded-xl p-4">
            <p className="text-gray-400 text-sm">Empresas</p>
            <p className="text-3xl font-bold text-green-400">{empresas.length}</p>
          </div>
          <div className="bg-gray-800 rounded-xl p-4">
            <p className="text-gray-400 text-sm">Status</p>
            <p className="text-3xl font-bold text-green-400">Online</p>
          </div>
        </div>

        {/* Abas */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setAba('cameras')}
            className={`px-6 py-2 rounded-lg font-bold transition ${aba === 'cameras' ? 'bg-blue-600' : 'bg-gray-800 hover:bg-gray-700'}`}
          >
            Câmeras
          </button>
          <button
            onClick={() => setAba('empresas')}
            className={`px-6 py-2 rounded-lg font-bold transition ${aba === 'empresas' ? 'bg-green-600' : 'bg-gray-800 hover:bg-gray-700'}`}
          >
            Empresas
          </button>
        </div>

        {/* Aba Cameras */}
        {aba === 'cameras' && (
          <div className="grid grid-cols-2 gap-8">
            <div className="bg-gray-800 rounded-xl p-6">
              <h2 className="text-xl font-bold mb-4">Cadastrar Câmera</h2>
              <div className="space-y-3">
                <input
                  className="w-full bg-gray-700 rounded-lg px-4 py-2 text-white placeholder-gray-400"
                  placeholder="Nome da câmera"
                  value={nomeCamera}
                  onChange={e => setNomeCamera(e.target.value)}
                />

                {/* Seletor de marca */}
                <select
                  className="w-full bg-gray-700 rounded-lg px-4 py-2 text-white"
                  value={marca}
                  onChange={e => onMarcaChange(e.target.value)}
                >
                  <option value="">Selecione a marca</option>
                  {Object.entries(MARCAS).map(([k, v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                </select>

                {/* Campos específicos por marca */}
                {marca && marca !== 'generico' && (
                  <div className="bg-gray-900 rounded-lg p-3 space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        className="bg-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-400 text-sm"
                        placeholder="IP (ex: 192.168.1.100)"
                        value={camIp}
                        onChange={e => { setCamIp(e.target.value); setTimeout(gerarUrl, 0) }}
                        onBlur={gerarUrl}
                      />
                      <input
                        className="bg-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-400 text-sm"
                        placeholder="Porta"
                        value={camPorta}
                        onChange={e => { setCamPorta(e.target.value); setTimeout(gerarUrl, 0) }}
                        onBlur={gerarUrl}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        className="bg-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-400 text-sm"
                        placeholder="Usuário"
                        value={camUsuario}
                        onChange={e => { setCamUsuario(e.target.value); setTimeout(gerarUrl, 0) }}
                        onBlur={gerarUrl}
                      />
                      <input
                        className="bg-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-400 text-sm"
                        placeholder="Senha"
                        type="password"
                        value={camSenha}
                        onChange={e => { setCamSenha(e.target.value); setTimeout(gerarUrl, 0) }}
                        onBlur={gerarUrl}
                      />
                    </div>
                    <input
                      className="bg-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-400 text-sm w-full"
                      placeholder="Canal (ex: 1)"
                      value={camCanal}
                      onChange={e => { setCamCanal(e.target.value); setTimeout(gerarUrl, 0) }}
                      onBlur={gerarUrl}
                    />
                  </div>
                )}

                {/* URL gerada ou livre */}
                <div>
                  <input
                    className="w-full bg-gray-700 rounded-lg px-4 py-2 text-white placeholder-gray-400 text-sm font-mono"
                    placeholder="URL RTSP (gerada automaticamente ou cole aqui)"
                    value={rtspUrl}
                    onChange={e => setRtspUrl(e.target.value)}
                  />
                  {rtspUrl && (
                    <p className="text-green-400 text-xs mt-1 px-1">✓ URL pronta</p>
                  )}
                </div>
                <select
                  className="w-full bg-gray-700 rounded-lg px-4 py-2 text-white"
                  value={empresaId}
                  onChange={e => setEmpresaId(e.target.value)}
                >
                  <option value="">Selecione a empresa</option>
                  {empresas.map(e => (
                    <option key={e.id} value={e.id}>{e.nome}</option>
                  ))}
                </select>
                <button
                  onClick={criarCamera}
                  disabled={criando || !nomeCamera || !rtspUrl || !empresaId}
                  className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg px-4 py-2 font-bold transition flex items-center justify-center gap-2"
                >
                  {criando ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Cadastrando...
                    </>
                  ) : '+ Cadastrar Câmera'}
                </button>
              </div>
            </div>

            <div className="bg-gray-800 rounded-xl p-6">
              <h2 className="text-xl font-bold mb-4">Câmeras Cadastradas</h2>
              {cameras.length === 0 ? (
                <p className="text-gray-400">Nenhuma câmera cadastrada ainda.</p>
              ) : (
                <div className="space-y-3">
                  {cameras.map(c => (
                    <div key={c.id} className="bg-gray-700 rounded-lg p-3">
                      <div className="flex items-center justify-between">
                        <span className="font-bold">{c.nome}</span>
                        <div className="flex items-center gap-2">
                          <span className={`text-xs px-2 py-1 rounded-full ${c.ativo ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'}`}>
                            {c.ativo ? 'Ativa' : 'Inativa'}
                          </span>
                          <button
                            onClick={() => setCameraParaDeletar(c)}
                            className="text-gray-400 hover:text-red-400 transition text-lg"
                            title="Deletar câmera"
                          >
                            🗑️
                          </button>
                        </div>
                      </div>
                      <p className="text-gray-400 text-sm mt-1 truncate">{c.rtsp_url}</p>
                      <p className="text-gray-500 text-xs mt-1 font-mono">{c.id}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Aba Empresas */}
        {aba === 'empresas' && (
          <div className="grid grid-cols-2 gap-8">
            <div className="bg-gray-800 rounded-xl p-6">
              <h2 className="text-xl font-bold mb-4">Cadastrar Empresa</h2>
              <div className="space-y-3">
                <input
                  className="w-full bg-gray-700 rounded-lg px-4 py-2 text-white placeholder-gray-400"
                  placeholder="Nome da empresa"
                  value={nomeEmpresa}
                  onChange={e => setNomeEmpresa(e.target.value)}
                />
                <input
                  className="w-full bg-gray-700 rounded-lg px-4 py-2 text-white placeholder-gray-400"
                  placeholder="Email da empresa"
                  value={emailEmpresa}
                  onChange={e => setEmailEmpresa(e.target.value)}
                />
                <button
                  onClick={criarEmpresa}
                  className="w-full bg-green-600 hover:bg-green-700 rounded-lg px-4 py-2 font-bold transition"
                >
                  + Cadastrar Empresa
                </button>
              </div>
            </div>

            <div className="bg-gray-800 rounded-xl p-6">
              <h2 className="text-xl font-bold mb-4">Empresas Cadastradas</h2>
              {empresas.length === 0 ? (
                <p className="text-gray-400">Nenhuma empresa cadastrada ainda.</p>
              ) : (
                <div className="space-y-3">
                  {empresas.map(e => (
                    <div key={e.id} className="bg-gray-700 rounded-lg p-3">
                      <p className="font-bold">{e.nome}</p>
                      <p className="text-gray-400 text-sm">{e.email}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

      </div>
    </main>
  )
}
