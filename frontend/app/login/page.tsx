'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

const API = 'https://vms-platform-production.up.railway.app'

export default function Login() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [aba, setAba] = useState<'login' | 'registrar'>('login')
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState('')
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [nomeReg, setNomeReg] = useState('')
  const [emailReg, setEmailReg] = useState('')
  const [senhaReg, setSenhaReg] = useState('')
  const [convite, setConvite] = useState('')
  const [empresaNome, setEmpresaNome] = useState('')
  const [conviteValido, setConviteValido] = useState(false)
  const [verificandoConvite, setVerificandoConvite] = useState(false)

  useEffect(() => {
    const token = localStorage.getItem('vms_token')
    if (token) router.push('/')
  }, [])

  useEffect(() => {
    const codigo = searchParams.get('convite')
    if (codigo) {
      setConvite(codigo.toUpperCase())
      setAba('registrar')
      verificarConvite(codigo.toUpperCase())
    }
  }, [searchParams])

  async function verificarConvite(codigo: string) {
    if (!codigo || codigo.length < 6) return
    setVerificandoConvite(true)
    setErro('')
    try {
      const res = await fetch(`${API}/auth/convite/${codigo}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Convite invalido')
      setEmpresaNome(data.empresa_nome)
      setConviteValido(true)
    } catch (err: any) {
      setErro(err.message)
      setConviteValido(false)
      setEmpresaNome('')
    } finally {
      setVerificandoConvite(false)
    }
  }

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
    if (!nomeReg || !emailReg || !senhaReg) {
      setErro('Preencha todos os campos')
      return
    }
    if (!conviteValido) {
      setErro('Codigo de convite invalido ou expirado')
      return
    }
    setCarregando(true)
    setErro('')
    try {
      const res = await fetch(`${API}/auth/registrar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome: nomeReg,
          email: emailReg,
          senha: senhaReg,
          empresa_id: '00000000-0000-0000-0000-000000000000', // sera substituido pelo convite
          convite: convite,
        })
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
            <button onClick={() => { setAba('login'); setErro('') }}
              className={`flex-1 py-2 rounded-lg font-bold transition ${aba === 'login' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'}`}>
              Entrar
            </button>
            <button onClick={() => { setAba('registrar'); setErro('') }}
              className={`flex-1 py-2 rounded-lg font-bold transition ${aba === 'registrar' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'}`}>
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
                <input className="w-full bg-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="seu@email.com" type="email" value={email}
                  onChange={e => setEmail(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && fazerLogin()} />
              </div>
              <div>
                <label className="text-gray-400 text-sm mb-1 block">Senha</label>
                <input className="w-full bg-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="••••••••" type="password" value={senha}
                  onChange={e => setSenha(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && fazerLogin()} />
              </div>
              <button onClick={fazerLogin} disabled={carregando}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white py-3 rounded-lg font-bold transition">
                {carregando ? 'Entrando...' : 'Entrar'}
              </button>
            </div>
          )}

          {aba === 'registrar' && (
            <div className="space-y-4">

              {/* Codigo de convite */}
              <div>
                <label className="text-gray-400 text-sm mb-1 block">Código de convite</label>
                <div className="flex gap-2">
                  <input
                    className={`flex-1 bg-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 font-mono tracking-widest uppercase ${conviteValido ? 'focus:ring-green-500 border border-green-600' : 'focus:ring-blue-500'}`}
                    placeholder="Ex: 6FDWDEA2"
                    value={convite}
                    onChange={e => {
                      const v = e.target.value.toUpperCase()
                      setConvite(v)
                      setConviteValido(false)
                      setEmpresaNome('')
                      if (v.length >= 6) verificarConvite(v)
                    }}
                    maxLength={8}
                  />
                  {verificandoConvite && (
                    <div className="flex items-center px-3 text-gray-400 text-sm">...</div>
                  )}
                </div>
                {conviteValido && (
                  <div className="mt-2 flex items-center gap-2 text-green-400 text-sm">
                    <span>✓</span>
                    <span>Convite válido — <b>{empresaNome}</b></span>
                  </div>
                )}
              </div>

              <div>
                <label className="text-gray-400 text-sm mb-1 block">Nome</label>
                <input className="w-full bg-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Seu nome" value={nomeReg} onChange={e => setNomeReg(e.target.value)} />
              </div>
              <div>
                <label className="text-gray-400 text-sm mb-1 block">Email</label>
                <input className="w-full bg-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="seu@email.com" type="email" value={emailReg} onChange={e => setEmailReg(e.target.value)} />
              </div>
              <div>
                <label className="text-gray-400 text-sm mb-1 block">Senha</label>
                <input className="w-full bg-gray-700 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="••••••••" type="password" value={senhaReg} onChange={e => setSenhaReg(e.target.value)} />
              </div>

              <button onClick={fazerRegistro} disabled={carregando || !conviteValido}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white py-3 rounded-lg font-bold transition">
                {carregando ? 'Criando conta...' : 'Criar conta'}
              </button>

              {!conviteValido && (
                <p className="text-center text-gray-500 text-xs">
                  Você precisa de um código de convite para criar uma conta.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  )
}