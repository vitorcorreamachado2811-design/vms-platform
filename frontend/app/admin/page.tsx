'use client'
import { useEffect, useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { useRouter } from 'next/navigation'

const API = 'https://vms-platform-production.up.railway.app'

interface Convite {
  codigo: string
  empresa_nome: string
  expira_em: string
  link: string
}

interface Empresa {
  id: string
  nome: string
  email: string
}

export default function AdminPage() {
  const { usuario, carregando } = useAuth()
  const router = useRouter()
  const [convites, setConvites] = useState<Convite[]>([])
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [empresaId, setEmpresaId] = useState('')
  const [novaEmpresaNome, setNovaEmpresaNome] = useState('')
  const [novaEmpresaEmail, setNovaEmpresaEmail] = useState('')
  const [dias, setDias] = useState(7)
  const [gerando, setGerando] = useState(false)
  const [criandoEmpresa, setCriandoEmpresa] = useState(false)
  const [copiado, setCopiado] = useState<string | null>(null)
  const [aba, setAba] = useState<'convites' | 'empresas'>('convites')

  useEffect(() => {
    if (!carregando && usuario?.perfil !== 'superadmin') router.push('/')
  }, [usuario, carregando])

  useEffect(() => {
    buscarEmpresas()
  }, [])

  async function buscarEmpresas() {
    try {
      const res = await fetch(`${API}/empresas/`)
      const data = await res.json()
      setEmpresas(Array.isArray(data) ? data : [])
      if (data.length > 0) setEmpresaId(data[0].id)
    } catch (e) {}
  }

  async function criarEmpresa() {
    if (!novaEmpresaNome || !novaEmpresaEmail) return
    setCriandoEmpresa(true)
    try {
      const res = await fetch(`${API}/empresas/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: novaEmpresaNome, email: novaEmpresaEmail })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail)
      setNovaEmpresaNome('')
      setNovaEmpresaEmail('')
      await buscarEmpresas()
      setEmpresaId(data.id)
      setAba('convites')
    } catch (e: any) {
      alert('Erro: ' + e.message)
    } finally {
      setCriandoEmpresa(false)
    }
  }

  async function gerarConvite() {
    if (!empresaId) { alert('Selecione uma empresa'); return }
    setGerando(true)
    try {
      const res = await fetch(`${API}/auth/convite/gerar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empresa_id: empresaId, dias_validade: dias })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail)
      setConvites(prev => [data, ...prev])
    } catch (e: any) {
      alert('Erro: ' + e.message)
    } finally {
      setGerando(false)
    }
  }

  function copiar(texto: string, id: string) {
    navigator.clipboard.writeText(texto)
    setCopiado(id)
    setTimeout(() => setCopiado(null), 2000)
  }

  function expirado(expira: string) {
    return new Date(expira) < new Date()
  }

  if (carregando) return null
  if (usuario?.perfil !== 'superadmin') return null

  return (
    <main className="min-h-screen bg-gray-950 text-white p-6">
      <div className="max-w-3xl mx-auto">

        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-blue-400">Painel Admin</h1>
            <p className="text-gray-400 text-sm mt-1">Gerencie empresas e convites</p>
          </div>
          <button onClick={() => router.push('/')}
            className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg text-sm font-bold transition">
            ← Voltar
          </button>
        </div>

        {/* Abas */}
        <div className="flex gap-2 mb-6">
          <button onClick={() => setAba('convites')}
            className={`px-4 py-2 rounded-lg font-bold text-sm transition ${aba === 'convites' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>
            🔗 Convites
          </button>
          <button onClick={() => setAba('empresas')}
            className={`px-4 py-2 rounded-lg font-bold text-sm transition ${aba === 'empresas' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>
            🏢 Nova Empresa
          </button>
        </div>

        {aba === 'empresas' && (
          <div className="bg-gray-900 rounded-2xl p-6 border border-gray-800 mb-6">
            <h2 className="text-lg font-bold mb-4">Cadastrar nova empresa</h2>
            <div className="space-y-4">
              <div>
                <label className="text-gray-400 text-sm mb-1 block">Nome da empresa</label>
                <input className="w-full bg-gray-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Ex: Restaurante Silva" value={novaEmpresaNome}
                  onChange={e => setNovaEmpresaNome(e.target.value)} />
              </div>
              <div>
                <label className="text-gray-400 text-sm mb-1 block">Email do responsável</label>
                <input className="w-full bg-gray-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="email@empresa.com" type="email" value={novaEmpresaEmail}
                  onChange={e => setNovaEmpresaEmail(e.target.value)} />
              </div>
              <button onClick={criarEmpresa} disabled={criandoEmpresa || !novaEmpresaNome || !novaEmpresaEmail}
                className="w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-700 text-white py-3 rounded-lg font-bold transition">
                {criandoEmpresa ? 'Criando...' : '+ Criar Empresa'}
              </button>
            </div>

            {/* Lista de empresas */}
            <div className="mt-6">
              <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wide mb-3">Empresas cadastradas</h3>
              <div className="space-y-2">
                {empresas.map(e => (
                  <div key={e.id} className="bg-gray-800 rounded-lg px-4 py-3 flex items-center justify-between">
                    <div>
                      <div className="text-white font-medium">{e.nome}</div>
                      <div className="text-gray-500 text-xs">{e.email}</div>
                    </div>
                    <button onClick={() => { setEmpresaId(e.id); setAba('convites') }}
                      className="bg-blue-700 hover:bg-blue-600 px-3 py-1 rounded-lg text-xs font-bold transition">
                      Gerar convite →
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {aba === 'convites' && (
          <>
            <div className="bg-gray-900 rounded-2xl p-6 border border-gray-800 mb-6">
              <h2 className="text-lg font-bold mb-4">Gerar convite</h2>
              <div className="space-y-4">
                <div>
                  <label className="text-gray-400 text-sm mb-1 block">Empresa</label>
                  <select className="w-full bg-gray-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={empresaId} onChange={e => setEmpresaId(e.target.value)}>
                    <option value="">Selecione uma empresa</option>
                    {empresas.map(e => (
                      <option key={e.id} value={e.id}>{e.nome}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-gray-400 text-sm mb-1 block">Validade (dias)</label>
                  <input className="w-full bg-gray-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    type="number" value={dias} onChange={e => setDias(parseInt(e.target.value))} min={1} max={30} />
                </div>
                <button onClick={gerarConvite} disabled={gerando || !empresaId}
                  className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 text-white py-3 rounded-lg font-bold transition">
                  {gerando ? 'Gerando...' : '+ Gerar Convite'}
                </button>
              </div>
            </div>

            {convites.length > 0 && (
              <div className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-800">
                  <h2 className="text-lg font-bold">Convites gerados</h2>
                  <p className="text-gray-500 text-xs mt-1">⚠ Resetam quando o servidor reinicia — envie o link imediatamente</p>
                </div>
                <div className="divide-y divide-gray-800">
                  {convites.map(c => (
                    <div key={c.codigo} className="px-6 py-4">
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <span className="text-white font-bold font-mono text-lg tracking-widest">{c.codigo}</span>
                          <span className="ml-3 text-gray-400 text-sm">{c.empresa_nome}</span>
                        </div>
                        <span className={`text-xs px-2 py-1 rounded-full font-bold ${expirado(c.expira_em) ? 'bg-red-900 text-red-300' : 'bg-green-900 text-green-300'}`}>
                          {expirado(c.expira_em) ? 'Expirado' : `Válido até ${new Date(c.expira_em).toLocaleDateString('pt-BR')}`}
                        </span>
                      </div>
                      <div className="flex gap-2">
                        <input readOnly value={c.link}
                          className="flex-1 bg-gray-800 rounded-lg px-3 py-2 text-gray-400 text-xs font-mono" />
                        <button onClick={() => copiar(c.link, c.codigo)}
                          className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg text-sm font-bold transition whitespace-nowrap">
                          {copiado === c.codigo ? '✓ Copiado!' : 'Copiar link'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {convites.length === 0 && (
              <div className="text-center py-12 text-gray-600">
                Selecione uma empresa e clique em "Gerar Convite".
              </div>
            )}
          </>
        )}
      </div>
    </main>
  )
}