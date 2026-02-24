# Budowanie obrazów Docker

## Błąd EIO przy `docker compose build frontend`

Podczas `npm ci` w kontenerze może pojawić się **EIO: i/o error** (np. przy usuwaniu katalogów w `node_modules`). To znany problem Dockera na Windowsie (WSL2 / dysk wirtualny).

### Co zrobić

1. **Włącz BuildKit** (frontend Dockerfile używa cache mount):
   ```bash
   set DOCKER_BUILDKIT=1
   docker compose build --no-cache frontend
   ```

2. **Buduj z poziomu WSL** – sklonuj repo w systemie plików WSL (np. `~/projekty/3D-Cake-Editor`), nie z `C:\Users\...`. W terminalu WSL:
   ```bash
   cd ~/projekty/3D-Cake-Editor
   docker compose build --no-cache frontend
   ```

3. **Zasoby Docker Desktop** – w Ustawieniach zwiększ **Memory** i **Disk image size** (np. 4 GB RAM, 60 GB dysk).

4. **Bez `--no-cache`** – spróbuj zwykłej budowy (warstwa z `npm ci` może być w cache):
   ```bash
   docker compose build frontend
   ```

Błąd **"failed to receive status: rpc error: ... EOF"** często występuje razem z EIO, gdy build się rozłącza lub Docker zużywa zbyt dużo zasobów.
