import { useEffect, useState, useCallback } from "react"
import {
  View, Text, FlatList, StyleSheet,
  SafeAreaView, ActivityIndicator, RefreshControl,
} from "react-native"
import { useAuth } from "../../src/AuthContext"
import { colors } from "../../src/theme"

const API = "https://vms-platform-production.up.railway.app"

interface Evento { id: string; camera_id: string; tipo: string; confianca: number; created_at: string; video_url?: string }

const TIPO_LABEL: Record<string, string> = {
  queda_leito: "Queda do Leito", queda_pe: "Queda em Pé",
  person: "Pessoa Detectada", entrada: "Entrada", saida: "Saída", gesto_socorro: "Gesto de Socorro",
}
const TIPO_COR: Record<string, string> = {
  queda_leito: colors.danger, queda_pe: "#F59E0B", person: colors.secondary,
  entrada: colors.success, saida: "#F59E0B", gesto_socorro: colors.primary,
}

function formatarData(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
}

function EventoCard({ evento }: { evento: Evento }) {
  const label = TIPO_LABEL[evento.tipo] || evento.tipo
  const cor = TIPO_COR[evento.tipo] || colors.muted

  return (
    <View style={[s.card, { borderLeftColor: cor, borderLeftWidth: 3 }]}>
      <View style={s.cardHeader}>
        <Text style={[s.tipo, { color: cor }]}>{label}</Text>
        <Text style={s.conf}>{Math.round(evento.confianca * 100)}%</Text>
      </View>
      <Text style={s.data}>{formatarData(evento.created_at)}</Text>
      {evento.video_url && <Text style={s.video}>Vídeo disponível</Text>}
    </View>
  )
}

export default function EventosScreen() {
  const { usuario } = useAuth()
  const [eventos, setEventos] = useState<Evento[]>([])
  const [carregando, setCarregando] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

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
        <View style={s.center}><ActivityIndicator color={colors.secondary} size="large" /></View>
      ) : eventos.length === 0 ? (
        <View style={s.center}><Text style={s.vazio}>Nenhum evento registrado.</Text></View>
      ) : (
        <FlatList data={eventos} keyExtractor={e => e.id}
          contentContainerStyle={{ padding: 16, gap: 10 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.secondary} />}
          renderItem={({ item }) => <EventoCard evento={item} />} />
      )}
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  titulo: { color: colors.text, fontSize: 22, fontWeight: "800" },
  subtitulo: { color: colors.textMuted, fontSize: 12, marginTop: 3 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  vazio: { color: colors.textMuted, fontSize: 14 },
  card: {
    backgroundColor: colors.surface, borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: colors.border,
  },
  cardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  tipo: { fontSize: 14, fontWeight: "700" },
  conf: { color: colors.textMuted, fontSize: 12 },
  data: { color: colors.textMuted, fontSize: 12 },
  video: { color: colors.secondary, fontSize: 12, marginTop: 4, fontWeight: "600" },
})
