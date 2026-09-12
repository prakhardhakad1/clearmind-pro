import sys
import os
import urllib.parse

root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if root_dir not in sys.path:
    sys.path.insert(0, root_dir)

from main import app as fastapi_app

async def app(scope, receive, send):
    if scope.get('type') == 'http':
        headers = dict(scope.get('headers', []))
        matched_path = headers.get(b'x-matched-path', b'').decode('latin1')
        
        qs = scope.get('query_string', b'').decode('latin1')
        route_param = None
        for part in qs.split('&'):
            if part.startswith('_route='):
                route_param = urllib.parse.unquote(part.split('=', 1)[1])
                break
                
        if route_param:
            target_path = f'/api/{route_param}' if not route_param.startswith('/') else route_param
            scope['path'] = target_path
            scope['raw_path'] = target_path.encode('latin1')
        elif matched_path and not matched_path.endswith('.py'):
            scope['path'] = matched_path
            scope['raw_path'] = matched_path.encode('latin1')
            
    return await fastapi_app(scope, receive, send)
