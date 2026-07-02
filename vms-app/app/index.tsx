import { Redirect } from "expo-router"
import { useAuth } from "../src/AuthContext"

export default function Index() {
  const { usuario, carregando } = useAuth()
  if (carregando) return null
  return <Redirect href={usuario ? "/(tabs)/cameras" : "/(auth)/login"} />
}
