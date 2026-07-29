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


# Mapping of language codes to full names (for logging)
LANGUAGE_NAMES = {
    "en": "English",
    "hi": "Hindi",
    "kn": "Kannada",
}

# Supported language codes
SUPPORTED_LANGUAGES = {"en", "hi", "kn"}


def detect_language(text: str) -> str:
    """
    Detect the language of the input text.
    """
    import re
    clean = text.strip()

    # Fast ASCII / Latin character heuristic: if text is English characters, return "en" immediately
    if re.match(r'^[a-zA-Z0-9\s\?\!\.\,\'\-]+$', clean):
        return "en"

    try:
        detected = detect(clean)
        print(f"[Translation] Detected language: {detected}")

        if detected == "kn":
            return "kn"
        elif detected == "hi":
            return "hi"
        else:
            return "en"

    except LangDetectException:
        print("[Translation] Language detection failed, defaulting to English.")
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
