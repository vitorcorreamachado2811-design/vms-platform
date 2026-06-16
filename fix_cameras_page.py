with open("frontend/app/cameras/page.tsx", "r", encoding="utf-8") as f:
    content = f.read()

# Remove o bloco MJPEG e substitui por imagem simples
old = """        {/* Stream MJPEG ao vivo */}
        {aoVivo && usandoMjpeg ? (
          <img
            ref={imgRef}
            src={mjpegUrl}
            alt={camera.nome}
            className="w-full h-full object-cover"
            onLoad={() => setCarregando(false)}
            onError={() => {
              // Fallback para snapshot polling se MJPEG falhar
              setUsandoMjpeg(false)
              atualizarSnapshot()
            }}
            draggable={false}
          />
        ) : snapshot ? ("""

new = """        {/* Snapshot ao vivo */}
        {snapshot ? ("""

if old in content:
    content = content.replace(old, new)
    print("OK removeu MJPEG")
else:
    print("ERRO - buscando alternativa")
    idx = content.find("usandoMjpeg")
    print(repr(content[idx-100:idx+200]))

with open("frontend/app/cameras/page.tsx", "w", encoding="utf-8") as f:
    f.write(content)
