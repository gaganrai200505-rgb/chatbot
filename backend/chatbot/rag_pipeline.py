"""
rag_pipeline.py — Retrieval Augmented Generation (RAG) Core
=============================================================

This is the main AI pipeline. It orchestrates:

  1. FAISS vector search (find relevant scheme from knowledge base)
  2. Similarity threshold check (Is the match good enough?)
  3. If YES → Use knowledge base context with Gemini
  4. If NO  → Fallback to DuckDuckGo web search + Gemini

WHAT IS RAG?
  RAG = Retrieval Augmented Generation
  - "Retrieval": Find relevant documents using vector similarity search
  - "Augmented": Add those documents as context to the AI prompt
  - "Generation": The AI (Gemini) generates a response using that context
  
  This avoids AI hallucination because Gemini is given REAL data to work with.

SIMILARITY THRESHOLD:
  - Score > 0.75 → Good match → Use knowledge base
  - Score ≤ 0.75 → Poor match → Web search fallback
"""

from groq import Groq
from django.conf import settings

from .embeddings import build_faiss_index, encode_query
from .web_search import search_web

# -------------------------------------------------------
# FAISS Similarity Threshold
# -------------------------------------------------------
SIMILARITY_THRESHOLD = 0.45

# -------------------------------------------------------
# Initialize Groq
# -------------------------------------------------------
def _get_groq_client():
    """Configure and return the Groq client (lazy initialization)."""
    api_key = settings.GROQ_API_KEY
    if not api_key:
        raise ValueError(
            "GROQ_API_KEY is not set! "
            "Please add it to your .env file in the backend/ directory."
        )
    return Groq(api_key=api_key, timeout=15.0)


def _call_groq_with_fallback(messages, max_tokens=None, temperature=None, prefer_fast: bool = False) -> str:
    """
    Executes a chat completion with automatic model failover.
    prefer_fast=True: tries llama-3.1-8b-instant first (lowest latency for voice mode).
    prefer_fast=False: tries llama-3.3-70b-versatile first (best quality for chat mode).
    """
    client = _get_groq_client()
    if prefer_fast:
        # Voice mode: prioritise ultra-low-latency 8B model
        models_to_try = [
            "llama-3.1-8b-instant",
            "gemma2-9b-it",
            "llama-3.3-70b-versatile",
        ]
    else:
        models_to_try = [
            "llama-3.3-70b-versatile",
            "llama-3.1-8b-instant",
            "gemma2-9b-it",
        ]

    last_error = None
    for model_name in models_to_try:
        try:
            kwargs = {"messages": messages, "model": model_name}
            if max_tokens:
                kwargs["max_tokens"] = max_tokens
            if temperature is not None:
                kwargs["temperature"] = temperature

            res = client.chat.completions.create(**kwargs)
            return res.choices[0].message.content.strip()
        except Exception as e:
            last_error = e
            print(f"[RAG] Groq model '{model_name}' rate limit or error ({e}). Trying fallback model...")

    raise last_error


def _call_groq_stream_with_fallback(messages, max_tokens=None, temperature=None, prefer_fast: bool = False):
    """
    Executes a streaming chat completion yielding token chunks as they arrive.
    """
    client = _get_groq_client()
    models_to_try = [
        "llama-3.1-8b-instant",
        "gemma2-9b-it",
        "llama-3.3-70b-versatile",
    ] if prefer_fast else [
        "llama-3.3-70b-versatile",
        "llama-3.1-8b-instant",
        "gemma2-9b-it",
    ]

    last_error = None
    for model_name in models_to_try:
        try:
            kwargs = {"messages": messages, "model": model_name, "stream": True}
            if max_tokens:
                kwargs["max_tokens"] = max_tokens
            if temperature is not None:
                kwargs["temperature"] = temperature

            stream_res = client.chat.completions.create(**kwargs)
            for chunk in stream_res:
                content = chunk.choices[0].delta.content
                if content:
                    yield content
            return
        except Exception as e:
            last_error = e
            print(f"[RAG Stream] Groq model '{model_name}' error ({e}). Trying fallback model...")

    if last_error:
        yield "I ran into a temporary network delay trying to fetch that."


