import { Redirect } from "expo-router"
import { useAuth } from "../src/AuthContext"

export default function Index() {
  const { usuario, carregando } = useAuth()

  if (carregando) return null

  return usuario
    ? <Redirect href="/(tabs)/cameras" />
    : <Redirect href="/(auth)/login" />
}