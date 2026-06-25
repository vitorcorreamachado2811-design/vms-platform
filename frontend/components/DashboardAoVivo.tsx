'use client'
import { useEffect, useRef, useState, useCallback } from 'react'

const API = process.env.NEXT_PUBLIC_API_URL || 'https://vms-platform-production.up.railway.app'

const CAMERAS: Record<string, string> = {
  '53db3fd2-d6b6-4dff-b8f1-169ca2b866d6': 'estacionamento',
  'da512062-2fa8-450c-96d8-9817d85ead7f': 'bar',
  '6ee2c5a7-42e0-4b1c-9551-91d40141a9e1': 'salao',
  '610e1f97-01ff-434f-9a1e-45bca046b41f': 'deck',
  '855f39dc-e141-4730-bcf0-2e6db2df9707': 'matinho',
}

const TIPO_CONFIG: Record<string, { label: string; cor: string; icone: string }> = {
  entrada:    { label: 'Entrada',    cor: '#22c55e', icone: '↗' },
  saida:      { label: 'Saída',      cor: '#ef4444', icone: '↙' },
  queda_pe:   { label: 'Queda',      cor: '#f59e0b', icone: '⚠' },
  queda_leito:{ label: 'Queda Leito',cor: '#f59e0b', icone: '⚠' },
  person:     { label: 'Pessoa',     cor: '#3b82f6', icone: '👤' },
}

interface Evento {
  id: string
  camera_id: string
  tipo: string
  confianca: number
  criado_em: string
  video_url: string | null
}

interface Contagem {
  entradas: number
  saidas: number
  dentro: number
}