# -------------------------------------------------------
# FAISS Search
# -------------------------------------------------------
def retrieve_from_knowledge_base(query_english: str):
    """
    Search the FAISS index for the most similar schemes.

    Args:
        query_english: The user's query translated to English

    Returns:
        Tuple: (matched_schemes_list, max_similarity_score)
    """
    index, schemes = build_faiss_index()
    if index is None or index.ntotal == 0:
        return [], 0.0

    query_vector = encode_query(query_english)

    # Search for top-3 most similar results to improve LLM context size
    k_val = min(3, index.ntotal)
    D, I = index.search(query_vector, k=k_val)

    matched_schemes = []
    best_score = 0.0
    
    for score, idx in zip(D[0], I[0]):
        similarity_score = float(score)
        best_index = int(idx)
        if best_index >= 0 and similarity_score >= SIMILARITY_THRESHOLD:
            matched_schemes.append(schemes[best_index])
            best_score = max(best_score, similarity_score)
            
    if matched_schemes:
        print(f"[RAG] FAISS matched {len(matched_schemes)} schemes. Best score: {best_score:.4f}")
        return matched_schemes, best_score
    else:
        print("[RAG] Score below threshold, will use web search fallback.")
        return [], 0.0


# -------------------------------------------------------
# Build Prompts
# -------------------------------------------------------
def _build_kb_prompt(query: str, matched_schemes: list, web_results: str = "") -> str:
    """
    Build a prompt using knowledge base context, enriched with web search context if available.

    Args:
        query:           The original query (English)
        matched_schemes: The list of matched scheme dictionaries
        web_results:     Optional additional search results from web

    Returns:
        A formatted prompt string
    """
    combined_context = ""
    for idx, scheme in enumerate(matched_schemes):
        combined_context += f"--- Scheme {idx + 1}: {scheme['title']} ---\n"
        combined_context += f"Description: {scheme['description']}\n"
        combined_context += f"Key Details:\n{scheme.get('details', '')}\n\n"

    web_context_str = ""
    if web_results:
        web_context_str = f"\nADDITIONAL WEB SEARCH CONTEXT:\n{web_results}\n"

    return f"""You are an authoritative government scheme assistant for Indian citizens. 
Answer the user's question about government schemes accurately, comprehensively, and clearly.

PRIMARY SCHEME CONTEXT FROM KNOWLEDGE BASE:
{combined_context}
{web_context_str}
USER QUESTION: {query}

IMPORTANT INSTRUCTIONS:
Please construct your answer using EXACTLY the following structure with Markdown headings.
Use the primary scheme context as your foundational source. If any section (such as Documents Required, Eligibility, or Step-by-Step Application process) is incomplete in the knowledge base, use the additional web context and your verified knowledge about official Indian Government schemes to fill in all missing details. NEVER output "Information not available"; always provide helpful, complete, and accurate information for all four sections.

INTERACTIVE ELIGIBILITY CHECK:
If the user asks whether they are eligible for the scheme but crucial details (like age, land holding, annual income, or category) are missing from the conversation, include 1-2 friendly interactive follow-up questions at the end asking for those details so you can calculate their exact eligibility for them.

CRITICAL FORMATTING RULE:
Start your response IMMEDIATELY with "**Scheme Details:**". Do NOT include any introductory greetings, meta-disclaimers, or notes about web search results.
Under "**How to Apply:**" or when referencing application steps, ALWAYS include the exact official .gov.in portal link in markdown format (e.g. [Apply on Official Portal](https://beneficiary.nha.gov.in) or [PM Kisan Portal](https://pmkisan.gov.in)).

**Scheme Details:**
(Provide a comprehensive overview, key benefits, and official department)

**Eligibility Criteria:**
(Provide clear, bulleted eligibility conditions)

**How to Apply:**
(Provide clear step-by-step instructions or modes of application with official .gov.in portal links)

**Documents Required:**
(List out all required documents in bullet points, such as Aadhaar Card, Income Certificate, Caste Certificate, Ration Card, Bank Passbook, etc.)
"""


