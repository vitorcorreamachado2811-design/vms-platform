with open("frontend/app/cameras/page.tsx", "r", encoding="utf-8") as f:
    content = f.read()

# Sempre usa o endpoint /live do backend (que faz proxy da câmera)
old = """  function getSnapshotUrl() {
    // HTTP direto da câmera se disponível, senão via backend
    return camera.http_url
      ? `${camera.http_url}&t=${Date.now()}`
      : `${API}/cameras/${camera.id}/snapshot?t=${Date.now()}`
  }

  function atualizarSnapshot() {
    setSnapshot(getSnapshotUrl())
  }

  // Polling encadeado: só pede próximo frame DEPOIS que o atual carregou
  function proximoFrame() {
    if (!aoVivoRef.current) return
    const intervalo = camera.http_url ? 200 : 500
    intervalRef.current = setTimeout(() => {
      setSnapshot(getSnapshotUrl())
    }, intervalo)
  }"""

new = """  function getSnapshotUrl() {
    // Sempre via backend /live (que faz proxy da câmera HTTP ou usa worker)
    return `${API}/cameras/${camera.id}/live?t=${Date.now()}`
  }

  function atualizarSnapshot() {
    setSnapshot(getSnapshotUrl())
  }

  // Polling encadeado: só pede próximo frame DEPOIS que o atual carregou
  function proximoFrame() {
    if (!aoVivoRef.current) return
    const intervalo = camera.http_url ? 200 : 500
    intervalRef.current = setTimeout(() => {
      setSnapshot(getSnapshotUrl())
    }, intervalo)
  }"""

if old in content:
    content = content.replace(old, new)
    print("OK frontend")
else:
    print("ERRO frontend")

with open("frontend/app/cameras/page.tsx", "w", encoding="utf-8") as f:
    f.write(content)