export function DashboardAoVivo() {
  const [eventos, setEventos] = useState<Evento[]>([])
  const [contagem, setContagem] = useState<Record<string, Contagem>>({})
  const [totalHoje, setTotalHoje] = useState({ entradas: 0, saidas: 0, alertas: 0 })
  const [novoEvento, setNovoEvento] = useState<Evento | null>(null)
  const [videoAberto, setVideoAberto] = useState<string | null>(null)
  const ultimoIdRef = useRef<string | null>(null)
  const intervalRef = useRef<any>(null)

  const nomeCamara = (id: string) => CAMERAS[id] || id.slice(0, 8)

  const buscarEventos = useCallback(async () => {
    try {
      const hoje = new Date().toISOString().split('T')[0]
      const res = await fetch(`${API}/eventos/?limit=50`)
      if (!res.ok) return
      const data: Evento[] = await res.json()
      if (data.length > 0 && data[0].id !== ultimoIdRef.current) {
        if (ultimoIdRef.current !== null) {
          setNovoEvento(data[0])
          setTimeout(() => setNovoEvento(null), 4000)
        }
        ultimoIdRef.current = data[0].id
      }
      setEventos(data)
      const hojeEventos = data.filter(e => e.criado_em.startsWith(hoje))
      setTotalHoje({
        entradas: hojeEventos.filter(e => e.tipo === 'entrada').length,
        saidas:   hojeEventos.filter(e => e.tipo === 'saida').length,
        alertas:  hojeEventos.filter(e => !['entrada','saida'].includes(e.tipo)).length,
      })
      const contagens: Record<string, Contagem> = {}
      for (const id of Object.keys(CAMERAS)) {
        const evCam = hojeEventos.filter(e => e.camera_id === id)
        const entradas = evCam.filter(e => e.tipo === 'entrada').length
        const saidas   = evCam.filter(e => e.tipo === 'saida').length
        contagens[id] = { entradas, saidas, dentro: Math.max(0, entradas - saidas) }
      }
      setContagem(contagens)
    } catch (e) {
      console.error('[Dashboard] Erro:', e)
    }
  }, [])

  useEffect(() => {
    buscarEventos()
    intervalRef.current = setInterval(buscarEventos, 10000)
    return () => clearInterval(intervalRef.current)
  }, [buscarEventos])

  const horaFormatada = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }

  const ultimosEventos = eventos.slice(0, 8)

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif' }}>
      {novoEvento && (
        <div style={{
          position: 'fixed', top: 20, right: 20, zIndex: 10000,
          background: TIPO_CONFIG[novoEvento.tipo]?.cor || '#6b7280',
          color: '#fff', borderRadius: 12, padding: '14px 20px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          animation: 'slideIn 0.3s ease',
          display: 'flex', alignItems: 'center', gap: 10, maxWidth: 320,
        }}>
          <style>{`@keyframes slideIn { from { transform: translateX(100px); opacity: 0 } to { transform: translateX(0); opacity: 1 } }`}</style>
          <span style={{ fontSize: 20 }}>{TIPO_CONFIG[novoEvento.tipo]?.icone || '🔔'}</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13 }}>{TIPO_CONFIG[novoEvento.tipo]?.label || novoEvento.tipo} detectado</div>
            <div style={{ fontSize: 12, opacity: 0.9 }}>{nomeCamara(novoEvento.camera_id)} · {horaFormatada(novoEvento.criado_em)}</div>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
        {[
          { label: 'Entradas hoje', valor: totalHoje.entradas, cor: '#22c55e', icone: '↗' },
          { label: 'Saídas hoje',   valor: totalHoje.saidas,   cor: '#ef4444', icone: '↙' },
          { label: 'Alertas hoje',  valor: totalHoje.alertas,  cor: '#f59e0b', icone: '⚠' },
        ].map(card => (
          <div key={card.label} style={{
            background: '#111827', borderRadius: 12, padding: '16px 20px',
            border: `1px solid ${card.cor}30`,
          }}>
            <div style={{ color: card.cor, fontSize: 22, marginBottom: 4 }}>{card.icone}</div>
            <div style={{ color: '#fff', fontSize: 28, fontWeight: 700 }}>{card.valor}</div>
            <div style={{ color: '#6b7280', fontSize: 12 }}>{card.label}</div>
          </div>
        ))}
      </div>

      <div style={{ background: '#111827', borderRadius: 12, padding: 16, marginBottom: 16, border: '1px solid #1f2937' }}>
        <div style={{ color: '#9ca3af', fontSize: 12, fontWeight: 600, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 }}>
          Pessoas dentro agora (estimativa)
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
          {Object.entries(CAMERAS).map(([id, nome]) => {
            const c = contagem[id] || { entradas: 0, saidas: 0, dentro: 0 }
            return (
              <div key={id} style={{ background: '#1f2937', borderRadius: 8, padding: '10px 12px', textAlign: 'center' }}>
                <div style={{ color: '#fff', fontSize: 20, fontWeight: 700 }}>{c.dentro}</div>
                <div style={{ color: '#6b7280', fontSize: 11, marginTop: 2 }}>{nome}</div>
                <div style={{ color: '#4b5563', fontSize: 10, marginTop: 4 }}>↗{c.entradas} ↙{c.saidas}</div>
              </div>
            )
          })}
        </div>
      </div>

      <div style={{ background: '#111827', borderRadius: 12, border: '1px solid #1f2937', overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #1f2937', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ color: '#9ca3af', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>Eventos recentes</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', animation: 'pulse 2s infinite' }} />
            <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }`}</style>
            <span style={{ color: '#6b7280', fontSize: 11 }}>ao vivo</span>
          </div>
        </div>
        {ultimosEventos.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: '#4b5563', fontSize: 14 }}>Nenhum evento ainda hoje</div>
        ) : (
          ultimosEventos.map((ev, i) => {
            const cfg = TIPO_CONFIG[ev.tipo] || { label: ev.tipo, cor: '#6b7280', icone: '•' }
            return (
              <div key={ev.id} style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px',
                borderBottom: i < ultimosEventos.length - 1 ? '1px solid #1f2937' : 'none',
                background: i === 0 ? '#1f293780' : 'transparent',
              }}>
                <span style={{
                  width: 28, height: 28, borderRadius: 8,
                  background: cfg.cor + '20', color: cfg.cor,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 14, flexShrink: 0,
                }}>{cfg.icone}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: '#fff', fontSize: 13, fontWeight: 500 }}>{cfg.label}</span>
                    <span style={{ background: '#1f2937', color: '#9ca3af', fontSize: 10, padding: '1px 6px', borderRadius: 4 }}>{nomeCamara(ev.camera_id)}</span>
                    <span style={{ color: '#4b5563', fontSize: 11 }}>{Math.round(ev.confianca * 100)}% conf.</span>
                  </div>
                  <div style={{ color: '#6b7280', fontSize: 11, marginTop: 1 }}>{horaFormatada(ev.criado_em)}</div>
                </div>
                {ev.video_url && (
                  <button onClick={() => setVideoAberto(ev.video_url!)} style={{
                    background: '#1f2937', border: '1px solid #374151',
                    color: '#9ca3af', fontSize: 11, padding: '4px 10px',
                    borderRadius: 6, cursor: 'pointer', flexShrink: 0,
                    display: 'flex', alignItems: 'center', gap: 4,
                  }}>▶ Ver clipe</button>
                )}
              </div>
            )
          })
        )}
      </div>

      {videoAberto && (
        <div onClick={() => setVideoAberto(null)} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
          zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: '#111827', borderRadius: 16, overflow: 'hidden',
            maxWidth: 720, width: '90%', boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid #1f2937' }}>
              <span style={{ color: '#fff', fontWeight: 600, fontSize: 14 }}>Clipe do evento</span>
              <button onClick={() => setVideoAberto(null)} style={{ background: 'none', border: 'none', color: '#9ca3af', fontSize: 20, cursor: 'pointer' }}>✕</button>
            </div>
            <video src={videoAberto} controls autoPlay style={{ width: '100%', display: 'block', maxHeight: 480, background: '#000' }} />
          </div>
        </div>
      )}
    </div>
  )
}