def _build_web_prompt(query: str, web_results: str) -> str:
    """
    Build a prompt using web search results with strict domain guardrails.
    """
    return f"""You are JanSeva AI, specialized EXCLUSIVELY in Indian Central and State Government schemes, welfare programs, scholarships, health insurance, pensions, subsidies, and public services.

WEB SEARCH CONTEXT:
{web_results}

USER QUESTION: {query}

IMPORTANT INSTRUCTIONS:
1. IF USER QUESTION IS ABOUT A VALID GOVERNMENT SCHEME OR PUBLIC SERVICE:
   Start your response IMMEDIATELY with "**Scheme Details:**" and provide the 4 sections below.
2. IF USER QUESTION IS OFF-TOPIC OR NON-GOVERNMENT (e.g. asking about a celebrity, cricketer, actor, movie, sports star, general topic):
   DO NOT use the 4-section scheme template. Respond ONLY with:
   "I am JanSeva AI, specialized strictly in Indian Government schemes and welfare services. Please ask me any question about government schemes like Ayushman Bharat, PM Kisan, NSP scholarships, or state welfare programs!"

**Scheme Details:**
(Provide a comprehensive overview, key benefits, and official department)

**Eligibility Criteria:**
(Provide clear, bulleted eligibility conditions)

**How to Apply:**
(Provide clear step-by-step instructions or modes of application with official .gov.in portal links)

**Documents Required:**
(List out all required documents in bullet points)
"""


def _build_fallback_prompt(query: str) -> str:
    """Build a prompt allowing LLM to answer from its internal knowledge securely with domain guardrails."""
    return f"""You are JanSeva AI, specialized EXCLUSIVELY in Indian Central and State Government schemes, welfare programs, scholarships, health insurance, pensions, subsidies, and public services.

USER QUESTION: {query}

IMPORTANT INSTRUCTIONS:
1. IF USER QUESTION IS ABOUT A VALID GOVERNMENT SCHEME OR PUBLIC SERVICE:
   Start your response IMMEDIATELY with "**Scheme Details:**" and provide the 4 sections below.
2. IF USER QUESTION IS OFF-TOPIC OR NON-GOVERNMENT (e.g. asking about a celebrity, cricketer, actor, movie, sports star, general topic):
   DO NOT use the 4-section scheme template. Respond ONLY with:
   "I am JanSeva AI, specialized strictly in Indian Government schemes and welfare services. Please ask me any question about government schemes like Ayushman Bharat, PM Kisan, NSP scholarships, or state welfare programs!"

**Scheme Details:**
(Provide a comprehensive overview, exact benefits, and official department)

**Eligibility Criteria:**
(Provide clear, bulleted eligibility conditions)

**How to Apply:**
(Provide clear step-by-step instructions or modes of application with official .gov.in portal links)

**Documents Required:**
(List out all required documents in bullet points)
"""


def is_conversational_ack(query: str) -> bool:
    """
    Detects acknowledgments, greetings, audio checks ('can you hear me', 'hello'),
    confirmations ('yes that is right', 'correct'), or chit-chat to prevent
    unwanted RAG search or scheme template dumps.
    """
    import re
    q_clean = re.sub(r'[^\w\s]', '', query.lower()).strip()

    # Direct conversational / audio check / greeting phrases
    conversational_phrases = [
        r'can you hear me', r'are you listening', r'can you hear', r'am i audible',
        r'hello', r'hi\b', r'hey\b', r'who are you', r'what is your name', r'how are you',
        r'good morning', r'good afternoon', r'good evening',
        r'mic check', r'audio check', r'testing', r'is anyone there', r'are you there',
        r'thank you', r'thanks', r'ok\b', r'okay\b', r'got it', r'understood', r'goodbye', r'bye\b',
        # Confirmations and affirmations
        r'yes\b', r'yeah\b', r'yep\b', r'yup\b', r'nope\b',
        r'yes that', r'yes thats', r'that is right', r'thats right', r'you are right',
        r'correct\b', r'exactly\b', r'indeed\b', r'absolutely\b', r'of course\b',
        r'right\b', r'sure\b', r'definitely\b', r'confirmed\b',
    ]

    for pattern in conversational_phrases:
        if re.search(pattern, q_clean):
            return True

    ack_words = {
        'ok', 'okay', 'k', 'kk', 'thanks', 'thank you', 'thx', 'thankyou',
        'got it', 'understood', 'cool', 'great', 'fine', 'sure', 'right',
        'yes', 'no', 'hello', 'hi', 'hey', 'bye', 'goodbye', 'nice', 'awesome',
        'ok thanks', 'okay thanks', 'yep', 'yeah', 'yup', 'nope', 'correct',
        'exactly', 'indeed', 'absolutely', 'definitely', 'confirmed', 'true',
        'yes please', 'no thanks', 'go on', 'continue', 'tell me more',
    }
    if q_clean in ack_words:
        return True

    return False


