'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://wqoekhbwdrgryahoyjuo.supabase.co'
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

const EVENTOS_CRITICOS = ['queda_leito', 'queda_pe', 'gesto_socorro']

export interface Notificacao {
  id: string
  tipo: string
  camera_id: string
  criado_em: string
  critico: boolean
}

function tocarSom(critico: boolean) {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
    
    if (critico) {
      // Som de alarme — 3 bips rápidos agudos
      ;[0, 0.2, 0.4].forEach(delay => {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.frequency.value = 880
        osc.type = 'square'
        gain.gain.setValueAtTime(0.3, ctx.currentTime + delay)
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.15)
        osc.start(ctx.currentTime + delay)
        osc.stop(ctx.currentTime + delay + 0.15)
      })
    } else {
      // Som suave — 1 bip grave
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.frequency.value = 440
      osc.type = 'sine'
      gain.gain.setValueAtTime(0.2, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3)
      osc.start(ctx.currentTime)
      osc.stop(ctx.currentTime + 0.3)
    }
  } catch (e) {
    // Browser bloqueou audio — silencioso
  }
}

export function useNotificacoes(empresaId?: string) {
  const [notificacoes, setNotificacoes] = useState<Notificacao[]>([])
  const [naoLidas, setNaoLidas]         = useState(0)
  const supabaseRef = useRef<any>(null)
  const channelRef  = useRef<any>(null)

  const marcarComoLidas = useCallback(() => {
    setNaoLidas(0)
  }, [])

  useEffect(() => {
    if (!empresaId || !SUPABASE_KEY) return

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
    supabaseRef.current = supabase

    // Escuta INSERT na tabela eventos
    const channel = supabase
      .channel('eventos-realtime')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'eventos',
        },
        async (payload: any) => {
          const evento = payload.new

          // Busca a câmera para verificar empresa_id
          try {
            const { data: camera } = await supabase
              .from('cameras')
              .select('empresa_id')
              .eq('id', evento.camera_id)
              .single()

            if (!camera || camera.empresa_id !== empresaId) return
          } catch {
            return
          }

          const critico = EVENTOS_CRITICOS.includes(evento.tipo)

          const nova: Notificacao = {
            id:        evento.id,
            tipo:      evento.tipo,
            camera_id: evento.camera_id,
            criado_em: evento.criado_em,
            critico,
          }

          setNotificacoes(prev => [nova, ...prev].slice(0, 50))
          setNaoLidas(prev => prev + 1)
          tocarSom(critico)
        }
      )
      .subscribe()

    channelRef.current = channel

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
      }
    }
  }, [empresaId])

  return { notificacoes, naoLidas, marcarComoLidas }
}