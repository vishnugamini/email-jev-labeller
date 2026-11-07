import argparse
import logging
import os
from pathlib import Path
import uvicorn
from .app import create_app

parser = argparse.ArgumentParser(description='Local Jev email classification service')
parser.add_argument('--extension-id', required=True, help='ID shown at chrome://extensions')
parser.add_argument('--port', type=int, default=8765)
args = parser.parse_args()
os.umask(0o077)
logging.getLogger('typesafe_sdk').disabled = True
app = create_app(origin=f'chrome-extension://{args.extension_id}')
print('Pairing token (paste into the extension popup):')
print(Path(os.environ.get('JEV_DATA_DIR', '.local'), 'pairing-token').read_text().strip())
uvicorn.run(app, host='127.0.0.1', port=args.port, access_log=False)