def is_specific_question(query: str, chat_history: list = None) -> bool:
    """
    Detects whether the query is a specific question/follow-up/answer (e.g., '5,00,000 5 acres' or 'obc no')
    vs a general scheme overview request (e.g., 'tell me about PM Kisan').
    """
    import re
    q_lower = query.lower().strip()

    # In an ongoing conversation (chat_history exists), always use direct answer mode
    # so we never repeat full 4-section scheme templates on follow-ups or answers!
    if chat_history and len(chat_history) > 0:
        return True

    specific_patterns = [
        r'\bcan i\b', r'\bam i\b', r'\bis it\b', r'\bcan a\b', r'\bcould i\b',
        r'\bmy income\b', r'\bmy age\b', r'\bincome is\b', r'\blakh\b', r'\beligible for\b',
        r'\bdo i need\b', r'\bis aadhaar\b', r'\bwhat is the age\b', r'\bhow much\b',
        r'\bwhen will\b', r'\bwhere can i\b', r'\bwhy\b', r'\bis there any\b', r'\bnot available for\b',
        r'\d+', r'\bacres?\b', r'\bobc\b', r'\bsc\b', r'\bst\b', r'\bgeneral\b', r'\bno\b', r'\byes\b'
    ]
    for pattern in specific_patterns:
        if re.search(pattern, q_lower):
            return True

    return False

LANGUAGE_NAMES = {
    'en': 'English',
    'hi': 'Hindi (हिंदी)',
    'kn': 'Kannada (ಕನ್ನಡ)',
    'ta': 'Tamil (தமிழ்)',
    'te': 'Telugu (తెలుగు)',
    'mr': 'Marathi (मराठी)',
    'bn': 'Bengali (বাংলা)',
    'gu': 'Gujarati (ગુજરાતી)',
    'ml': 'Malayalam (മലയാളം)',
    'pa': 'Punjabi (ਪੰਜਾਬੀ)',
    'auto': 'English'
}

def _build_conversational_ack_prompt(query: str, chat_history: list = None, target_lang: str = "en") -> str:
    """Build a prompt for conversational greetings, audio checks, or mid-chat acknowledgments."""
    lang_name = LANGUAGE_NAMES.get(target_lang, 'English')
    if chat_history and len(chat_history) > 0:
        recent = chat_history[-4:]
        lines = []
        for m in recent:
            role = "User" if m.get("role") == "user" else "JanSeva AI"
            lines.append(f"{role}: {m.get('content', '')[:200]}")
        history_str = "\n".join(lines)
        return f"""You are JanSeva AI in a real-time voice call.
RECENT CONVERSATION:
{history_str}

The user said: "{query}".
Give a warm, natural 1-sentence response (under 20 words) confirming their input and asking what specific detail about the scheme under discussion they would like to explore next (e.g., eligibility, benefits, or how to apply).
Write strictly in plain text without markdown or symbols."""
    else:
        return f"""The user said: "{query}" in {lang_name} to JanSeva AI (a real-time voice companion like ChatGPT Voice Mode).
Give a short, warm, natural 1-sentence response strictly in {lang_name} under 15 words, confirming you hear them loud and clear and asking what scheme they would like to explore today. Write strictly in plain text without markdown or symbols."""


def is_non_government_query(query: str) -> bool:
    """
    Detects if a query is clearly non-government (off-topic), e.g., sports personalities,
    celebrities, actors, politicians (non-scheme), movies, recipes, general trivia, etc.
    """
    import re
    q = query.lower().strip()

    # Broad off-topic regex patterns
    off_topic_patterns = [
        r'\bvirat\b', r'\bkohli\b', r'\bdhoni\b', r'\bsachin\b', r'\brohit\b',
        r'\bcricketer\b', r'\bcelebrity\b', r'\bactor\b', r'\bactress\b',
        r'\bmovie\b', r'\bcinema\b', r'\bipl\b', r'\bcricket\b', r'\bfootball\b',
        r'\btell me a joke\b', r'\bjoke\b', r'\bsing a song\b', r'\bweather in\b',
        r'\brecipe\b', r'\bhow to cook\b', r'\bpython code\b', r'\bjavascript\b',
        r'\bprogram\b', r'\bgame\b', r'\bcapital of\b', r'\bwho won\b',
        r'\bpresident of usa\b', r'\btrump\b', r'\bbiden\b',
    ]

    for p in off_topic_patterns:
        if re.search(p, q):
            # Exclude explicit scheme questions (e.g. "tell me about PM Kisan scheme")
            if not re.search(r'\b(scheme|yojana|welfare|pension|scholarship|subsidy|bima|card|portal|khelo india)\b', q):
                return True

    return False


