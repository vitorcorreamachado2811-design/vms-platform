'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

export type Perfil = 'admin' | 'gestor' | 'cuidador' | 'familiar'

export interface Usuario {
  id: string
  nome: string
  email: string
  empresa_id: string
  perfil: Perfil
}

export interface Permissoes {
  verCameras: boolean
  verEventos: boolean
  verHabitos: boolean
  verHeatmap: boolean
  verContagem: boolean
  cadastrarCamera: boolean
  editarCamera: boolean
  deletarCamera: boolean
  configurarAnaliticos: boolean
  cadastrarEmpresa: boolean
  gerenciarUsuarios: boolean
}

const PERMISSOES_POR_PERFIL: Record<Perfil, Permissoes> = {
  admin: {
    verCameras: true, verEventos: true, verHabitos: true,
    verHeatmap: true, verContagem: true, cadastrarCamera: true,
    editarCamera: true, deletarCamera: true, configurarAnaliticos: true,
    cadastrarEmpresa: true, gerenciarUsuarios: true,
  },
  gestor: {
    verCameras: true, verEventos: true, verHabitos: true,
    verHeatmap: true, verContagem: true, cadastrarCamera: false,
    editarCamera: false, deletarCamera: false, configurarAnaliticos: false,
    cadastrarEmpresa: false, gerenciarUsuarios: false,
  },
  cuidador: {
    verCameras: true, verEventos: true, verHabitos: true,
    verHeatmap: false, verContagem: false, cadastrarCamera: false,
    editarCamera: false, deletarCamera: false, configurarAnaliticos: false,
    cadastrarEmpresa: false, gerenciarUsuarios: false,
  },
  familiar: {
    verCameras: true, verEventos: true, verHabitos: true,
    verHeatmap: false, verContagem: false, cadastrarCamera: false,
    editarCamera: false, deletarCamera: false, configurarAnaliticos: false,
    cadastrarEmpresa: false, gerenciarUsuarios: false,
  },
}

export function useAuth() {
  const router = useRouter()
  const [usuario, setUsuario] = useState<Usuario | null>(null)
  const [carregando, setCarregando] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem('vms_token')
    const usuarioStr = localStorage.getItem('vms_usuario')
    if (!token) {
      router.push('/login')
      return
    }
    if (usuarioStr) {
      try { setUsuario(JSON.parse(usuarioStr)) } catch {}
    }
    setCarregando(false)
  }, [])

  function logout() {
    localStorage.removeItem('vms_token')
    localStorage.removeItem('vms_usuario')
    router.push('/login')
  }

  const perfil: Perfil = (usuario?.perfil as Perfil) || 'familiar'
  const pode: Permissoes = PERMISSOES_POR_PERFIL[perfil]

  return { usuario, carregando, logout, pode, perfil }
}