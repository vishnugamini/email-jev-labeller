import os
import re
import secrets
from pathlib import Path
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from starlette.middleware.cors import CORSMiddleware
from .engine import Engine, MODEL
from .models import ClassifyRequest, OverrideRequest, ResetRequest, Preferences


def create_app(data_dir=None, token=None, origin=None, provider=None):
    directory = Path(data_dir or os.environ.get('JEV_DATA_DIR', '.local'))
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(directory, 0o700)
    token_path = directory / 'pairing-token'
    if token is None:
        if not token_path.exists():
            token_path.write_text(secrets.token_urlsafe(32))
            token_path.chmod(0o600)
        token = token_path.read_text().strip()
    origin = origin or os.environ.get('JEV_EXTENSION_ORIGIN', '')
    if not re.fullmatch(r'chrome-extension://[a-p]{32}', origin):
        raise ValueError('Set JEV_EXTENSION_ORIGIN to chrome-extension:// followed by your extension ID.')
    engine = Engine(directory / 'state.sqlite3', provider)
    (directory / 'state.sqlite3').chmod(0o600)
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    app.state.engine = engine

    @app.middleware('http')
    async def secure(request: Request, call_next):
        actual_origin = request.headers.get('origin')
        claimed_origin = request.headers.get('x-jev-extension-origin')
        if (actual_origin is not None and actual_origin != origin) or (actual_origin is None and claimed_origin != origin):
            return JSONResponse({'detail': 'Extension origin not paired.'}, status_code=403)
        if request.method != 'OPTIONS':
            auth = request.headers.get('authorization', '')
            if not secrets.compare_digest(auth, f'Bearer {token}'):
                return JSONResponse({'detail': 'Pairing token is missing or incorrect.'}, status_code=401)
            size = 0
            chunks = []
            async for chunk in request.stream():
                size += len(chunk)
                if size > 1_000_000:
                    return JSONResponse({'detail': 'Request too large.'}, status_code=413)
                chunks.append(chunk)
            request._body = b''.join(chunks)
        return await call_next(request)

    app.add_middleware(CORSMiddleware, allow_origins=[origin], allow_methods=['GET', 'POST', 'PUT', 'DELETE'], allow_headers=['Authorization', 'Content-Type', 'X-Jev-Extension-Origin'])

    @app.exception_handler(RequestValidationError)
    async def invalid_request(request, exc):
        return JSONResponse({'detail': 'Invalid request fields.'}, status_code=422)

    @app.get('/health')
    def health():
        return {'ok': True, 'key_configured': bool(os.environ.get('TYPESAFE_API_KEY')), 'model': MODEL}

    @app.get('/preferences')
    def preferences():
        return engine.preferences

    @app.put('/preferences')
    async def save_preferences(prefs: Preferences):
        async with engine.lock:
            try:
                engine.save_preferences(prefs)
            except ValueError as exc:
                raise HTTPException(400, str(exc))
        return engine.preferences

    @app.post('/classify')
    async def classify(body: ClassifyRequest):
        ids = [e.id for e in body.emails]
        if len(ids) != len(set(ids)):
            raise HTTPException(400, 'Duplicate observation IDs.')
        return {'results': await engine.classify(body.emails)}

    @app.put('/overrides')
    async def override(body: OverrideRequest):
        async with engine.lock:
            try:
                engine.override(body.email, body.category)
            except ValueError as exc:
                raise HTTPException(409, str(exc))
        return {'ok': True}

    @app.delete('/overrides')
    async def reset(body: ResetRequest):
        async with engine.lock:
            try:
                engine.override(body.email)
            except ValueError as exc:
                raise HTTPException(409, str(exc))
        return {'ok': True}

    @app.delete('/cache')
    async def clear():
        async with engine.lock:
            engine.clear_cache()
        return {'ok': True}

    @app.get('/activity')
    def activity():
        return engine.activity

    return app
