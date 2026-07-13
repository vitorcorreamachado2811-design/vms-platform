import os
import re
import docker

DOCKER_NETWORK = os.environ.get("DOCKER_NETWORK", "backend_vms-net")
WORKER_IMAGE = os.environ.get("WORKER_IMAGE", "vms-worker:latest")

_client = None


def _get_client():
    global _client
    if _client is None:
        _client = docker.from_env()
    return _client


def _slugify(nome: str) -> str:
    """Converte o nome da empresa em um nome valido de container Docker."""
    slug = nome.lower().strip()
    slug = re.sub(r"[^a-z0-9-]+", "-", slug)
    slug = re.sub(r"-+", "-", slug).strip("-")
    return slug or "empresa"


def criar_worker_docker(empresa_id: str, empresa_nome: str):
    """Cria um novo container Docker (worker) para a empresa, equivalente ao
    antigo criar_worker_railway(). Retorna o nome do container criado, que e
    salvo em empresa.railway_service_id (mesmo campo, reaproveitado)."""
    client = _get_client()
    nome_container = "worker-" + _slugify(empresa_nome)

    try:
        antigo = client.containers.get(nome_container)
        print(f"[DOCKER] Container {nome_container} ja existe, removendo antes de recriar", flush=True)
        antigo.remove(force=True)
    except docker.errors.NotFound:
        pass

    variaveis = {
        "EMPRESA_ID": empresa_id,
        "API_BASE": os.environ.get("API_BASE", ""),
        "SUPABASE_URL": os.environ.get("SUPABASE_URL", ""),
        "SUPABASE_SERVICE_KEY": os.environ.get("SUPABASE_SERVICE_KEY", ""),
        "MEDIAMTX_RTSP_URL": os.environ.get("MEDIAMTX_RTSP_URL", ""),
        "MEDIAMTX_PUBLISH_SECRET": os.environ.get("MEDIAMTX_PUBLISH_SECRET", ""),
    }

    try:
        container = client.containers.run(
            image=WORKER_IMAGE,
            name=nome_container,
            environment=variaveis,
            network=DOCKER_NETWORK,
            restart_policy={"Name": "unless-stopped"},
            detach=True,
        )
        print(f"[DOCKER] Worker criado: {nome_container} ({container.id[:12]})", flush=True)
        return nome_container
    except Exception as e:
        print(f"[DOCKER] Erro ao criar worker {nome_container}: {e}", flush=True)
        return None


def reiniciar_worker_docker(nome_container: str):
    """Reinicia (restart) um worker existente, equivalente ao antigo
    reiniciar_worker_railway(). Usado quando a lista de cameras muda."""
    if not nome_container:
        print("[DOCKER] Nome do container ausente, nao foi possivel reiniciar worker", flush=True)
        return False
    try:
        client = _get_client()
        container = client.containers.get(nome_container)
        container.restart(timeout=10)
        print(f"[DOCKER] Worker {nome_container} reiniciado com sucesso", flush=True)
        return True
    except docker.errors.NotFound:
        print(f"[DOCKER] Worker {nome_container} nao encontrado", flush=True)
        return False
    except Exception as e:
        print(f"[DOCKER] Erro ao reiniciar worker {nome_container}: {e}", flush=True)
        return False
