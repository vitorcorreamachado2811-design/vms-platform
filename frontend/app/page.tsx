'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useAuth } from './hooks/useAuth'
import { useNotificacoes } from './hooks/useNotificacoes'

const API = 'https://vms-platform-production.up.railway.app'

interface Camera {
  id: string
  nome: string
  rtsp_url: string
  http_url?: string
  ativo: boolean
}

interface Empresa {
  id: string
  nome: string
  email: string
}

interface UsuarioItem {
  id: string
  nome: string
  email: string
  perfil: string
  empresa_id: string
}

const MARCAS: Record<string, {
  label: string
  template: (u:string,s:string,ip:string,porta:string,canal:string) => string
  templateHttp?: (u:string,s:string,ip:string,portaHttp:string,canal:string) => string
  portaPadrao: string
  portaHttpPadrao?: string
}> = {
  intelbras: {
    label: 'Intelbras',
    template: (u,s,ip,p,c) => `rtsp://${u}:${s}@${ip}:${p}/cam/realmonitor?channel=${c}&subtype=0`,
    templateHttp: (u,s,ip,p,c) => `http://${u}:${s}@${ip}:${p}/cgi-bin/snapshot.cgi?channel=${c}`,
    portaPadrao: '554', portaHttpPadrao: '80',
  },
  hikvision: {
    label: 'Hikvision',
    template: (u,s,ip,p,c) => `rtsp://${u}:${s}@${ip}:${p}/Streaming/Channels/${c}01`,
    templateHttp: (u,s,ip,p,c) => `http://${u}:${s}@${ip}:${p}/Streaming/channels/${c}01/httpPreview`,
    portaPadrao: '554', portaHttpPadrao: '80',
  },
  dahua: {
    label: 'Dahua',
    template: (u,s,ip,p,c) => `rtsp://${u}:${s}@${ip}:${p}/cam/realmonitor?channel=${c}&subtype=0`,
    templateHttp: (u,s,ip,p,c) => `http://${u}:${s}@${ip}:${p}/cgi-bin/mjpg/video.cgi?channel=${c}&subtype=0`,
    portaPadrao: '554', portaHttpPadrao: '80',
  },
  axis: {
    label: 'Axis',
    template: (u,s,ip,p,c) => `rtsp://${u}:${s}@${ip}:${p}/axis-media/media.amp?camera=${c}`,
    templateHttp: (u,s,ip,p,c) => `http://${u}:${s}@${ip}:${p}/axis-cgi/mjpg/video.cgi?camera=${c}`,
    portaPadrao: '554', portaHttpPadrao: '80',
  },
  generico: { label: 'Genérico (URL livre)', template: () => '', portaPadrao: '554' },
}

const PERFIL_COR: Record<string, string> = {
  admin:    'bg-red-900 text-red-300',
  gestor:   'bg-blue-900 text-blue-300',
  cuidador: 'bg-green-900 text-green-300',
  familiar: 'bg-purple-900 text-purple-300',
}

const PERFIS = ['admin', 'gestor', 'cuidador', 'familiar']

