import React, { createContext, useContext, useEffect, useState } from "react"
import * as SecureStore from "expo-secure-store"

const API = "https://vms-platform-production.up.railway.app"

interface Usuario {
  id: string; nome: string; email: string; empresa_id: string; role: string
}
interface AuthContextType {
  usuario: Usuario | null; token: string | null
  login: (email: string, senha: string) => Promise<string | null>
  logout: () => void; carregando: boolean
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(true)

  useEffect(() => {
    async function restaurar() {
      try {
        const t = await SecureStore.getItemAsync("token")
        const u = await SecureStore.getItemAsync("usuario")
        if (t && u) { setToken(t); setUsuario(JSON.parse(u)) }
      } catch {}
      setCarregando(false)
    }
    restaurar()
  }, [])

  async function login(email: string, senha: string): Promise<string | null> {
    try {
      const res = await fetch(`${API}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, senha }),
      })
      if (!res.ok) return "Email ou senha incorretos"
      const data = await res.json()
      await SecureStore.setItemAsync("token", data.token)
      await SecureStore.setItemAsync("usuario", JSON.stringify(data.usuario))
      setToken(data.token); setUsuario(data.usuario)
      return null
    } catch { return "Erro de conexao. Tente novamente." }
  }

  async function logout() {
    await SecureStore.deleteItemAsync("token")
    await SecureStore.deleteItemAsync("usuario")
    setToken(null); setUsuario(null)
  }

  return (
    <AuthContext.Provider value={{ usuario, token, login, logout, carregando }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() { return useContext(AuthContext) }
