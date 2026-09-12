import sys
import os
import json

root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if root_dir not in sys.path:
    sys.path.insert(0, root_dir)

from main import app as fastapi_app

async def app(scope, receive, send):
    if scope['type'] == 'http':
        headers_dict = {k.decode('latin1'): v.decode('latin1') for k, v in scope.get('headers', [])}
        path = scope.get('path', '')
        
        # If debug header or test, return debug info
        if 'debug' in scope.get('query_string', b'').decode():
            response_body = json.dumps({
                'path': path,
                'raw_path': scope.get('raw_path', b'').decode('latin1'),
                'headers': headers_dict
            }, indent=2).encode('utf-8')
            
            await send({
                'type': 'http.response.start',
                'status': 200,
                'headers': [
                    [b'content-type', b'application/json'],
                    [b'content-length', str(len(response_body)).encode()]
                ]
            })
            await send({
                'type': 'http.response.body',
                'body': response_body
            })
            return
            
    return await fastapi_app(scope, receive, send)
