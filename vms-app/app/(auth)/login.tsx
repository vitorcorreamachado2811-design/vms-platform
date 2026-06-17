import { useState } from "react"
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator,
} from "react-native"
import { useAuth } from "../../src/AuthContext"

export default function LoginScreen() {
  const { login } = useAuth()
  const [email, setEmail] = useState("")
  const [senha, setSenha] = useState("")
  const [erro, setErro] = useState("")
  const [carregando, setCarregando] = useState(false)

  async function handleLogin() {
    if (!email || !senha) { setErro("Preencha email e senha"); return }
    setCarregando(true); setErro("")
    const err = await login(email.trim(), senha)
    if (err) setErro(err)
    setCarregando(false)
  }

  return (
    <KeyboardAvoidingView style={s.container} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={s.card}>
        <Text style={s.logo}>VMS</Text>
        <Text style={s.titulo}>Plataforma de Monitoramento</Text>
        <TextInput style={s.input} placeholder="Email" placeholderTextColor="#6b7280"
          value={email} onChangeText={setEmail} keyboardType="email-address"
          autoCapitalize="none" autoCorrect={false} />
        <TextInput style={s.input} placeholder="Senha" placeholderTextColor="#6b7280"
          value={senha} onChangeText={setSenha} secureTextEntry />
        {!!erro && <Text style={s.erro}>{erro}</Text>}
        <TouchableOpacity style={s.btn} onPress={handleLogin} disabled={carregando}>
          {carregando ? <ActivityIndicator color="#fff" /> : <Text style={s.btnText}>Entrar</Text>}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#030712", justifyContent: "center", padding: 24 },
  card: { backgroundColor: "#111827", borderRadius: 16, padding: 28 },
  logo: { color: "#3b82f6", fontSize: 36, fontWeight: "800", textAlign: "center", marginBottom: 4 },
  titulo: { color: "#6b7280", fontSize: 13, textAlign: "center", marginBottom: 28 },
  input: {
    backgroundColor: "#1f2937", color: "#fff", borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 14,
    marginBottom: 12, borderWidth: 1, borderColor: "#374151",
  },
  erro: { color: "#f87171", fontSize: 13, marginBottom: 10, textAlign: "center" },
  btn: { backgroundColor: "#3b82f6", borderRadius: 10, paddingVertical: 14, alignItems: "center", marginTop: 4 },
  btnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
})
