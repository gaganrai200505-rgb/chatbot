import asyncio, dotenv, os
dotenv.load_dotenv()
key = os.getenv("GEMINI_API_KEY")
from google import genai
from google.genai import types

client = genai.Client(api_key=key)

candidate_models = [
    "gemini-2.5-flash-native-audio-latest",
    "gemini-2.5-flash-native-audio-preview-09-2025",
    "gemini-2.5-flash-native-audio-preview-12-2025",
    "gemini-3.1-flash-live-preview",
    "gemini-2.0-flash",
    "gemini-2.0-flash-001",
    "gemini-2.5-flash"
]

async def test():
    for m in candidate_models:
        print(f"Testing model: {m} ...")
        try:
            async with client.aio.live.connect(model=m, config=types.LiveConnectConfig(response_modalities=["AUDIO"])) as session:
                print(f" SUCCESS! Connected to {m}")
                return m
        except Exception as e:
            print(f"  FAIL {m}: {e}")
    return None

if __name__ == "__main__":
    res = asyncio.run(test())
    print(f"\nFinal Result: {res}")
