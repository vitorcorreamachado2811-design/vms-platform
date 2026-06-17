import { Tabs } from "expo-router"
import { Text } from "react-native"

function Icon({ emoji, focused }: { emoji: string; focused: boolean }) {
  return <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.5 }}>{emoji}</Text>
}

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{
      headerShown: false,
      tabBarStyle: { backgroundColor: "#111827", borderTopColor: "#1f2937", height: 60, paddingBottom: 8 },
      tabBarActiveTintColor: "#3b82f6",
      tabBarInactiveTintColor: "#6b7280",
      tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
    }}>
      <Tabs.Screen name="cameras" options={{ title: "Cameras", tabBarIcon: ({ focused }) => <Icon emoji="ðŸ“·" focused={focused} /> }} />
      <Tabs.Screen name="eventos" options={{ title: "Eventos", tabBarIcon: ({ focused }) => <Icon emoji="âš ï¸" focused={focused} /> }} />
      <Tabs.Screen name="habitos" options={{ title: "Habitos", tabBarIcon: ({ focused }) => <Icon emoji="ðŸ“Š" focused={focused} /> }} />
    </Tabs>
  )
}
