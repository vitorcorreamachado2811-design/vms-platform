import { useEffect, useState } from "react"
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, Modal, SafeAreaView, ActivityIndicator,
} from "react-native"
import { WebView } from "react-native-webview"
import { useAuth } from "../../src/AuthContext"

const API = process.env.EXPO_PUBLIC_API_URL || "https://vms-platform-production.up.railway.app"

interface Camera { id: string; nome: string; rtsp_url: string; ativo: boolean; empresa_id: string }

function MjpegViewer({ camera, onClose }: { camera: Camera; onClose: () => void }) {
  const mjpegUrl = `${API}/cameras/${camera.id}/mjpeg`
  const html = `<!DOCTYPE html><html><head>
    <meta name="viewport" content="width=device-width,initial-scale=1.0">
    <style>*{margin:0;padding:0;box-sizing:border-box}body{background:#000;display:flex;align-items:center;justify-content:center;height:100vh}
    img{width:100%;height:100vh;object-fit:contain}
    #st{position:fixed;top:8px;left:8px;background:rgba(0,0,0,.7);color:#fff;font-size:11px;padding:4px 8px;border-radius:4px;font-family:sans-serif}
    #lv{position:fixed;top:8px;right:8px;background:#dc2626;color:#fff;font-size:10px;font-weight:bold;padding:3px 7px;border-radius:4px;display:none;font-family:sans-serif;letter-spacing:1px}
    </style></head><body>
    <div id="st">Conectando...</div><div id="lv">AO VIVO</div>
    <img src="${mjpegUrl}"
      onload="document.getElementById('st').style.display='none';document.getElementById('lv').style.display='block'"
      onerror="document.getElementById('st').textContent='Sem sinal - reconectando...';setTimeout(()=>{this.src='${mjpegUrl}?t='+Date.now()},3000)" />
    </body></html>`

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
        <WebView source={{ html }} style={{ flex: 1, backgroundColor: "#000" }}
          scrollEnabled={false} bounces={false} allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false} mixedContentMode="always" />
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
      {cameraAberta && <MjpegViewer camera={cameraAberta} onClose={() => setCameraAberta(null)} />}
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
})
