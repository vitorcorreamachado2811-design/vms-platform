import { useEffect } from "react"
import { Stack, useRouter, useSegments } from "expo-router"
import { AuthProvider, useAuth } from "../src/AuthContext"

function RootLayoutNav() {
  const { usuario, carregando } = useAuth()
  const router = useRouter()
  const segments = useSegments()

  useEffect(() => {
    if (carregando) return
    const naAuth = segments[0] === "(auth)"
    if (!usuario && !naAuth) router.replace("/(auth)/login")
    else if (usuario && naAuth) router.replace("/(tabs)/cameras")
  }, [usuario, carregando, segments])

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(tabs)" />
    </Stack>
  )
}

export default function RootLayout() {
  return <AuthProvider><RootLayoutNav /></AuthProvider>
}
