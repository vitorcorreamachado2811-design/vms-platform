with open("frontend/app/cameras/page.tsx", "r", encoding="utf-8") as f:
    content = f.read()

# Troca snapshot por live
old = "    intervalRef.current = setTimeout(() => {\n      setSnapshot(`${API}/cameras/${camera.id}/snapshot?t=${Date.now()}`)\n    }, 500) // 500ms apos carregar o frame anterior"

new = "    intervalRef.current = setTimeout(() => {\n      setSnapshot(`${API}/cameras/${camera.id}/live?t=${Date.now()}`)\n    }, 100) // 100ms - usa frame do worker ja capturado"

if old in content:
    content = content.replace(old, new)
    print("OK frontend proximoFrame")
else:
    print("ERRO proximoFrame")

old2 = "    setSnapshot(`${API}/cameras/${camera.id}/snapshot?t=${Date.now()}`)"
new2 = "    setSnapshot(`${API}/cameras/${camera.id}/live?t=${Date.now()}`)"
content = content.replace(old2, new2)
print("OK frontend snapshot->live")

with open("frontend/app/cameras/page.tsx", "w", encoding="utf-8") as f:
    f.write(content)