def _build_voice_companion_prompt(query: str, context: str = "", target_lang: str = "en", chat_history: list = None) -> str:
    """Build a prompt tailored specifically for ChatGPT-style live voice companion interaction."""
    ctx_str = f"VERIFIED SCHEME CONTEXT:\n{context}\n\n" if context else ""
    lang_name = LANGUAGE_NAMES.get(target_lang, 'English')

    # Language determination for live voice companion
    import re
    is_query_english = bool(re.match(r'^[a-zA-Z0-9\s\?\!\.\,\'\-]+$', query.strip()))
    effective_lang = "English" if (is_query_english and target_lang == "en") else lang_name

    # Build a short conversation history string so the LLM knows what topic is active
    history_str = ""
    if chat_history:
        recent = chat_history[-4:]  # last 2 turns
        lines = []
        for m in recent:
            role = "User" if m.get("role") == "user" else "JanSeva AI"
            lines.append(f"{role}: {m.get('content', '')[:200]}")
        history_str = "\nRECENT CONVERSATION:\n" + "\n".join(lines) + "\n"

    return f"""You are JanSeva AI, an authoritative real-time voice companion specialized EXCLUSIVELY in Indian Central and State Government schemes, welfare programs, scholarships, health insurance, pensions, subsidies, and public services.

STRICT DOMAIN & GUARDRAIL RULES:
1. DOMAIN LOCK: YOU MUST ONLY DISCUSS INDIAN GOVERNMENT SCHEMES, WELFARE BENEFITS, AND PUBLIC SERVICES.
2. NON-GOVERNMENT GUARDRAIL: If the user asks an off-topic question (e.g. sports, movies, coding, recipes, weather, general trivia), POLITELY DECLINE. Say: "I am JanSeva AI, specialized strictly in Indian Government schemes and welfare services. Please ask me any question about government schemes like Ayushman Bharat, PM Kisan, or scholarship programs!"
3. SCHEME SWITCHING: If the user explicitly asks about a NEW government scheme (e.g. switching from Ayushman Bharat to PM Kisan), IMMEDIATELY switch to the new scheme asked by the user!
4. TOPIC CONTINUITY: If the user asks a follow-up question WITHOUT naming a new scheme (e.g., "Am I eligible?", "What documents do I need?"), answer specifically for the active scheme being discussed in RECENT CONVERSATION.
5. ACCURACY: Provide 100% accurate, verified details from the VERIFIED SCHEME CONTEXT. Do NOT invent fake income limits, age limits, or fake application steps.

LANGUAGE INSTRUCTION:
- The user spoke in {effective_lang}.
- You MUST respond STRICTLY in {effective_lang}. Write 100% in plain spoken {effective_lang}.

{history_str}
{ctx_str}USER SPOKEN QUESTION: "{query}"

CHATGPT VOICE AGENT RULES:
1. TALK LIKE CHATGPT VOICE: Be warm, friendly, natural, and human. Use short natural spoken intros (e.g., "Hey there!", "Oh sure!", "Got it, my friend!").
2. EXTREMELY CONCISE (15-35 WORDS MAX): Speak only 1 or 2 short sentences per turn. Never read long paragraphs or list bullet points.
3. PROACTIVE CONVERSATIONAL ENDING: Always end with a quick, natural 1-sentence question to keep the 2-way conversation going.
4. PLAIN SPOKEN TEXT ONLY: Absolutely NO markdown, NO asterisks (*), NO hash tags (#), NO numbers as lists, and NO URLs. Write exactly as spoken aloud.
"""


def _build_direct_answer_prompt(query: str, context: str, web_results: str = "", search_query: str = "") -> str:
    """
    Build a prompt that answers specific questions directly and concisely,
    calculating eligibility dynamically without repeating 4-section template headings.
    """
    extra_web = f"\nADDITIONAL WEB SEARCH CONTEXT:\n{web_results}\n" if web_results else ""
    target_topic = f"\nTARGET SCHEME / QUESTION TOPIC:\n{search_query}\n" if search_query else ""
    return f"""You are an authoritative government scheme assistant for Indian citizens.
Answer the user question directly, calculate eligibility accurately based on their answers, and be concise.
{target_topic}
SCHEME CONTEXT:
{context}
{extra_web}
USER QUESTION / RESPONSE: {query}

CRITICAL RULES:
1. FOCUS STRICTLY ON THE TARGET SCHEME / TOPIC ASKED BY THE USER ({search_query or query}).
   - Calculate eligibility STRICTLY for the scheme being discussed in the conversation.
   - DO NOT switch to or evaluate completely unrelated schemes unless the user explicitly requested them.
2. DO NOT OUTPUT FULL TEMPLATE HEADINGS (such as "## Scheme Details:", "## Eligibility Criteria:", "## How to Apply:", "## Documents Required:").
3. Give ONLY a direct, concise 2-4 sentence answer. Calculate their eligibility immediately based on their provided details (income, land, age, category).
4. If they are eligible, provide the 1-click official portal link (e.g. [Apply on Portal](https://...)). If they do not qualify, explain clearly in 1-2 sentences why.
5. Do NOT repeat questions that the user has already answered in the chat.
"""


