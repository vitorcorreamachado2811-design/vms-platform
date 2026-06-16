with open("backend/app/routers/cameras.py", "r", encoding="utf-8") as f:
    content = f.read()

old = """    if camera and camera.http_url:
        try:
            r = req.get(camera.http_url, timeout=3, verify=False)
            if r.status_code == 200 and len(r.content) > 1000:
                return Response(
                    content=r.content,
                    media_type="image/jpeg",
                    headers={"Cache-Control": "no-cache", "X-Source": "http"}
                )
        except:
            pass"""

new = """    if camera and camera.http_url:
        try:
            import urllib.request, base64, urllib.parse
            parsed = urllib.parse.urlparse(camera.http_url)
            clean_url = camera.http_url
            credentials = None
            if parsed.username:
                credentials = base64.b64encode(f"{parsed.username}:{parsed.password}".encode()).decode()
                clean_url = camera.http_url.replace(f"{parsed.username}:{parsed.password}@", "")
            req2 = urllib.request.Request(clean_url)
            if credentials:
                req2.add_header("Authorization", "Basic " + credentials)
            r2 = urllib.request.urlopen(req2, timeout=3)
            data = r2.read()
            if len(data) > 1000:
                return Response(
                    content=data,
                    media_type="image/jpeg",
                    headers={"Cache-Control": "no-cache", "X-Source": "http"}
                )
        except:
            pass"""

if old in content:
    content = content.replace(old, new)
    print("OK proxy urllib")
else:
    print("ERRO")

with open("backend/app/routers/cameras.py", "w", encoding="utf-8") as f:
    f.write(content)
