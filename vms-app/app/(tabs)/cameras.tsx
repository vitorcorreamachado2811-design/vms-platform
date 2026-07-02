import { useEffect, useRef, useState } from "react"
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, Modal, SafeAreaView, ActivityIndicator,
} from "react-native"
import { VLCPlayer } from "react-native-vlc-media-player"
import { useAuth } from "../../src/AuthContext"

const API = "https://vms-platform-production.up.railway.app"

interface Camera { id: string; nome: string; rtsp_url: string; ativo: boolean; empresa_id: string }

function RtspViewer({ camera, onClose }: { camera: Camera; onClose: () => void }) {
  const { usuario, token } = useAuth()
  const [rtspUrl, setRtspUrl] = useState<string | null>(null)
  const [rtspToken, setRtspToken] = useState<string | null>(null)
  const [status, setStatus] = useState<"conectando" | "ao_vivo" | "sem_sinal">("conectando")
  const reconectarRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  async function buscarToken() {
    if (!usuario || !token) return
    try {
      const res = await fetch(
        `${API}/cameras/${camera.id}/rtsp-token?usuario_id=${usuario.id}&token=${token}`
      )
      if (!res.ok) { setStatus("sem_sinal"); agendarReconexao(); return }
      const data = await res.json()
      setRtspUrl(data.rtsp_url)
      setRtspToken(data.token)
    } catch {
      setStatus("sem_sinal")
      agendarReconexao()
    }
  }

  function agendarReconexao() {
    if (reconectarRef.current) clearTimeout(reconectarRef.current)
    reconectarRef.current = setTimeout(buscarToken, 3000)
  }

  useEffect(() => {
    buscarToken()
    return () => { if (reconectarRef.current) clearTimeout(reconectarRef.current) }
  }, [camera.id, usuario, token])

  return (
    <Modal animationType="slide" statusBarTranslucent>
      <SafeAreaView style={{ flex: 1, backgroundColor: "#000" }}>
        <View style={mv.header}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View style={mv.dot} />
            <Text style={mv.nome}>{camera.nome}</Text>
          </View>
          <TouchableOpacity onPress={onClose} style={mv.closeBtn}>
            <Text style={{ color: "#fff", fontSize: 18, fontWeight: "700" }}>x</Text>
          </TouchableOpacity>
        </View>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          {rtspUrl && rtspToken && (
            <VLCPlayer
              style={{ width: "100%", height: "100%" }}
              autoplay
              resizeMode="contain"
              source={{
                uri: rtspUrl,
                // mediaOptions nao esta no tipo oficial da lib. --rtsp-tcp forca
                // midia via TCP (o proxy do Railway nao aceita UDP). O libVLC pede
                // credenciais via um LoginDialog nativo em vez de aceitar --rtsp-user/
                // --rtsp-pwd direto - patch em node_modules (ver patches/) responde
                // esse dialog usando o user/pass extraidos daqui.
                mediaOptions: [
                  "--rtsp-tcp",
                  "--rtsp-user=viewer",
                  `--rtsp-pwd=${rtspToken}`,
                ],
              } as any}
              onPlaying={() => setStatus("ao_vivo")}
              onBuffering={() => setStatus("conectando")}
              onError={() => { setStatus("sem_sinal"); agendarReconexao() }}
              onStopped={() => { setStatus("sem_sinal"); agendarReconexao() }}
            />
          )}
          {status !== "ao_vivo" && (
            <View style={mv.overlay} pointerEvents="none">
              <ActivityIndicator color="#3b82f6" size="large" />
              <Text style={mv.overlayTexto}>
                {status === "sem_sinal" ? "Sem sinal - reconectando..." : "Conectando..."}
              </Text>
            </View>
          )}
        </View>
      </SafeAreaView>
    </Modal>
  )
}