def resolve_standalone_query(query_english: str, chat_history: list = None, prefer_fast: bool = False) -> str:
    """
    Converts ambiguous follow-up queries (e.g., 'eligibility', 'how to apply')
    into a self-contained search query using recent conversation context.
    Returns the original query unchanged if resolution fails or output looks wrong.
    """
    if not chat_history or is_conversational_ack(query_english):
        return query_english

    try:
        history_lines = []
        for m in chat_history[-6:]:
            role_label = "User" if m.get("role") == "user" else "Assistant"
            history_lines.append(f"{role_label}: {m.get('content', '')[:300]}")

        history_str = "\n".join(history_lines)

        prompt = f"""Given the conversation history below and a follow-up question, rephrase the follow-up question into a SHORT, standalone search query (maximum 12 words) that includes the specific scheme or topic name.

RULES:
- Output ONLY the rephrased query. Nothing else. No explanation.
- The output must be a search query, NOT a sentence like "I couldn't find..." or "Let's start fresh".
- If the follow-up is just a confirmation (yes/no/correct/right), return: "[Scheme name] overview" where [Scheme name] is the last scheme discussed.
- Maximum 12 words.

CONVERSATION HISTORY:
{history_str}

FOLLOW-UP QUESTION: {query_english}

STANDALONE QUERY:"""

        client = _get_groq_client()
        res = client.chat.completions.create(
            messages=[{"role": "user", "content": prompt}],
            model="llama-3.1-8b-instant" if prefer_fast else "llama-3.3-70b-versatile",
            max_tokens=25
        )
        resolved = res.choices[0].message.content.strip()

        # --- Output validation ---
        # Reject the resolved query if it looks like a conversational response, not a search query.
        bad_phrases = [
            "i couldn't find", "i could not find", "let's start fresh", "let us start fresh",
            "no specific scheme", "not mentioned", "not discussed", "no scheme was discussed",
            "i don't know", "i do not know", "unclear", "not clear", "i'm sorry", "i am sorry",
        ]
        resolved_lower = resolved.lower()
        for bad in bad_phrases:
            if bad in resolved_lower:
                print(f"[RAG] resolve_standalone_query returned invalid output: '{resolved}' — falling back to original")
                return query_english

        # Also reject if too long (prose, not a search query) or empty
        if not resolved or len(resolved.split()) > 15:
            print(f"[RAG] resolve_standalone_query output too long/empty: '{resolved}' — falling back")
            return query_english

        print(f"[RAG] Rephrased '{query_english}' -> '{resolved}'")
        return resolved
    except Exception as e:
        print(f"[RAG] Context resolution error: {e}")
        return query_english


def _save_web_knowledge_to_db(query: str, answer: str):
    """Auto-learn: Save newly searched web schemes to local SQLite DB."""
    from .models import GovernmentScheme
    from .embeddings import seed_db

    try:
        title_match = re.search(r'\*\*(?:Scheme Details|Name):\*\*\s*\n?\s*\*?\*?([^\*\n]+)', answer, re.IGNORECASE)
        if not title_match:
            title_match = re.search(r'##\s*([^\n]+)', answer)
            
        clean_title = title_match.group(1).strip() if title_match else query.title()[:100]
        
        if GovernmentScheme.objects.filter(title__iexact=clean_title).exists():
            return

        desc = answer[:500]
        
        scheme = GovernmentScheme.objects.create(
            title=clean_title,
            description=desc,
            details=answer
        )
        print(f"[Auto-Learning] Successfully saved new scheme '{clean_title}' (ID: {scheme.id}) to DB.")
        seed_db()
    except Exception as err:
        print(f"[Auto-Learning] Failed to auto-save scheme: {err}")