function ModalConfirmar({ nome, onConfirmar, onCancelar, deletando }: {
  nome: string; onConfirmar: () => void; onCancelar: () => void; deletando: boolean
}) {
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-xl p-6 max-w-sm w-full mx-4 shadow-2xl">
        <div className="text-4xl mb-4 text-center">🗑️</div>
        <h2 className="text-xl font-bold text-white text-center mb-2">Deletar câmera?</h2>
        <p className="text-gray-400 text-center mb-6">
          Tem certeza que deseja deletar <span className="text-white font-bold">"{nome}"</span>?
        </p>
        <div className="flex gap-3">
          <button onClick={onCancelar} disabled={deletando} className="flex-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white py-2 rounded-lg font-bold transition">Cancelar</button>
          <button onClick={onConfirmar} disabled={deletando} className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white py-2 rounded-lg font-bold transition flex items-center justify-center gap-2">
            {deletando ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Deletando...</> : 'Deletar'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ModalEditar({ camera, onSalvar, onCancelar, salvando, erro }: {
  camera: Camera; onSalvar: (d: any) => void; onCancelar: () => void; salvando: boolean; erro: string | null
}) {
  const [nome, setNome] = useState(camera.nome)
  const [rtspUrl, setRtspUrl] = useState(camera.rtsp_url)
  const [httpUrl, setHttpUrl] = useState(camera.http_url || '')
  const [ativo, setAtivo] = useState(camera.ativo)
  const [marca, setMarca] = useState('')
  const [camIp, setCamIp] = useState('')
  const [camPorta, setCamPorta] = useState('')
  const [camUsuario, setCamUsuario] = useState('admin')
  const [camSenha, setCamSenha] = useState('')
  const [camCanal, setCamCanal] = useState('1')
  const [camPortaHttp, setCamPortaHttp] = useState('80')

  function gerarUrl() {
    if (!marca || marca === 'generico') return
    const m = MARCAS[marca]
    if (m && camIp) {
      setRtspUrl(m.template(camUsuario, camSenha, camIp, camPorta || m.portaPadrao, camCanal))
      if (m.templateHttp) setHttpUrl(m.templateHttp(camUsuario, camSenha, camIp, camPortaHttp || m.portaHttpPadrao || '80', camCanal))
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-xl p-6 max-w-md w-full shadow-2xl max-h-[90vh] overflow-y-auto">
        <h2 className="text-xl font-bold text-white mb-4">✏️ Editar câmera</h2>
        {erro && <div className="bg-red-900/40 border border-red-500 rounded-lg p-2 mb-3 text-red-300 text-sm">⚠ {erro}</div>}
        <div className="space-y-3">
          <div><label className="text-gray-400 text-xs">Nome</label>
            <input className="w-full bg-gray-700 rounded-lg px-4 py-2 text-white" value={nome} onChange={e => setNome(e.target.value)} /></div>
          <div className="flex items-center justify-between bg-gray-900 rounded-lg p-3">
            <span className="text-gray-300 text-sm font-bold">Câmera ativa</span>
            <button onClick={() => setAtivo(v => !v)} className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 ${ativo ? 'bg-green-500' : 'bg-gray-600'}`}>
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200 ${ativo ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>
          <div className="bg-gray-900 rounded-lg p-3 space-y-2">
            <p className="text-gray-400 text-xs font-bold">Gerar URL de novo (opcional):</p>
            <select className="w-full bg-gray-700 rounded-lg px-3 py-2 text-white text-sm" value={marca}
              onChange={e => { setMarca(e.target.value); setCamPorta(MARCAS[e.target.value]?.portaPadrao || '554'); setCamPortaHttp(MARCAS[e.target.value]?.portaHttpPadrao || '80') }}>
              <option value="">Selecione a marca</option>
              {Object.entries(MARCAS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            {marca && marca !== 'generico' && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <input className="bg-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-400 text-sm" placeholder="IP" value={camIp} onChange={e => { setCamIp(e.target.value); setTimeout(gerarUrl, 0) }} onBlur={gerarUrl} />
                  <input className="bg-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-400 text-sm" placeholder="Porta RTSP" value={camPorta} onChange={e => { setCamPorta(e.target.value); setTimeout(gerarUrl, 0) }} onBlur={gerarUrl} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input className="bg-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-400 text-sm" placeholder="Usuário" value={camUsuario} onChange={e => { setCamUsuario(e.target.value); setTimeout(gerarUrl, 0) }} onBlur={gerarUrl} />
                  <input className="bg-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-400 text-sm" placeholder="Senha" type="password" value={camSenha} onChange={e => { setCamSenha(e.target.value); setTimeout(gerarUrl, 0) }} onBlur={gerarUrl} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input className="bg-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-400 text-sm" placeholder="Canal" value={camCanal} onChange={e => { setCamCanal(e.target.value); setTimeout(gerarUrl, 0) }} onBlur={gerarUrl} />
                  {MARCAS[marca]?.templateHttp && <input className="bg-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-400 text-sm" placeholder="Porta HTTP" value={camPortaHttp} onChange={e => { setCamPortaHttp(e.target.value); setTimeout(gerarUrl, 0) }} onBlur={gerarUrl} />}
                </div>
                <button onClick={gerarUrl} className="w-full bg-gray-700 hover:bg-gray-600 text-white text-xs py-1.5 rounded-lg transition">🔄 Gerar URLs</button>
              </>
            )}
          </div>
          <div><label className="text-gray-400 text-xs">URL RTSP</label>
            <input className="w-full bg-gray-700 rounded-lg px-4 py-2 text-white text-sm font-mono" value={rtspUrl} onChange={e => setRtspUrl(e.target.value)} /></div>
          <div><label className="text-gray-400 text-xs">URL HTTP (opcional)</label>
            <input className="w-full bg-gray-700 rounded-lg px-4 py-2 text-white text-sm font-mono" value={httpUrl} onChange={e => setHttpUrl(e.target.value)} /></div>
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={onCancelar} disabled={salvando} className="flex-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white py-2 rounded-lg font-bold transition">Cancelar</button>
          <button onClick={() => onSalvar({ nome, rtsp_url: rtspUrl, http_url: httpUrl, ativo })} disabled={salvando || !nome || !rtspUrl}
            className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white py-2 rounded-lg font-bold transition flex items-center justify-center gap-2">
            {salvando ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Salvando...</> : '💾 Salvar'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Dashboard() {
  const { usuario, carregando: authCarregando, logout, pode, perfil } = useAuth()
  const { naoLidas, marcarComoLidas } = useNotificacoes(usuario?.empresa_id)
  const [cameras, setCameras]           = useState<Camera[]>([])
  const [empresas, setEmpresas]         = useState<Empresa[]>([])
  const [usuarios, setUsuarios]         = useState<UsuarioItem[]>([])
  const [temposBanheiro, setTemposBanheiro] = useState<Record<string, number>>({})
  const [salvandoTempo, setSalvandoTempo]   = useState<string | null>(null)
  const [nomeCamera, setNomeCamera]     = useState('')
  const [rtspUrl, setRtspUrl]           = useState('')
  const [empresaId, setEmpresaId]       = useState('')
  const [marca, setMarca]               = useState('')
  const [camIp, setCamIp]               = useState('')
  const [camPorta, setCamPorta]         = useState('')
  const [camUsuario, setCamUsuario]     = useState('admin')
  const [camSenha, setCamSenha]         = useState('')
  const [camCanal, setCamCanal]         = useState('1')
  const [camPortaHttp, setCamPortaHttp] = useState('80')
  const [httpUrl, setHttpUrl]           = useState('')
  const [nomeEmpresa, setNomeEmpresa]   = useState('')
  const [emailEmpresa, setEmailEmpresa] = useState('')
  const [aba, setAba]                   = useState('cameras')
  const [cameraParaDeletar, setCameraParaDeletar] = useState<Camera | null>(null)
  const [cameraParaEditar, setCameraParaEditar]   = useState<Camera | null>(null)
  const [editando, setEditando]         = useState(false)
  const [erroEdicao, setErroEdicao]     = useState<string | null>(null)
  const [deletando, setDeletando]       = useState(false)
  const [erro, setErro]                 = useState<string | null>(null)
  const [criando, setCriando]           = useState(false)
  const [empresaParaEditar, setEmpresaParaEditar] = useState<Empresa | null>(null)
  const [editandoEmpresa, setEditandoEmpresa]     = useState(false)
  const [nomeEmpresaEdit, setNomeEmpresaEdit]     = useState('')
  const [emailEmpresaEdit, setEmailEmpresaEdit]   = useState('')

  // Novo usuário
  const [novoNome, setNovoNome]         = useState('')
  const [novoEmail, setNovoEmail]       = useState('')
  const [novaSenha, setNovaSenha]       = useState('')
  const [novoPerfil, setNovoPerfil]     = useState('familiar')
  const [criandoUser, setCriandoUser]   = useState(false)
  const [erroUser, setErroUser]         = useState<string | null>(null)

  useEffect(() => {
    if (!authCarregando && usuario) carregarDados()
  }, [authCarregando, usuario])

  async function carregarDados() {
    try {
      const [c, e] = await Promise.all([
        fetch(`${API}/cameras/?empresa_id=${usuario?.empresa_id}`).then(r => r.json()),
        fetch(`${API}/empresas/`).then(r => r.json()),
      ])
      const cams = Array.isArray(c) ? c : []
      setCameras(cams)
      setEmpresas(Array.isArray(e) ? e : [])
      carregarTemposBanheiro(cams)
    } catch { setCameras([]); setEmpresas([]) }
  }

  async function carregarUsuarios() {
    try {
      const data = await fetch(`${API}/auth/usuarios?empresa_id=${usuario?.empresa_id}`).then(r => r.json())
      setUsuarios(Array.isArray(data) ? data : [])
    } catch {}
  }

  async function carregarTemposBanheiro(cameras: Camera[]) {
    const novos: Record<string, number> = {}
    await Promise.all(cameras.map(async c => {
      try {
        const regioes = await fetch(`${API}/regioes/${c.id}`).then(r => r.json())
        const banheiro = Array.isArray(regioes) ? regioes.find((r: any) => r.tipo === 'banheiro') : null
        if (banheiro) novos[c.id] = banheiro.tempo_alerta_min || 30
      } catch {}
    }))
    setTemposBanheiro(novos)
  }

  async function salvarTempoBanheiro(cameraId: string, minutos: number) {
    setSalvandoTempo(cameraId)
    try {
      const regioes = await fetch(`${API}/regioes/${cameraId}`).then(r => r.json())
      const banheiro = Array.isArray(regioes) ? regioes.find((r: any) => r.tipo === 'banheiro') : null
      if (banheiro?.id) {
        await fetch(`${API}/regioes/${banheiro.id}/tempo`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tempo_alerta_min: minutos })
        })
        setTemposBanheiro(prev => ({ ...prev, [cameraId]: minutos }))
      }
    } catch {} finally { setSalvandoTempo(null) }
  }

  function gerarUrl() {
    if (!marca || marca === 'generico') return
    const m = MARCAS[marca]
    if (m && camIp) {
      setRtspUrl(m.template(camUsuario, camSenha, camIp, camPorta || m.portaPadrao, camCanal))
      if (m.templateHttp) setHttpUrl(m.templateHttp(camUsuario, camSenha, camIp, camPortaHttp || m.portaHttpPadrao || '80', camCanal))
    }
  }

  function onMarcaChange(m: string) {
    setMarca(m); setCamPorta(MARCAS[m]?.portaPadrao || '554')
    setCamPortaHttp(MARCAS[m]?.portaHttpPadrao || '80'); setRtspUrl(''); setHttpUrl('')
  }

  async function criarCamera() {
    if (!nomeCamera || !rtspUrl || !empresaId) return
    setCriando(true); setErro(null)
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 10000)
      const res = await fetch(`${API}/cameras/`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: nomeCamera, rtsp_url: rtspUrl, http_url: httpUrl || null, empresa_id: empresaId }),
        signal: controller.signal,
      })
      clearTimeout(timeout)
      if (!res.ok) throw new Error('Erro ao cadastrar câmera')
      setNomeCamera(''); setRtspUrl(''); setEmpresaId('')
      await carregarDados()
    } catch (e: any) {
      setErro(e.name === 'AbortError' ? 'Timeout — tente novamente' : 'Erro ao cadastrar câmera')
    } finally { setCriando(false) }
  }

  async function criarEmpresa() {
    if (!nomeEmpresa || !emailEmpresa) return
    setErro(null)
    try {
      await fetch(`${API}/empresas/`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nome: nomeEmpresa, email: emailEmpresa }) })
      setNomeEmpresa(''); setEmailEmpresa('')
      await carregarDados()
    } catch { setErro('Erro ao cadastrar empresa') }
  }

  async function deletarEmpresa(id: string) {
    try {
      await fetch(`${API}/empresas/${id}`, { method: 'DELETE' })
      setEmpresas(prev => prev.filter(e => e.id !== id))
    } catch { setErro('Erro ao deletar empresa') }
  }

  async function editarEmpresa() {
    if (!empresaParaEditar || !nomeEmpresaEdit || !emailEmpresaEdit) return
    setEditandoEmpresa(true)
    try {
      const res = await fetch(`${API}/empresas/${empresaParaEditar.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: nomeEmpresaEdit, email: emailEmpresaEdit }),
      })
      if (!res.ok) throw new Error('Erro ao editar empresa')
      const atualizada = await res.json()
      setEmpresas(prev => prev.map(e => e.id === atualizada.id ? atualizada : e))
      setEmpresaParaEditar(null)
    } catch { setErro('Erro ao editar empresa') }
    finally { setEditandoEmpresa(false) }
  }

  async function criarUsuario() {
    if (!novoNome || !novoEmail || !novaSenha) return
    setCriandoUser(true); setErroUser(null)
    try {
      const res = await fetch(`${API}/auth/registrar`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: novoNome, email: novoEmail, senha: novaSenha, empresa_id: usuario?.empresa_id, perfil: novoPerfil }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || 'Erro ao criar usuário')
      }
      setNovoNome(''); setNovoEmail(''); setNovaSenha(''); setNovoPerfil('familiar')
      await carregarUsuarios()
    } catch (e: any) { setErroUser(e.message) }
    finally { setCriandoUser(false) }
  }

  async function deletarUsuarioItem(id: string) {
    try {
      await fetch(`${API}/auth/usuarios/${id}`, { method: 'DELETE' })
      setUsuarios(prev => prev.filter(u => u.id !== id))
    } catch {}
  }

  async function deletarCamera(camera: Camera) {
    setDeletando(true); setErro(null)
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 8000)
      const res = await fetch(`${API}/cameras/remover`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ camera_id: camera.id }), signal: controller.signal,
      })
      clearTimeout(timeout)
      if (!res.ok) throw new Error('Erro ao deletar')
      setCameras(prev => prev.filter(c => c.id !== camera.id))
      setCameraParaDeletar(null)
    } catch (e: any) {
      setErro(e.name === 'AbortError' ? 'Timeout ao deletar — tente novamente' : 'Erro ao deletar câmera')
      setCameraParaDeletar(null)
    } finally { setDeletando(false) }
  }

  async function editarCamera(dados: any) {
    if (!cameraParaEditar) return
    setEditando(true); setErroEdicao(null)
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 10000)
      const res = await fetch(`${API}/cameras/${cameraParaEditar.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: dados.nome, rtsp_url: dados.rtsp_url, http_url: dados.http_url || null, ativo: dados.ativo }),
        signal: controller.signal,
      })
      clearTimeout(timeout)
      if (!res.ok) throw new Error('Erro ao editar')
      const atualizada = await res.json()
      setCameras(prev => prev.map(c => c.id === atualizada.id ? atualizada : c))
      setCameraParaEditar(null)
    } catch (e: any) { setErroEdicao(e.name === 'AbortError' ? 'Timeout' : 'Erro ao editar câmera') }
    finally { setEditando(false) }
  }

  if (authCarregando) return (
    <main className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
    </main>
  )

  return (
    <main className="min-h-screen bg-gray-950 text-white p-8">
      <div className="max-w-6xl mx-auto">

        {cameraParaDeletar && <ModalConfirmar nome={cameraParaDeletar.nome} onConfirmar={() => deletarCamera(cameraParaDeletar)} onCancelar={() => !deletando && setCameraParaDeletar(null)} deletando={deletando} />}
        {cameraParaEditar && <ModalEditar camera={cameraParaEditar} onSalvar={editarCamera} onCancelar={() => !editando && (setCameraParaEditar(null), setErroEdicao(null))} salvando={editando} erro={erroEdicao} />}

        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-blue-400">VMS Platform</h1>
            <p className="text-gray-400 mt-1">Sistema de monitoramento com IA</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {usuario && (
              <div className="flex items-center gap-2">
                <span className="text-gray-400 text-sm hidden md:block">👤 {usuario.nome}</span>
                <span className={`text-xs px-2 py-1 rounded-full font-bold ${PERFIL_COR[perfil] || 'bg-gray-700 text-gray-300'}`}>{perfil.toUpperCase()}</span>
              </div>
            )}
            <Link href="/cameras" className="bg-gray-700 hover:bg-gray-600 px-3 py-2 rounded-lg font-bold transition text-sm">📷 Ao Vivo</Link>
            {pode.verContagem && <Link href="/contagem" className="bg-gray-700 hover:bg-gray-600 px-3 py-2 rounded-lg font-bold transition text-sm">📊 Contagem</Link>}
            {pode.verHeatmap && <Link href="/heatmap" className="bg-gray-700 hover:bg-gray-600 px-3 py-2 rounded-lg font-bold transition text-sm">🌡️ Heatmap</Link>}
            <Link href="/eventos" onClick={marcarComoLidas}
              className="relative bg-blue-600 hover:bg-blue-700 px-3 py-2 rounded-lg font-bold transition text-sm">
              ⚡ Eventos
              {naoLidas > 0 && (
                <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-xs w-5 h-5 rounded-full flex items-center justify-center font-bold animate-pulse">
                  {naoLidas > 9 ? '9+' : naoLidas}
                </span>
              )}
            </Link>
            <Link href="/habitos" className="bg-purple-600 hover:bg-purple-700 px-3 py-2 rounded-lg font-bold transition text-sm">🏃 Hábitos</Link>
            <button onClick={logout} className="bg-red-900 hover:bg-red-800 px-3 py-2 rounded-lg font-bold transition text-red-300 text-sm">Sair</button>
          </div>
        </div>

        {erro && (
          <div className="bg-red-900/40 border border-red-500 rounded-xl p-4 mb-6 flex items-center justify-between">
            <span className="text-red-300">⚠️ {erro}</span>
            <button onClick={() => setErro(null)} className="text-red-400 hover:text-red-300 text-xl">×</button>
          </div>
        )}

        {/* Cards resumo */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          <div className="bg-gray-800 rounded-xl p-4"><p className="text-gray-400 text-sm">Câmeras</p><p className="text-3xl font-bold text-blue-400">{cameras.length}</p></div>
          <div className="bg-gray-800 rounded-xl p-4"><p className="text-gray-400 text-sm">Empresas</p><p className="text-3xl font-bold text-green-400">{empresas.length}</p></div>
          <div className="bg-gray-800 rounded-xl p-4"><p className="text-gray-400 text-sm">Status</p><p className="text-3xl font-bold text-green-400">Online</p></div>
        </div>

        {/* Abas */}
        <div className="flex gap-2 mb-6">
          <button onClick={() => setAba('cameras')} className={`px-6 py-2 rounded-lg font-bold transition ${aba === 'cameras' ? 'bg-blue-600' : 'bg-gray-800 hover:bg-gray-700'}`}>Câmeras</button>
          {pode.cadastrarEmpresa && <button onClick={() => setAba('empresas')} className={`px-6 py-2 rounded-lg font-bold transition ${aba === 'empresas' ? 'bg-green-600' : 'bg-gray-800 hover:bg-gray-700'}`}>Empresas</button>}
          {pode.gerenciarUsuarios && <button onClick={() => { setAba('usuarios'); carregarUsuarios() }} className={`px-6 py-2 rounded-lg font-bold transition ${aba === 'usuarios' ? 'bg-orange-600' : 'bg-gray-800 hover:bg-gray-700'}`}>👥 Usuários</button>}
        </div>

        {/* Aba Cameras */}
        {aba === 'cameras' && (
          <div className={`grid gap-8 ${pode.cadastrarCamera ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {pode.cadastrarCamera && (
              <div className="bg-gray-800 rounded-xl p-6">
                <h2 className="text-xl font-bold mb-4">Cadastrar Câmera</h2>
                <div className="space-y-3">
                  <input className="w-full bg-gray-700 rounded-lg px-4 py-2 text-white placeholder-gray-400" placeholder="Nome da câmera" value={nomeCamera} onChange={e => setNomeCamera(e.target.value)} />
                  <select className="w-full bg-gray-700 rounded-lg px-4 py-2 text-white" value={marca} onChange={e => onMarcaChange(e.target.value)}>
                    <option value="">Selecione a marca</option>
                    {Object.entries(MARCAS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select>
                  {marca && marca !== 'generico' && (
                    <div className="bg-gray-900 rounded-lg p-3 space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <input className="bg-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-400 text-sm" placeholder="IP" value={camIp} onChange={e => { setCamIp(e.target.value); setTimeout(gerarUrl, 0) }} onBlur={gerarUrl} />
                        <input className="bg-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-400 text-sm" placeholder="Porta" value={camPorta} onChange={e => { setCamPorta(e.target.value); setTimeout(gerarUrl, 0) }} onBlur={gerarUrl} />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <input className="bg-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-400 text-sm" placeholder="Usuário" value={camUsuario} onChange={e => { setCamUsuario(e.target.value); setTimeout(gerarUrl, 0) }} onBlur={gerarUrl} />
                        <input className="bg-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-400 text-sm" placeholder="Senha" type="password" value={camSenha} onChange={e => { setCamSenha(e.target.value); setTimeout(gerarUrl, 0) }} onBlur={gerarUrl} />
                      </div>
                      <input className="bg-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-400 text-sm w-full" placeholder="Canal (ex: 1)" value={camCanal} onChange={e => { setCamCanal(e.target.value); setTimeout(gerarUrl, 0) }} onBlur={gerarUrl} />
                      {MARCAS[marca]?.templateHttp && (
                        <div className="flex items-center gap-2">
                          <input className="bg-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-400 text-sm flex-1" placeholder="Porta HTTP" value={camPortaHttp} onChange={e => { setCamPortaHttp(e.target.value); setTimeout(gerarUrl, 0) }} onBlur={gerarUrl} />
                          <span className="text-gray-400 text-xs">porta HTTP ao vivo</span>
                        </div>
                      )}
                    </div>
                  )}
                  <div>
                    <input className="w-full bg-gray-700 rounded-lg px-4 py-2 text-white placeholder-gray-400 text-sm font-mono" placeholder="URL RTSP" value={rtspUrl} onChange={e => setRtspUrl(e.target.value)} />
                    {rtspUrl && <p className="text-green-400 text-xs mt-1 px-1">✓ URL RTSP pronta</p>}
                    {httpUrl && <><input className="w-full bg-gray-700 rounded-lg px-4 py-2 text-white placeholder-gray-400 text-sm font-mono mt-2" placeholder="URL HTTP ao vivo" value={httpUrl} onChange={e => setHttpUrl(e.target.value)} /><p className="text-blue-400 text-xs mt-1 px-1">📹 URL HTTP ao vivo pronta</p></>}
                  </div>
                  <select className="w-full bg-gray-700 rounded-lg px-4 py-2 text-white" value={empresaId} onChange={e => setEmpresaId(e.target.value)}>
                    <option value="">Selecione a empresa</option>
                    {empresas.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
                  </select>
                  <button onClick={criarCamera} disabled={criando || !nomeCamera || !rtspUrl || !empresaId}
                    className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg px-4 py-2 font-bold transition flex items-center justify-center gap-2">
                    {criando ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Cadastrando...</> : '+ Cadastrar Câmera'}
                  </button>
                </div>
              </div>
            )}

            <div className="bg-gray-800 rounded-xl p-6">
              <h2 className="text-xl font-bold mb-4">Câmeras Cadastradas</h2>
              {cameras.length === 0 ? <p className="text-gray-400">Nenhuma câmera cadastrada ainda.</p> : (
                <div className="space-y-3">
                  {cameras.map(c => (
                    <div key={c.id} className="bg-gray-700 rounded-lg p-3">
                      <div className="flex items-center justify-between">
                        <span className="font-bold">{c.nome}</span>
                        <div className="flex items-center gap-2">
                          <span className={`text-xs px-2 py-1 rounded-full ${c.ativo ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'}`}>{c.ativo ? 'Ativa' : 'Inativa'}</span>
                          {pode.editarCamera && <button onClick={() => setCameraParaEditar(c)} className="text-gray-400 hover:text-blue-400 transition text-lg">✏️</button>}
                          {pode.deletarCamera && <button onClick={() => setCameraParaDeletar(c)} className="text-gray-400 hover:text-red-400 transition text-lg">🗑️</button>}
                        </div>
                      </div>
                      <p className="text-gray-400 text-sm mt-1 truncate">{c.rtsp_url}</p>
                      <p className="text-gray-500 text-xs mt-1 font-mono">{c.id}</p>
                      {pode.editarCamera && (
                        <div className="flex items-center gap-2 mt-2">
                          <span className="text-gray-400 text-xs">🚿 Alerta banheiro:</span>
                          <input type="number" min={1} max={120} value={temposBanheiro[c.id] ?? 30} onChange={e => setTemposBanheiro(prev => ({ ...prev, [c.id]: Number(e.target.value) }))} className="w-16 bg-gray-600 rounded px-2 py-1 text-white text-xs text-center" />
                          <span className="text-gray-400 text-xs">min</span>
                          <button onClick={() => salvarTempoBanheiro(c.id, temposBanheiro[c.id] ?? 30)} disabled={salvandoTempo === c.id} className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white text-xs px-2 py-1 rounded transition">
                            {salvandoTempo === c.id ? '...' : 'Salvar'}
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Aba Empresas */}
        {aba === 'empresas' && pode.cadastrarEmpresa && (
          <div className="grid grid-cols-2 gap-8">
            <div className="bg-gray-800 rounded-xl p-6">
              <h2 className="text-xl font-bold mb-4">Cadastrar Empresa</h2>
              <div className="space-y-3">
                <input className="w-full bg-gray-700 rounded-lg px-4 py-2 text-white placeholder-gray-400" placeholder="Nome da empresa" value={nomeEmpresa} onChange={e => setNomeEmpresa(e.target.value)} />
                <input className="w-full bg-gray-700 rounded-lg px-4 py-2 text-white placeholder-gray-400" placeholder="Email da empresa" value={emailEmpresa} onChange={e => setEmailEmpresa(e.target.value)} />
                <button onClick={criarEmpresa} className="w-full bg-green-600 hover:bg-green-700 rounded-lg px-4 py-2 font-bold transition">+ Cadastrar Empresa</button>
              </div>
            </div>
            <div className="bg-gray-800 rounded-xl p-6">
              <h2 className="text-xl font-bold mb-4">Empresas Cadastradas</h2>
              {empresas.length === 0 ? <p className="text-gray-400">Nenhuma empresa cadastrada ainda.</p> : (
                <div className="space-y-3">
                  {empresas.map(e => (
                    <div key={e.id} className="bg-gray-700 rounded-lg p-3">
                      {empresaParaEditar?.id === e.id ? (
                        <div className="space-y-2">
                          <input className="w-full bg-gray-600 rounded-lg px-3 py-1.5 text-white text-sm" value={nomeEmpresaEdit} onChange={ev => setNomeEmpresaEdit(ev.target.value)} />
                          <input className="w-full bg-gray-600 rounded-lg px-3 py-1.5 text-white text-sm" value={emailEmpresaEdit} onChange={ev => setEmailEmpresaEdit(ev.target.value)} />
                          <div className="flex gap-2">
                            <button onClick={editarEmpresa} disabled={editandoEmpresa} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-xs py-1.5 rounded-lg transition font-bold">
                              {editandoEmpresa ? '...' : '💾 Salvar'}
                            </button>
                            <button onClick={() => setEmpresaParaEditar(null)} className="flex-1 bg-gray-600 hover:bg-gray-500 text-white text-xs py-1.5 rounded-lg transition">Cancelar</button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-bold">{e.nome}</p>
                            <p className="text-gray-400 text-sm">{e.email}</p>
                          </div>
                          <div className="flex gap-2">
                            <button onClick={() => { setEmpresaParaEditar(e); setNomeEmpresaEdit(e.nome); setEmailEmpresaEdit(e.email) }}
                              className="text-gray-400 hover:text-blue-400 transition text-lg" title="Editar">✏️</button>
                            <button onClick={() => deletarEmpresa(e.id)}
                              className="text-gray-400 hover:text-red-400 transition text-lg" title="Deletar">🗑️</button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Aba Usuários — só admin */}
        {aba === 'usuarios' && pode.gerenciarUsuarios && (
          <div className="grid grid-cols-2 gap-8">
            {/* Formulário novo usuário */}
            <div className="bg-gray-800 rounded-xl p-6">
              <h2 className="text-xl font-bold mb-4">👤 Criar Usuário</h2>
              {erroUser && <div className="bg-red-900/40 border border-red-500 rounded-lg p-2 mb-3 text-red-300 text-sm">⚠ {erroUser}</div>}
              <div className="space-y-3">
                <input className="w-full bg-gray-700 rounded-lg px-4 py-2 text-white placeholder-gray-400" placeholder="Nome completo" value={novoNome} onChange={e => setNovoNome(e.target.value)} />
                <input className="w-full bg-gray-700 rounded-lg px-4 py-2 text-white placeholder-gray-400" placeholder="Email" type="email" value={novoEmail} onChange={e => setNovoEmail(e.target.value)} />
                <input className="w-full bg-gray-700 rounded-lg px-4 py-2 text-white placeholder-gray-400" placeholder="Senha" type="password" value={novaSenha} onChange={e => setNovaSenha(e.target.value)} />
                <div>
                  <label className="text-gray-400 text-xs mb-1 block">Perfil de acesso</label>
                  <div className="grid grid-cols-2 gap-2">
                    {PERFIS.map(p => (
                      <button key={p} onClick={() => setNovoPerfil(p)}
                        className={`py-2 px-3 rounded-lg text-sm font-bold transition border-2 ${novoPerfil === p ? 'text-white border-transparent' : 'bg-gray-700 text-gray-400 border-gray-600'}`}
                        style={novoPerfil === p ? { backgroundColor: p === 'admin' ? '#991b1b' : p === 'gestor' ? '#1e3a8a' : p === 'cuidador' ? '#14532d' : '#581c87' } : {}}>
                        {p.toUpperCase()}
                      </button>
                    ))}
                  </div>
                  <div className="mt-2 p-2 bg-gray-900 rounded-lg text-xs text-gray-400">
                    {novoPerfil === 'admin' && '🔑 Acesso total — pode cadastrar câmeras, usuários e empresas'}
                    {novoPerfil === 'gestor' && '📊 Vê tudo incluindo heatmap e contagem, mas não edita'}
                    {novoPerfil === 'cuidador' && '👁️ Vê câmeras, eventos e hábitos'}
                    {novoPerfil === 'familiar' && '❤️ Acesso básico — câmeras, eventos e hábitos'}
                  </div>
                </div>
                <button onClick={criarUsuario} disabled={criandoUser || !novoNome || !novoEmail || !novaSenha}
                  className="w-full bg-orange-600 hover:bg-orange-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg px-4 py-2 font-bold transition flex items-center justify-center gap-2">
                  {criandoUser ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Criando...</> : '+ Criar Usuário'}
                </button>
              </div>
            </div>

            {/* Lista de usuários */}
            <div className="bg-gray-800 rounded-xl p-6">
              <h2 className="text-xl font-bold mb-4">Usuários da Empresa</h2>
              {usuarios.length === 0 ? <p className="text-gray-400">Nenhum usuário encontrado.</p> : (
                <div className="space-y-3">
                  {usuarios.map(u => (
                    <div key={u.id} className="bg-gray-700 rounded-lg p-3 flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-white">{u.nome}</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${PERFIL_COR[u.perfil] || 'bg-gray-600 text-gray-300'}`}>{u.perfil.toUpperCase()}</span>
                        </div>
                        <p className="text-gray-400 text-sm">{u.email}</p>
                      </div>
                      {u.id !== usuario?.id && (
                        <button onClick={() => deletarUsuarioItem(u.id)} className="text-gray-400 hover:text-red-400 transition text-lg" title="Deletar usuário">🗑️</button>
                      )}
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