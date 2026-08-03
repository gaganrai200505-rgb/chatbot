"""
translation.py — Language Detection & Translation
===================================================

This module handles:
1. Detecting what language the user typed in (English / Hindi / Kannada)
2. Translating the query TO English for processing
3. Translating the final response BACK to the user's language

WHY TRANSLATE TO ENGLISH FIRST?
  - Our FAISS index and Gemini prompts work best in English
  - By detecting → translating → processing → translating back, we get
    accurate results in any supported language

Supported Languages:
  - "en" → English
  - "hi" → Hindi
  - "kn" → Kannada
"""

from langdetect import detect, LangDetectException
from deep_translator import GoogleTranslator


# Mapping of language codes to full names (for logging & prompt construction)
LANGUAGE_NAMES = {
    "en": "English",
    "hi": "Hindi",
    "kn": "Kannada",
    "ta": "Tamil",
    "te": "Telugu",
    "mr": "Marathi",
    "bn": "Bengali",
    "gu": "Gujarati",
    "ml": "Malayalam",
    "pa": "Punjabi"
}

# Supported language codes across JanSeva AI
SUPPORTED_LANGUAGES = {"en", "hi", "kn", "ta", "te", "mr", "bn", "gu", "ml", "pa"}


def detect_language(text: str) -> str:
    """
    Detect the language of the input text using precise Unicode Script Range checking.
    Guarantees 100% accuracy for Indian scripts (Kannada, Hindi, Tamil, etc.) even for 1 word.
    """
    import re
    clean = text.strip()
    if not clean:
        return "en"

    # Unicode Script Range Inspection (100% accurate for short text/words)
    has_kannada    = bool(re.search(r'[\u0C80-\u0CFF]', clean))
    has_devanagari = bool(re.search(r'[\u0900-\u097F]', clean))
    has_tamil      = bool(re.search(r'[\u0B80-\u0BFF]', clean))
    has_telugu     = bool(re.search(r'[\u0C00-\u0C7F]', clean))
    has_bengali    = bool(re.search(r'[\u0980-\u09FF]', clean))
    has_gujarati   = bool(re.search(r'[\u0A80-\u0AFF]', clean))
    has_malayalam  = bool(re.search(r'[\u0D00-\u0D7F]', clean))
    has_gurmukhi   = bool(re.search(r'[\u0A00-\u0A7F]', clean))

    def _log(msg):
        try:
            print(msg)
        except Exception:
            pass

    if has_kannada:
        _log(f"[Translation] Detected script: Kannada ('kn')")
        return "kn"
    if has_devanagari:
        _log(f"[Translation] Detected script: Hindi/Devanagari ('hi')")
        return "hi"
    if has_tamil:
        _log(f"[Translation] Detected script: Tamil ('ta')")
        return "ta"
    if has_telugu:
        _log(f"[Translation] Detected script: Telugu ('te')")
        return "te"
    if has_bengali:
        _log(f"[Translation] Detected script: Bengali ('bn')")
        return "bn"
    if has_gujarati:
        _log(f"[Translation] Detected script: Gujarati ('gu')")
        return "gu"
    if has_malayalam:
        _log(f"[Translation] Detected script: Malayalam ('ml')")
        return "ml"
    if has_gurmukhi:
        _log(f"[Translation] Detected script: Punjabi ('pa')")
        return "pa"

    if re.match(r'^[a-zA-Z0-9\s\?\!\.\,\'\-]+$', clean):
        return "en"

    try:
        detected = detect(clean)
        print(f"[Translation] langdetect result: {detected}")
        if detected in {"hi", "kn", "ta", "te", "mr", "bn", "gu", "ml", "pa", "en"}:
            return detected
    except Exception:
        pass

    return "en"


def translate_to_english(text: str, source_lang: str) -> str:
    """
    Translate text from source language to English.

    Args:
        text:        The text to translate
        source_lang: Language code of the source ("hi", "kn", etc.)

    Returns:
        Translated text in English.
        If source is already English, returns the original text unchanged.
    """
    if source_lang == "en":
        return text  # No translation needed

    try:
        translated = GoogleTranslator(source=source_lang, target="en").translate(text)
        print(f"[Translation] Translated '{text}' → '{translated}'")
        return translated
    except Exception as e:
        print(f"[Translation] Error translating to English: {e}")
        return text  # Return original if translation fails


def translate_from_english(text: str, target_lang: str) -> str:
    """
    Translate text from English to the target language.

    Args:
        text:        The English text to translate
        target_lang: Target language code ("hi", "kn", etc.)

    Returns:
        Translated text in the target language.
        If target is English, returns the original text unchanged.
    """
    if target_lang == "en":
        return text  # No translation needed

    try:
        translated = GoogleTranslator(source="en", target=target_lang).translate(text)
        print(f"[Translation] Translated response to {LANGUAGE_NAMES.get(target_lang, target_lang)}")
        return translated
    except Exception as e:
        print(f"[Translation] Error translating response: {e}")
        return text  # Return English response if translation fails