# -------------------------------------------------------
# RAG Pipeline Core Function
# -------------------------------------------------------
def get_rag_response(query_english: str, original_query: str, chat_history: list = None, selected_state: str = "", is_voice_mode: bool = False, target_lang: str = "en") -> dict:
    """
    Execute the RAG Pipeline.
    """
    if is_non_government_query(query_english):
        return {
            "response": "I am JanSeva AI, specialized strictly in Indian Government schemes and welfare services. Please ask me any question about government schemes like Ayushman Bharat, PM Kisan, NSP scholarships, or state welfare programs!",
            "source": "domain_guardrail"
        }

    if is_conversational_ack(query_english):
        print(f"[RAG] Conversational greeting / audio check / ack detected: '{query_english}'")
        try:
            client = _get_groq_client()
            prompt = _build_conversational_ack_prompt(query_english, chat_history=chat_history, target_lang=target_lang)
            res = client.chat.completions.create(
                messages=[{"role": "user", "content": prompt}],
                model="llama-3.1-8b-instant" if is_voice_mode else "llama-3.3-70b-versatile",
                max_tokens=40
            )
            return {
                "response": res.choices[0].message.content.strip(),
                "source": "conversational"
            }
        except Exception:
            return {
                "response": "Loud and clear! Ready when you are — ask me about any government scheme!",
                "source": "conversational"
            }

    search_query = query_english
    if chat_history:
        search_query = resolve_standalone_query(query_english, chat_history, prefer_fast=is_voice_mode)

    # State Auto-Detection from query
    indian_states = ["karnataka", "maharashtra", "tamil nadu", "kerala", "telangana", "andhra pradesh", "gujarat", "punjab", "haryana", "rajasthan", "uttar pradesh", "bihar", "west bengal", "madhya pradesh", "odisha", "delhi", "kashmir", "assam"]
    detected_state = ""
    for st in indian_states:
        if st in query_english.lower() or st in original_query.lower():
            detected_state = st.title()
            break

    effective_state = detected_state or selected_state
    if effective_state and effective_state != "All India / Central Govt" and effective_state.lower() not in search_query.lower():
        search_query = f"{search_query} in {effective_state}"
        print(f"[RAG] State filter applied: '{effective_state}' -> Search query: '{search_query}'")

    is_direct_q = is_specific_question(query_english, chat_history) or is_voice_mode
    matched_scheme, score = retrieve_from_knowledge_base(search_query)

    if is_voice_mode:
        if matched_scheme and score >= 0.55:
            kb_context_str = "\n".join([f"Scheme: {s['title']} (State/Dept: {s.get('state', 'All India')})\nDescription: {s['description']}\nDetails: {s.get('details','')}" for s in matched_scheme[:2]])
            prompt = _build_voice_companion_prompt(query_english, kb_context_str, target_lang=target_lang)
            source = "knowledge_base"
        else:
            web_results = search_web(search_query)
            prompt = _build_voice_companion_prompt(query_english, context=web_results, target_lang=target_lang)
            source = "web"
    elif matched_scheme:
        web_results = "" if score >= 0.55 else search_web(search_query)
        kb_context_str = "\n".join([f"{s['title']}: {s['description']}\n{s.get('details','')}" for s in matched_scheme])
        if is_direct_q:
            prompt = _build_direct_answer_prompt(query_english, kb_context_str, web_results=web_results, search_query=search_query)
        else:
            prompt = _build_kb_prompt(search_query, matched_scheme, web_results=web_results)
        source = "knowledge_base"
    else:
        web_results = search_web(search_query)
        if is_direct_q:
            prompt = _build_direct_answer_prompt(query_english, web_results or search_query, web_results=web_results, search_query=search_query)
            source = "web"
        elif web_results:
            prompt = _build_web_prompt(search_query, web_results)
            source = "web"
        else:
            prompt = _build_fallback_prompt(search_query)
            source = "llm_fallback"

    messages_payload = [{"role": "user", "content": prompt}]
    try:
        max_t = 280 if is_voice_mode else None
        answer = _call_groq_with_fallback(
            messages=messages_payload,
            max_tokens=max_t,
            prefer_fast=is_voice_mode
        )
        return {
            "response": answer,
            "source": source,
        }
    except Exception as e:
        return {
            "response": "I ran into a temporary network delay trying to fetch that. Could you ask me again?",
            "source": "error"
        }