function CameraCard({ camera, onAoVivo }: { camera: Camera; onAoVivo: () => void }) {
  return (
    <View style={s.card}>
      <View style={s.cardInfo}>
        <Text style={s.cardNome}>{camera.nome}</Text>
        <View style={[s.badge, camera.ativo ? s.badgeAtivo : s.badgeInativo]}>
          <Text style={[s.badgeText, camera.ativo ? s.badgeTextAtivo : s.badgeTextInativo]}>
            {camera.ativo ? "Ativa" : "Inativa"}
          </Text>
        </View>
      </View>
      <TouchableOpacity style={s.btnLive} onPress={onAoVivo}>
        <Text style={s.btnLiveText}>Ao Vivo</Text>
      </TouchableOpacity>
    </View>
  )
}

export default function CamerasScreen() {
  const { usuario, logout } = useAuth()
  const [cameras, setCameras] = useState<Camera[]>([])
  const [carregando, setCarregando] = useState(true)
  const [cameraAberta, setCameraAberta] = useState<Camera | null>(null)

  useEffect(() => {
    if (!usuario) return
    fetch(`${API}/cameras/?empresa_id=${usuario.empresa_id}`)
      .then(r => r.json())
      .then(data => { setCameras(Array.isArray(data) ? data : []); setCarregando(false) })
      .catch(() => setCarregando(false))
  }, [usuario])

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <View>
          <Text style={s.titulo}>Cameras</Text>
          <Text style={s.subtitulo}>{cameras.length} cadastradas</Text>
        </View>
        <TouchableOpacity onPress={logout} style={s.logoutBtn}>
          <Text style={s.logoutText}>Sair</Text>
        </TouchableOpacity>
      </View>
      {carregando ? (
        <View style={s.center}><ActivityIndicator color="#3b82f6" size="large" /></View>
      ) : cameras.length === 0 ? (
        <View style={s.center}><Text style={s.vazio}>Nenhuma camera cadastrada.</Text></View>
      ) : (
        <FlatList data={cameras} keyExtractor={c => c.id}
          contentContainerStyle={{ padding: 16, gap: 12 }}
          renderItem={({ item }) => <CameraCard camera={item} onAoVivo={() => setCameraAberta(item)} />} />
      )}
      {cameraAberta && <RtspViewer camera={cameraAberta} onClose={() => setCameraAberta(null)} />}
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#030712" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: "#1f2937" },
  titulo: { color: "#60a5fa", fontSize: 20, fontWeight: "800" },
  subtitulo: { color: "#6b7280", fontSize: 12, marginTop: 2 },
  logoutBtn: { backgroundColor: "#1f2937", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  logoutText: { color: "#9ca3af", fontSize: 13, fontWeight: "600" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  vazio: { color: "#6b7280", fontSize: 14 },
  card: { backgroundColor: "#111827", borderRadius: 12, padding: 16, borderWidth: 1, borderColor: "#1f2937" },
  cardInfo: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  cardNome: { color: "#fff", fontSize: 15, fontWeight: "700", flex: 1 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  badgeAtivo: { backgroundColor: "#052e16" },
  badgeInativo: { backgroundColor: "#450a0a" },
  badgeText: { fontSize: 11, fontWeight: "700" },
  badgeTextAtivo: { color: "#86efac" },
  badgeTextInativo: { color: "#fca5a5" },
  btnLive: { backgroundColor: "#3b82f6", borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  btnLiveText: { color: "#fff", fontWeight: "700", fontSize: 14 },
})

const mv = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, backgroundColor: "#111827" },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#22c55e" },
  nome: { color: "#fff", fontWeight: "700", fontSize: 15 },
  closeBtn: { width: 34, height: 34, borderRadius: 8, backgroundColor: "rgba(255,255,255,0.1)", alignItems: "center", justifyContent: "center" },
  overlay: { position: "absolute", alignItems: "center", justifyContent: "center", gap: 10 },
  overlayTexto: { color: "#9ca3af", fontSize: 13 },
})
