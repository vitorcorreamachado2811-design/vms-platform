'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

const API = 'https://vms-platform-production.up.railway.app'

export default function Login() {
  const router = useRouter()
  const [aba, setAba] = useState<'login' | 'registrar'>('login')
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState('')
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [nomeReg, setNomeReg] = useState('')
  const [emailReg, setEmailReg] = useState('')
  const [senhaReg, setSenhaReg] = useState('')
  const [empresaIdReg, setEmpresaIdReg] = useState('')
  const [empresas, setEmpresas] = useState<{ id: string; nome: string }[]>([])

  useEffect(() => {
    const token = localStorage.getItem('vms_token')
    if (token) router.push('/')
  }, [])

  useEffect(() => {
    if (aba === 'registrar') {
      fetch(`${API}/empresas/`)
        .then(r => r.json())
        .then(data => setEmpresas(Array.isArray(data) ? data : []))
        .catch(() => setEmpresas([]))
    }
  }, [aba])

  async function fazerLogin() {
    if (!email || !senha) return
    setCarregando(true)
    setErro('')
    try {
      const res = await fetch(`${API}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, senha })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Erro ao fazer login')
      localStorage.setItem('vms_token', data.token)
      localStorage.setItem('vms_usuario', JSON.stringify(data.usuario))
      router.push('/')
    } catch (err: any) {
      setErro(err.message)
    } finally {
      setCarregando(false)
    }
  }

  async function fazerRegistro() {
    if (!nomeReg || !emailReg || !senhaReg || !empresaIdReg) {
      setErro('Preencha todos os campos')
      return
    }
    setCarregando(true)
    setErro('')
    try {
      const res = await fetch(`${API}/auth/registrar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: nomeReg, email: emailReg, senha: senhaReg, empresa_id: empresaIdReg })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Erro ao registrar')
      setAba('login')
      setEmail(emailReg)
      setSenha('')
      setErro('')
    } catch (err: any) {
      setErro(err.message)
    } finally {
      setCarregando(false)
    }
  }

  return (
    <main className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-blue-400">VMS Platform</h1>
          <p className="text-gray-400 mt-2">Sistema de monitoramento com IA</p>
        </div>
        <div className="bg-gray-800 rounded-2xl p-8 shadow-2xl">
          <div className="flex gap-2 mb-6">
            <button
              onClick={() => { setAba('login'); setErro('') }}
              className={`flex-1 py-2 rounded-lg font-bold transition ${aba === 'login' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'}`}
            >
              Entrar
            </button>
            <button
              onClick={() => { setAba('registrar'); setErro('') }}
              className={`flex-1 py-2 rounded-lg font-bold transition ${aba === 'registrar' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'}`}
            >
              Criar conta
            </button>
          </div>

          {erro && (
            <div className="bg-red-900/50 border border-red-500 text-red-300 px-4 py-3 rounded-lg mb-4 text-sm">
              ⚠ {erro}
            </div>
          )}

          {aba === 'login' && (
            <div className="space-y-4">
              <div>
                <label className="text-gray-400 text-sm mb-1 block">Email</label>
                <input
                  className="w-full bg-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="seu@email.com"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && fazerLogin()}
                />
              </div>
              <div>
                <label className="text-gray-400 text-sm mb-1 block">Senha</label>
                <input
                  className="w-full bg-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="••••••••"
                  type="password"
                  value={senha}
                  onChange={e => setSenha(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && fazerLogin()}
                />
              </div>
              <button
                onClick={fazerLogin}
                disabled={carregando}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white py-3 rounded-lg font-bold transition"
              >
                {carregando ? 'Entrando...' : 'Entrar'}
              </button>
            </div>
          )}

          {aba === 'registrar' && (
            <div className="space-y-4">
              <div>
                <label className="text-gray-400 text-sm mb-1 block">Nome</label>
                <input
                  className="w-full bg-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Seu nome"
                  value={nomeReg}
                  onChange={e => setNomeReg(e.target.value)}
                />
              </div>
              <div>
                <label className="text-gray-400 text-sm mb-1 block">Email</label>
                <input
                  className="w-full bg-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="seu@email.com"
                  type="email"
                  value={emailReg}
                  onChange={e => setEmailReg(e.target.value)}
                />
              </div>
              <div>
                <label className="text-gray-400 text-sm mb-1 block">Senha</label>
                <input
                  className="w-full bg-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="••••••••"
                  type="password"
                  value={senhaReg}
                  onChange={e => setSenhaReg(e.target.value)}
                />
              </div>
              <div>
                <label className="text-gray-400 text-sm mb-1 block">Empresa</label>
                <select
                  className="w-full bg-gray-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={empresaIdReg}
                  onChange={e => setEmpresaIdReg(e.target.value)}
                >
                  <option value="">Selecione a empresa</option>
                  {empresas.map(e => (
                    <option key={e.id} value={e.id}>{e.nome}</option>
                  ))}
                </select>
              </div>
              <button
                onClick={fazerRegistro}
                disabled={carregando}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white py-3 rounded-lg font-bold transition"
              >
                {carregando ? 'Criando conta...' : 'Criar conta'}
              </button>
            </div>
          )}
        </div>
      </div>
    </main>
  )
}