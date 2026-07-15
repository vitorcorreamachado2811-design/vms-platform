import { useState } from "react"
import {
  View, Text, TextInput, TouchableOpacity, Image,
  StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator,
} from "react-native"
import { useAuth } from "../../src/AuthContext"
import { colors } from "../../src/theme"

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
        <Image source={require("../../assets/logo.png")} style={s.logo} resizeMode="contain" />
        <Text style={s.titulo}>IA que protege. Supervisiona. Previne.</Text>
        <TextInput style={s.input} placeholder="Email" placeholderTextColor={colors.muted}
          value={email} onChangeText={setEmail} keyboardType="email-address"
          autoCapitalize="none" autoCorrect={false} />
        <TextInput style={s.input} placeholder="Senha" placeholderTextColor={colors.muted}
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
  container: { flex: 1, backgroundColor: colors.background, justifyContent: "center", padding: 24 },
  card: { backgroundColor: colors.surface, borderRadius: 16, padding: 28, borderWidth: 1, borderColor: colors.border },
  logo: { width: "100%", height: 96, alignSelf: "center", marginBottom: 8 },
  titulo: { color: colors.textMuted, fontSize: 12, textAlign: "center", marginBottom: 28 },
  input: {
    backgroundColor: colors.background, color: colors.text, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 14,
    marginBottom: 12, borderWidth: 1, borderColor: colors.border,
  },
  erro: { color: colors.danger, fontSize: 13, marginBottom: 10, textAlign: "center" },
  btn: { backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 14, alignItems: "center", marginTop: 4 },
  btnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
})
