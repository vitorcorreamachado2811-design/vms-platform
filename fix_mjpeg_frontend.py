with open("frontend/app/cameras/page.tsx", "r", encoding="utf-8") as f:
    content = f.read()

old = """  function getSnapshotUrl() {
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
  }

  function iniciarAoVivo() {
    aoVivoRef.current = true
    setAoVivo(true)
    setErro(null)
    setCarregando(true)
    atualizarSnapshot()
  }"""

new = """  // URL MJPEG stream (conexao unica, frames continuos)
  const mjpegStreamUrl = camera.http_url
    ? `${API}/cameras/${camera.id}/stream/mjpeg`
    : null

  function getSnapshotUrl() {
    return `${API}/cameras/${camera.id}/live?t=${Date.now()}`
  }

  function atualizarSnapshot() {
    if (!mjpegStreamUrl) setSnapshot(getSnapshotUrl())
  }

  function proximoFrame() {
    if (!aoVivoRef.current || mjpegStreamUrl) return
    intervalRef.current = setTimeout(() => {
      setSnapshot(getSnapshotUrl())
    }, 500)
  }

  function iniciarAoVivo() {
    aoVivoRef.current = true
    setAoVivo(true)
    setErro(null)
    setCarregando(true)
    if (mjpegStreamUrl) {
      setSnapshot(mjpegStreamUrl)  // MJPEG: uma URL, stream continuo
    } else {
      atualizarSnapshot()
    }
  }"""

if old in content:
    content = content.replace(old, new)
    print("OK frontend MJPEG")
else:
    print("ERRO frontend")

with open("frontend/app/cameras/page.tsx", "w", encoding="utf-8") as f:
    f.write(content)
