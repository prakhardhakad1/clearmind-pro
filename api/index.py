import sys
import os

root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if root_dir not in sys.path:
    sys.path.insert(0, root_dir)

try:
    from main import app
except BaseException as e:
    import traceback
    err_trace = traceback.format_exc()
    from fastapi import FastAPI
    from fastapi.responses import PlainTextResponse
    app = FastAPI()
    @app.get("/")
    @app.api_route("/{path:path}", methods=["GET", "POST", "PUT", "DELETE"])
    async def catch_all(path: str = ""):
        return PlainTextResponse(f"Startup Crash Traceback:\n{err_trace}", status_code=500)
