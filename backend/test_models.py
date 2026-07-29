import google.generativeai as genai
import os
from dotenv import load_dotenv

load_dotenv()
api_key = os.getenv("GEMINI_API_KEY")

if not api_key:
    print("No API Key found")
else:
    genai.configure(api_key=api_key)
    try:
        models = genai.list_models()
        with open("models.txt", "w") as f:
            for m in models:
                if "generateContent" in m.supported_generation_methods:
                    f.write(f"{m.name}\n")
        print("Success, models written to models.txt")
    except Exception as e:
        print(f"Failed: {e}")
        with open("models.txt", "w") as f:
            f.write(str(e))
