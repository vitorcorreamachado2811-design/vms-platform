'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function Login() {
  const router = useRouter()
  const [aba, setAba] = useState<'login' | 'registrar'>('login')
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [nome, setNome] = useState('')
  const [erro, setErro] = useState('')
  const [carregando, setCarregando] = useState(false)

  async function fazerLogin() {
    setErro('')
    setCarregando(true)
    try {
      const res = await fetch('http://localhost:8000/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, senha })
      })
      const data = await res.json()
      if (!res.ok) {
        setErro(data.detail || 'Erro ao fazer login')
        return
      }
      localStorage.setItem('token', data.token)
      localStorage.setItem('usuario', JSON.stringify(data.usuario))
      router.push('/')
    } catch {
      setErro('Erro ao conectar com o servidor')
    } finally {
      setCarregando(false)
    }
  }

  return (
    <main className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="bg-gray-800 rounded-2xl p-8 w-full max-w-md">

        {/* Logo */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-blue-400">🎥 VMS Platform</h1>
          <p className="text-gray-400 mt-1">Sistema de monitoramento com IA</p>
        </div>

        {/* Tabs */}
        <div className="flex mb-6 bg-gray-900 rounded-lg p-1">
          <button
            onClick={() => setAba('login')}
            className={`flex-1 py-2 rounded-md font-bold transition ${aba === 'login' ? 'bg-blue-600 text-white' : 'text-gray-400'}`}
          >
            Entrar
          </button>
          <button
            onClick={() => setAba('registrar')}
            className={`flex-1 py-2 rounded-md font-bold transition ${aba === 'registrar' ? 'bg-blue-600 text-white' : 'text-gray-400'}`}
          >
            Criar conta
          </button>
        </div>

        {/* Erro */}
        {erro && (
          <div className="bg-red-900 text-red-300 rounded-lg px-4 py-2 mb-4 text-sm">
            {erro}
          </div>
        )}

        {/* Login */}
        {aba === 'login' && (
          <div className="space-y-4">
            <div>
              <label className="text-gray-400 text-sm">Email</label>
              <input
                className="w-full bg-gray-700 rounded-lg px-4 py-3 text-white mt-1 placeholder-gray-500"
                placeholder="seu@email.com"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
              />
            </div>
            <div>
              <label className="text-gray-400 text-sm">Senha</label>
              <input
                className="w-full bg-gray-700 rounded-lg px-4 py-3 text-white mt-1 placeholder-gray-500"
                placeholder="••••••••"
                type="password"
                value={senha}
                onChange={e => setSenha(e.target.value)}
              />
            </div>
            <button
              onClick={fazerLogin}
              disabled={carregando}
              className="w-full bg-blue-600 hover:bg-blue-700 rounded-lg px-4 py-3 font-bold transition disabled:opacity-50"
            >
              {carregando ? 'Entrando...' : 'Entrar'}
            </button>
          </div>
        )}

        {/* Registrar */}
        {aba === 'registrar' && (
          <div className="space-y-4">
            <div>
              <label className="text-gray-400 text-sm">Nome</label>
              <input
                className="w-full bg-gray-700 rounded-lg px-4 py-3 text-white mt-1 placeholder-gray-500"
                placeholder="Seu nome"
                value={nome}
                onChange={e => setNome(e.target.value)}
              />
            </div>
            <div>
              <label className="text-gray-400 text-sm">Email</label>
              <input
                className="w-full bg-gray-700 rounded-lg px-4 py-3 text-white mt-1 placeholder-gray-500"
                placeholder="seu@email.com"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
              />
            </div>
            <div>
              <label className="text-gray-400 text-sm">Senha</label>
              <input
                className="w-full bg-gray-700 rounded-lg px-4 py-3 text-white mt-1 placeholder-gray-500"
                placeholder="••••••••"
                type="password"
                value={senha}
                onChange={e => setSenha(e.target.value)}
              />
            </div>
            <p className="text-gray-500 text-sm text-center">
              Para registrar use a API em{' '}
              <a href="http://localhost:8000/docs" target="_blank" className="text-blue-400 underline">
                localhost:8000/docs
              </a>
            </p>
          </div>
        )}

      </div>
    </main>
  )
}