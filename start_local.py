"""このPCの確認用。Gemma・Node・追加Pythonライブラリは不要。"""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import argparse
import functools
import webbrowser


class AppHandler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".webmanifest": "application/manifest+json",
    }

    def end_headers(self):
        # 実験用の閉じた iframe から読み込む静的モジュールを許可する。
        if self.path.startswith(("/js/", "/css/", "/mpl/")):
            self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_request(self, code="-", size="-"):
        if isinstance(code, int) and code >= 400:
            super().log_request(code, size)


parser = argparse.ArgumentParser(description="実験室をlocalhostで開く")
parser.add_argument("--port", type=int, default=8001)
parser.add_argument("--open", action="store_true", help="既定のブラウザで画面を開く")
parser.add_argument("--student", action="store_true", help="Bluetooth教室の児童画面を開く")
args = parser.parse_args()
public = Path(__file__).resolve().parent / "public"
handler = functools.partial(AppHandler, directory=str(public))
try:
    server = ThreadingHTTPServer(("127.0.0.1", args.port), handler)
except OSError:
    raise SystemExit("ポートが使われています。python start_local.py --port 8002 で開き直せます。")
page = "student.html?ble" if args.student else "demo.html?demo"
url = f"http://127.0.0.1:{server.server_port}/{page}"
print(f"\n開くページ: {url}", flush=True)
print("利用中はこのウィンドウを開いたままにしてください。終了は Ctrl+C。\n", flush=True)
with server:
    if args.open:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
