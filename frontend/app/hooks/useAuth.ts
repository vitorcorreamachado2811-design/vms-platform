'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

export function useAuth() {
  const router = useRouter()
  const [usuario, setUsuario] = useState<any>(null)
  const [carregando, setCarregando] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem('vms_token')
    const usuarioStr = localStorage.getItem('vms_usuario')
    if (!token) {
      router.push('/login')
      return
    }
    if (usuarioStr) setUsuario(JSON.parse(usuarioStr))
    setCarregando(false)
  }, [])

  function logout() {
    localStorage.removeItem('vms_token')
    localStorage.removeItem('vms_usuario')
    router.push('/login')
  }

  return { usuario, carregando, logout }
}