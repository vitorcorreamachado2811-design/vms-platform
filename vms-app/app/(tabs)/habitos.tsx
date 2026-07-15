import { useEffect, useState, useCallback } from "react"
import { View, Text, FlatList, StyleSheet, SafeAreaView, ActivityIndicator, RefreshControl } from "react-native"
import { useAuth } from "../../src/AuthContext"
import { colors } from "../../src/theme"

const SUPABASE_URL = "https://wqoekhbwdrgryahoyjuo.supabase.co"
const SUPABASE_KEY = "sb_publishable_0UZ6n5qJEkfAbiKveWTE0A_ixc_w9MY"

interface Alerta { id: string; tipo: string; horario_esperado: string; horario_real: string | null; desvio_minutos: number; status: string; created_at: string }
interface Registro { id: string; tipo: string; horario_evento: string; duracao_minutos: number | null }

const TIPO_LABEL: Record<string, string> = { sono: "Sono", banho: "Banho", refeicao: "Refeição" }
const TIPO_EMOJI: Record<string, string> = { sono: "🌙", banho: "🚿", refeicao: "🍽️" }
const TIPO_COR: Record<string, string> = { sono: colors.primary, banho: colors.secondary, refeicao: "#F59E0B" }

function fmtHora(iso: string) { return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) }
function fmtData(iso: string) { return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) }

export default function HabitosScreen() {
  const { usuario } = useAuth()
  const [alertas, setAlertas] = useState<Alerta[]>([])
  const [registros, setRegistros] = useState<Registro[]>([])
  const [carregando, setCarregando] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [aba, setAba] = useState<"alertas" | "registros">("alertas")

  async function carregar() {
    if (!usuario) return
    try {
      const headers = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
      const [ra, rr] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/habitos_alertas?empresa_id=eq.${usuario.empresa_id}&order=created_at.desc&limit=30`, { headers }),
        fetch(`${SUPABASE_URL}/rest/v1/habitos_registros?empresa_id=eq.${usuario.empresa_id}&order=horario_evento.desc&limit=50`, { headers }),
      ])
      const [da, dr] = await Promise.all([ra.json(), rr.json()])
      setAlertas(Array.isArray(da) ? da : [])
      setRegistros(Array.isArray(dr) ? dr : [])
    } catch {}
    setCarregando(false); setRefreshing(false)
  }

  useEffect(() => { carregar() }, [usuario])
  const onRefresh = useCallback(() => { setRefreshing(true); carregar() }, [usuario])

  return (
    <SafeAreaView style={h.container}>
      <View style={h.header}><Text style={h.titulo}>Hábitos</Text></View>
      <View style={h.abas}>
        <Text onPress={() => setAba("alertas")} style={[h.aba, aba === "alertas" && h.abaAtiva]}>
          Alertas {alertas.length > 0 ? `(${alertas.length})` : ""}
        </Text>
        <Text onPress={() => setAba("registros")} style={[h.aba, aba === "registros" && h.abaAtiva]}>Registros</Text>
      </View>
      {carregando ? (
        <View style={h.center}><ActivityIndicator color={colors.secondary} size="large" /></View>
      ) : aba === "alertas" ? (
        alertas.length === 0 ? <View style={h.center}><Text style={h.vazio}>Nenhum alerta.</Text></View> :
        <FlatList data={alertas} keyExtractor={a => a.id} contentContainerStyle={{ padding: 16, gap: 10 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.secondary} />}
          renderItem={({ item }) => {
            const cor = TIPO_COR[item.tipo] || colors.muted
            const pendente = item.status === "pendente"
            return (
              <View style={[h.card, { borderLeftColor: cor, borderLeftWidth: 3 }]}>
                <View style={h.cardRow}>
                  <Text style={h.emoji}>{TIPO_EMOJI[item.tipo] || "⚠️"}</Text>
                  <View style={{ flex: 1 }}>
                    <View style={h.cardHeader}>
                      <Text style={[h.tipo, { color: cor }]}>{TIPO_LABEL[item.tipo] || item.tipo}</Text>
                      <View style={[h.badge, { backgroundColor: pendente ? `${colors.danger}22` : `${colors.success}22` }]}>
                        <Text style={[h.badgeText, { color: pendente ? colors.danger : colors.success }]}>
                          {pendente ? "Pendente" : "Resolvido"}
                        </Text>
                      </View>
                    </View>
                    <Text style={h.det}>Esperado até {item.horario_esperado.slice(0,5)}{item.horario_real ? ` - Ocorreu ${item.horario_real.slice(0,5)}` : " - Não ocorreu"}</Text>
                    <Text style={h.det}>Atraso: {item.desvio_minutos}min - {fmtData(item.created_at)}</Text>
                  </View>
                </View>
              </View>
            )
          }} />
      ) : (
        registros.length === 0 ? <View style={h.center}><Text style={h.vazio}>Nenhum registro.</Text></View> :
        <FlatList data={registros} keyExtractor={r => r.id} contentContainerStyle={{ padding: 16, gap: 10 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.secondary} />}
          renderItem={({ item }) => {
            const cor = TIPO_COR[item.tipo] || colors.muted
            return (
              <View style={[h.card, { borderLeftColor: cor, borderLeftWidth: 3 }]}>
                <View style={h.cardRow}>
                  <Text style={h.emoji}>{TIPO_EMOJI[item.tipo] || "📋"}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[h.tipo, { color: cor }]}>{TIPO_LABEL[item.tipo] || item.tipo}</Text>
                    <Text style={h.det}>{fmtHora(item.horario_evento)}{item.duracao_minutos ? ` - ${item.duracao_minutos}min` : ""} - {fmtData(item.horario_evento)}</Text>
                  </View>
                </View>
              </View>
            )
          }} />
      )}
    </SafeAreaView>
  )
}

const h = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  titulo: { color: colors.text, fontSize: 22, fontWeight: "800" },
  abas: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: colors.border, paddingHorizontal: 20 },
  aba: { paddingVertical: 12, paddingHorizontal: 4, marginRight: 24, color: colors.textMuted, fontSize: 14, fontWeight: "600" },
  abaAtiva: { color: colors.secondary, borderBottomWidth: 2, borderBottomColor: colors.secondary },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  vazio: { color: colors.textMuted, fontSize: 14 },
  card: {
    backgroundColor: colors.surface, borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: colors.border,
  },
  cardRow: { flexDirection: "row", gap: 10 },
  emoji: { fontSize: 22, marginTop: 2 },
  cardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  tipo: { fontSize: 14, fontWeight: "700" },
  det: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  badgeText: { fontSize: 10, fontWeight: "700" },
})
