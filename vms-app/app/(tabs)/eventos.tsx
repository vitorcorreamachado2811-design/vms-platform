import { useEffect, useState, useCallback } from "react"
import {
  View, Text, FlatList, StyleSheet, Modal, TouchableOpacity,
  SafeAreaView, ActivityIndicator, RefreshControl,
} from "react-native"
import { useVideoPlayer, VideoView } from "expo-video"
import { useAuth } from "../../src/AuthContext"

const API = process.env.EXPO_PUBLIC_API_URL || "https://vms-platform-production.up.railway.app"

interface Evento { id: string; camera_id: string; tipo: string; confianca: number; criado_em: string; video_url?: string }

const TIPO_LABEL: Record<string, string> = {
  queda_leito: "Queda do Leito", queda_pe: "Queda em Pe",
  person: "Pessoa Detectada", entrada: "Entrada", saida: "Saida", gesto_socorro: "Gesto de Socorro",
}

const TIPO_COR: Record<string, string> = {
  queda_leito: "#dc2626", queda_pe: "#ea580c", person: "#3b82f6",
  entrada: "#10b981", saida: "#f59e0b", gesto_socorro: "#8b5cf6",
}

function formatarData(iso: string) {
  // Backend manda UTC sem sufixo Z e com microssegundos (ex: 2026-07-13T19:18:16.143834).
  // O Hermes nao parseia esse formato - corta pra milissegundos e marca como UTC.
  if (!iso) return ""
  let s = iso.replace(" ", "T")
  const m = s.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/)
  if (m) {
    const ms = m[2] ? m[2].slice(0, 4) : ""
    s = m[1] + ms + (m[3] || "Z")
  }
  const d = new Date(s)
  if (isNaN(d.getTime())) return ""
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
}

function VideoModal({ url, onClose }: { url: string; onClose: () => void }) {
  const player = useVideoPlayer(url, p => { p.loop = false; p.play() })
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.modalFundo}>
        <View style={s.modalCaixa}>
          <VideoView player={player} style={s.player} nativeControls allowsFullscreen contentFit="contain" />
          <TouchableOpacity style={s.fechar} onPress={onClose}>
            <Text style={s.fecharTexto}>Fechar</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  )
}

function EventoCard({ evento, onVerVideo }: { evento: Evento; onVerVideo: (url: string) => void }) {
  const label = TIPO_LABEL[evento.tipo] || evento.tipo
  const cor = TIPO_COR[evento.tipo] || "#6b7280"
  return (
    <View style={[s.card, { borderLeftColor: cor, borderLeftWidth: 4 }]}>
      <View style={s.cardHeader}>
        <Text style={[s.tipo, { color: cor }]}>{label}</Text>
        <Text style={s.conf}>{Math.round(evento.confianca * 100)}%</Text>
      </View>
      <Text style={s.data}>{formatarData(evento.criado_em)}</Text>
      {evento.video_url ? (
        <TouchableOpacity onPress={() => onVerVideo(evento.video_url as string)} hitSlop={8}>
          <Text style={s.video}>Ver video</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  )
}

export default function EventosScreen() {
  const { usuario } = useAuth()
  const [eventos, setEventos] = useState<Evento[]>([])
  const [carregando, setCarregando] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)

  async function carregar() {
    if (!usuario) return
    try {
      const res = await fetch(`${API}/eventos/?empresa_id=${usuario.empresa_id}&limit=50`)
      const data = await res.json()
      setEventos(Array.isArray(data) ? data : [])
    } catch {}
    setCarregando(false); setRefreshing(false)
  }

  useEffect(() => { carregar() }, [usuario])
  const onRefresh = useCallback(() => { setRefreshing(true); carregar() }, [usuario])

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <Text style={s.titulo}>Eventos</Text>
        <Text style={s.subtitulo}>{eventos.length} registros</Text>
      </View>
      {carregando ? (
        <View style={s.center}><ActivityIndicator color="#3b82f6" size="large" /></View>
      ) : eventos.length === 0 ? (
        <View style={s.center}><Text style={s.vazio}>Nenhum evento registrado.</Text></View>
      ) : (
        <FlatList data={eventos} keyExtractor={e => e.id}
          contentContainerStyle={{ padding: 16, gap: 10 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#3b82f6" />}
          renderItem={({ item }) => <EventoCard evento={item} onVerVideo={setVideoUrl} />} />
      )}
      {videoUrl ? <VideoModal url={videoUrl} onClose={() => setVideoUrl(null)} /> : null}
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#030712" },
  header: { paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: "#1f2937" },
  titulo: { color: "#60a5fa", fontSize: 20, fontWeight: "800" },
  subtitulo: { color: "#6b7280", fontSize: 12, marginTop: 2 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  vazio: { color: "#6b7280", fontSize: 14 },
  card: { backgroundColor: "#111827", borderRadius: 12, padding: 14, borderWidth: 1, borderColor: "#1f2937" },
  cardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  tipo: { fontSize: 14, fontWeight: "700" },
  conf: { color: "#6b7280", fontSize: 12 },
  data: { color: "#9ca3af", fontSize: 12 },
  video: { color: "#3b82f6", fontSize: 12, marginTop: 4, fontWeight: "600" },
  modalFundo: { flex: 1, backgroundColor: "rgba(0,0,0,0.9)", alignItems: "center", justifyContent: "center", padding: 16 },
  modalCaixa: { width: "100%", backgroundColor: "#111827", borderRadius: 12, padding: 12 },
  player: { width: "100%", aspectRatio: 16 / 9, backgroundColor: "#000", borderRadius: 8 },
  fechar: { marginTop: 12, backgroundColor: "#1f2937", borderRadius: 8, paddingVertical: 10, alignItems: "center" },
  fecharTexto: { color: "#fff", fontWeight: "700", fontSize: 14 },
})