def get_rag_response_stream(query_english: str, original_query: str, chat_history: list = None, selected_state: str = "", is_voice_mode: bool = False, target_lang: str = "en"):
    """
    Generator yielding realtime LLM tokens for ultra-low latency SSE response.
    """
    if is_non_government_query(query_english):
        yield "I am JanSeva AI, specialized strictly in Indian Government schemes and welfare services. Please ask me any question about government schemes like Ayushman Bharat, PM Kisan, NSP scholarships, or state welfare programs!"
        return

    if is_conversational_ack(query_english):
        try:
            prompt = _build_conversational_ack_prompt(query_english, chat_history=chat_history, target_lang=target_lang)
            for token in _call_groq_stream_with_fallback([{"role": "user", "content": prompt}], max_tokens=35, prefer_fast=is_voice_mode):
                yield token
            return
        except Exception:
            yield "I can hear you loud and clear! What government scheme would you like to explore today?"
            return

    search_query = query_english
    # Resolve standalone query when history exists:
    # Always resolve in voice mode (short follow-ups like "check my eligibility" lose context without it).
    # In text mode, resolve when the query is short (<= 10 words) or contains ambiguous pronouns/terms.
    ambiguous_terms = {
        'it', 'this', 'that', 'he', 'she', 'they', 'them', 'his', 'her', 'its',
        'scheme', 'eligible', 'eligibility', 'apply', 'applying', 'applied',
        'documents', 'benefits', 'criteria', 'check', 'status', 'more', 'more info'
    }
    query_words = set(query_english.lower().split())
    should_resolve = chat_history and len(chat_history) > 0 and (
        is_voice_mode or                            # always resolve in voice mode
        (query_words & ambiguous_terms) or          # ambiguous follow-up
        len(query_words) <= 10                      # short query likely needs context
    )
    if should_resolve:
        search_query = resolve_standalone_query(query_english, chat_history, prefer_fast=is_voice_mode)

    # State Auto-Detection from query
    indian_states = ["karnataka", "maharashtra", "tamil nadu", "kerala", "telangana", "andhra pradesh", "gujarat", "punjab", "haryana", "rajasthan", "uttar pradesh", "bihar", "west bengal", "madhya pradesh", "odisha", "delhi", "kashmir", "assam"]
    detected_state = ""
    for st in indian_states:
        if st in query_english.lower() or st in original_query.lower():
            detected_state = st.title()
            break

    effective_state = detected_state or selected_state
    if effective_state and effective_state != "All India / Central Govt" and effective_state.lower() not in search_query.lower():
        search_query = f"{search_query} in {effective_state}"
        print(f"[RAG Stream] State filter applied: '{effective_state}' -> Search query: '{search_query}'")

    is_direct_q = is_specific_question(query_english, chat_history) or is_voice_mode
    matched_scheme, score = retrieve_from_knowledge_base(search_query)

    if is_voice_mode:
        if matched_scheme and score >= 0.35:
            kb_context_str = "\n".join([f"Scheme: {s['title']} (State/Dept: {s.get('state', 'All India')})\nDescription: {s['description']}\nDetails: {s.get('details','')}" for s in matched_scheme[:2]])
            prompt = _build_voice_companion_prompt(query_english, kb_context_str, target_lang=target_lang, chat_history=chat_history)
        else:
            web_results = search_web(search_query)
            prompt = _build_voice_companion_prompt(query_english, context=web_results, target_lang=target_lang, chat_history=chat_history)
    elif matched_scheme:
        web_results = "" if score >= 0.60 else search_web(search_query)
        kb_context_str = "\n".join([f"{s['title']}: {s['description']}\n{s.get('details','')}" for s in matched_scheme])
        if is_direct_q:
            prompt = _build_direct_answer_prompt(query_english, kb_context_str, web_results=web_results, search_query=search_query)
        else:
            prompt = _build_kb_prompt(search_query, matched_scheme, web_results=web_results)
    else:
        web_results = search_web(search_query)
        if is_direct_q:
            prompt = _build_direct_answer_prompt(query_english, web_results or search_query, web_results=web_results, search_query=search_query)
        elif web_results:
            prompt = _build_web_prompt(search_query, web_results)
        else:
            prompt = _build_fallback_prompt(search_query)

    messages_payload = [{"role": "user", "content": prompt}]
    max_t = 280 if is_voice_mode else None

    for chunk in _call_groq_stream_with_fallback(messages_payload, max_tokens=max_t, prefer_fast=is_voice_mode):
        yield chunk
