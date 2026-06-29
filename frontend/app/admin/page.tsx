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

export default function AdminPage() {
  const { usuario, carregando } = useAuth()
  const router = useRouter()
  const [convites, setConvites] = useState<Convite[]>([])
  const [empresaId, setEmpresaId] = useState('05e0cea6-ab6d-418d-8cc8-a73e541fc09c')
  const [dias, setDias] = useState(7)
  const [gerando, setGerando] = useState(false)
  const [copiado, setCopiado] = useState<string | null>(null)

  useEffect(() => {
    if (!carregando && usuario?.perfil !== 'admin') router.push('/')
  }, [usuario, carregando])

  async function gerarConvite() {
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
  if (usuario?.perfil !== 'admin') return null

  return (
    <main className="min-h-screen bg-gray-950 text-white p-6">
      <div className="max-w-3xl mx-auto">

        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-blue-400">Painel Admin</h1>
            <p className="text-gray-400 text-sm mt-1">Gerador de convites para novos clientes</p>
          </div>
          <button onClick={() => router.push('/')}
            className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg text-sm font-bold transition">
            ← Voltar
          </button>
        </div>

        {/* Gerador */}
        <div className="bg-gray-900 rounded-2xl p-6 border border-gray-800 mb-6">
          <h2 className="text-lg font-bold mb-4">Gerar novo convite</h2>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="text-gray-400 text-sm mb-1 block">ID da Empresa</label>
              <input
                className="w-full bg-gray-800 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={empresaId}
                onChange={e => setEmpresaId(e.target.value)}
                placeholder="UUID da empresa"
              />
            </div>
            <div>
              <label className="text-gray-400 text-sm mb-1 block">Validade (dias)</label>
              <input
                className="w-full bg-gray-800 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                type="number"
                value={dias}
                onChange={e => setDias(parseInt(e.target.value))}
                min={1}
                max={30}
              />
            </div>
          </div>
          <button onClick={gerarConvite} disabled={gerando}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 text-white py-3 rounded-lg font-bold transition">
            {gerando ? 'Gerando...' : '+ Gerar Convite'}
          </button>
        </div>

        {/* Lista de convites gerados */}
        {convites.length > 0 && (
          <div className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-800">
              <h2 className="text-lg font-bold">Convites gerados nesta sessão</h2>
              <p className="text-gray-500 text-xs mt-1">Os convites são resetados quando o servidor reinicia</p>
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
                    <input
                      readOnly
                      value={c.link}
                      className="flex-1 bg-gray-800 rounded-lg px-3 py-2 text-gray-400 text-xs font-mono"
                    />
                    <button onClick={() => copiar(c.link, c.codigo)}
                      className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg text-sm font-bold transition whitespace-nowrap">
                      {copiado === c.codigo ? '✓ Copiado!' : 'Copiar link'}
                    </button>
                    <button onClick={() => copiar(c.codigo, c.codigo + '_cod')}
                      className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg text-sm font-bold transition whitespace-nowrap">
                      {copiado === c.codigo + '_cod' ? '✓ Copiado!' : 'Copiar código'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {convites.length === 0 && (
          <div className="text-center py-12 text-gray-600">
            Nenhum convite gerado ainda. Clique em "Gerar Convite" para começar.
          </div>
        )}
      </div>
    </main>
  )
}