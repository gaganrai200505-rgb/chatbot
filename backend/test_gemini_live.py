"""Definitive test: does the Gemini Live WebSocket API accept our handshake?"""
import json, ssl, sys, time, os
from dotenv import load_dotenv
load_dotenv()

try:
    from websocket import create_connection
except ImportError:
    print("NO_WEBSOCKET_CLIENT - pip install websocket-client")
    sys.exit(0)

key = os.getenv("GEMINI_API_KEY", "")
if not key:
    print("NO_GEMINI_KEY")
    sys.exit(0)

MODELS = [
    "gemini-2.5-flash-native-audio-latest",
    "gemini-2.0-flash-exp",
]

for model in MODELS:
    print(f"\n--- Testing model: {model} ---")
    try:
        url = (
            "wss://generativelanguage.googleapis.com/ws/"
            "google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent"
            f"?key={key}"
        )
        ws = create_connection(url, timeout=12, sslopt={"cert_reqs": ssl.CERT_NONE})
        print("  WebSocket connected [OK]")
        time.sleep(1)

        print(f"  API key prefix: {key[:6]}...")
        setup = {
            "setup": {
                "model": f"models/{model}",
                "generationConfig": {
                    "responseModalities": ["AUDIO"],
                    "speechConfig": {
                        "voiceConfig": {
                            "prebuiltVoiceConfig": {"voiceName": "Aoede"}
                        }
                    }
                }
            }
        }
        print("  Sending setup...")
        ws.send(json.dumps(setup))
        print("  Setup sent [OK]")

        end = time.time() + 8
        ws.settimeout(3)
        got_any = False
        while time.time() < end:
            try:
                msg = ws.recv()
                print(f"  RAW MSG RECV ({len(msg)} bytes): {msg[:200]}")
            except Exception as recv_err:
                print(f"  Recv exception: {type(recv_err).__name__}: {recv_err}")
                break
            if not msg:
                continue
            got_any = True
            try:
                d = json.loads(msg)
                keys = list(d.keys())
                print(f"  Parsed JSON keys: {keys}")
                if "setupComplete" in d:
                    print(f"  [OK] MODEL {model} -- setupComplete received!")
                    ws.close()
                    sys.exit(0)
                if "serverContent" in d or "toolCall" in d:
                    print(f"  [OK] MODEL {model} -- LIVE (server content received)!")
                    ws.close()
                    sys.exit(0)
                if "error" in d:
                    print(f"  [ERROR]: {d['error']}")
                    break
            except Exception as parse_err:
                print(f"  (JSON parse error: {parse_err})")

        if not got_any:
            print(f"  [FAIL] No response within 8s")
        try:
            ws.close()
        except Exception:
            pass

    except Exception as e:
        print(f"  [CONNECT ERROR]: {type(e).__name__}: {e}")

print("\n=== ALL MODELS FAILED ===")