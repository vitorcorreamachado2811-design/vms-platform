import os
import httpx

RAILWAY_API_TOKEN = os.environ.get("RAILWAY_API_TOKEN", "")
RAILWAY_PROJECT_ID = os.environ.get("RAILWAY_PROJECT_ID", "")
RAILWAY_ENVIRONMENT_ID = os.environ.get("RAILWAY_ENVIRONMENT_ID", "")
GITHUB_REPO = "vitorcorreamachado2811-design/vms-platform"


async def criar_worker_railway(empresa_id: str, empresa_nome: str):
    """Cria um novo servico Railway (worker) para a empresa e configura suas variaveis."""
    if not RAILWAY_API_TOKEN or not RAILWAY_PROJECT_ID:
        print("[RAILWAY] Token ou Project ID nao configurado", flush=True)
        return None
    nome_worker = "worker-" + empresa_nome.lower().replace(" ", "-")
    query_create = (
        'mutation { serviceCreate(input: { '
        'projectId: "' + RAILWAY_PROJECT_ID + '" '
        'name: "' + nome_worker + '" '
        'source: { repo: "' + GITHUB_REPO + '" } '
        '}) { id name } }'
    )
    try:
        async with httpx.AsyncClient() as client:
            res = await client.post(
                "https://backboard.railway.com/graphql/v2",
                json={"query": query_create},
                headers={"Authorization": "Bearer " + RAILWAY_API_TOKEN, "Content-Type": "application/json"},
                timeout=30
            )
            data = res.json()
            if "errors" in data:
                print("[RAILWAY] Erro criar worker: " + str(data["errors"]), flush=True)
                return None
            service_id = data["data"]["serviceCreate"]["id"]
            print("[RAILWAY] Worker criado: " + service_id, flush=True)

            variaveis = [
                ("EMPRESA_ID", empresa_id),
                ("API_BASE", os.environ.get("API_BASE", "https://vms-platform-production.up.railway.app")),
                ("SUPABASE_URL", os.environ.get("SUPABASE_URL", "")),
                ("SUPABASE_SERVICE_KEY", os.environ.get("SUPABASE_SERVICE_KEY", "")),
                ("MEDIAMTX_RTSP_URL", os.environ.get("MEDIAMTX_RTSP_URL", "")),
                ("MEDIAMTX_PUBLISH_SECRET", os.environ.get("MEDIAMTX_PUBLISH_SECRET", "")),
            ]

            for nome_var, valor_var in variaveis:
                query_var = (
                    'mutation { variableUpsert(input: { '
                    'projectId: "' + RAILWAY_PROJECT_ID + '" '
                    'serviceId: "' + service_id + '" '
                    'environmentId: "' + RAILWAY_ENVIRONMENT_ID + '" '
                    'name: "' + nome_var + '" '
                    'value: "' + valor_var + '" '
                    '}) }'
                )
                await client.post(
                    "https://backboard.railway.com/graphql/v2",
                    json={"query": query_var},
                    headers={"Authorization": "Bearer " + RAILWAY_API_TOKEN, "Content-Type": "application/json"}
                )
                print("[RAILWAY] Variavel " + nome_var + " configurada", flush=True)

            query_instance = (
                'mutation { serviceInstanceUpdate(serviceId: "' + service_id + '" input: { '
                'rootDirectory: "/" '
                'startCommand: "python worker.py" '
                '}) }'
            )
            await client.post(
                "https://backboard.railway.com/graphql/v2",
                json={"query": query_instance},
                headers={"Authorization": "Bearer " + RAILWAY_API_TOKEN, "Content-Type": "application/json"}
            )
            print("[RAILWAY] Worker configurado e pronto!", flush=True)
            return service_id
    except Exception as e:
        print("[RAILWAY] Erro: " + str(e), flush=True)
        return None


async def reiniciar_worker_railway(service_id: str):
    """Reinicia (redeploy) um worker existente no Railway, para ele reler a lista de cameras."""
    if not RAILWAY_API_TOKEN or not service_id:
        print("[RAILWAY] Token ou service_id ausente, nao foi possivel reiniciar worker", flush=True)
        return False
    query_redeploy = (
        'mutation { serviceInstanceRedeploy('
        'serviceId: "' + service_id + '" '
        'environmentId: "' + RAILWAY_ENVIRONMENT_ID + '" '
        ') }'
    )
    try:
        async with httpx.AsyncClient() as client:
            res = await client.post(
                "https://backboard.railway.com/graphql/v2",
                json={"query": query_redeploy},
                headers={"Authorization": "Bearer " + RAILWAY_API_TOKEN, "Content-Type": "application/json"},
                timeout=30
            )
            data = res.json()
            if "errors" in data:
                print("[RAILWAY] Erro ao reiniciar worker " + service_id + ": " + str(data["errors"]), flush=True)
                return False
            print("[RAILWAY] Worker " + service_id + " reiniciado com sucesso", flush=True)
            return True
    except Exception as e:
        print("[RAILWAY] Erro ao reiniciar worker " + service_id + ": " + str(e), flush=True)
        return False
