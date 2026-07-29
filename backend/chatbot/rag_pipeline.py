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
    Build a Gemini prompt using web search results.

    Args:
        query:       The original query (English)
        web_results: Formatted string from web search

    Returns:
        A formatted prompt string for Gemini
    """
    return f"""You are an authoritative government scheme assistant for Indian citizens.
Answer the user's question about government schemes accurately, comprehensively, and clearly.

WEB SEARCH RESULTS:
{web_results}

USER QUESTION: {query}

IMPORTANT INSTRUCTIONS:
Please construct your answer using EXACTLY the following structure with Markdown headings.
Use the web search results as your reference. If any section (such as How to Apply or Documents Required) is missing or incomplete in the search results, use your extensive verified knowledge of Indian Government schemes to fill in all missing details. NEVER output "Information not available"; always provide clear, complete, and practical information for all four sections.

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
(List out all required documents in bullet points, such as Aadhaar Card, Passport Photo, Address Proof, Application Form, etc.)
"""


def _build_fallback_prompt(query: str) -> str:
    """Build a prompt allowing LLM to answer from its internal knowledge securely."""
    return f"""You are an authoritative government scheme assistant for Indian citizens.
The user asked: "{query}"

Please answer the user's question directly by tapping into your extensive internal training knowledge about Indian Central and State Government schemes. 
You must provide highly exhaustive and verified information about the scheme, digging deep into your memory for all precise eligibility constraints and every single required document.

IMPORTANT INSTRUCTIONS:
Please construct your answer using EXACTLY the following structure with Markdown headings.

CRITICAL FORMATTING RULE:
Start your response IMMEDIATELY with "**Scheme Details:**". Do NOT include any introductory greetings, meta-disclaimers, or notes about where the information came from.
Under "**How to Apply:**" or when referencing application steps, ALWAYS include the exact official .gov.in portal link in markdown format (e.g. [Apply on Official Portal](https://pmkisan.gov.in)).

**Scheme Details:**
(Provide a comprehensive overview, exact benefits, and the official state/central government department associated with it)

**Eligibility Criteria:**
(Provide deeply detailed eligibility conditions in bullet points)

**How to Apply:**
(Provide thorough step-by-step instructions or modes of application with official .gov.in portal links)

**Documents Required:**
(List out every formally required document in bullet points)
"""


def is_conversational_ack(query: str) -> bool:
    """
    Detects acknowledgments, greetings, audio checks ('can you hear me', 'hello'),
    or chit-chat to prevent unwanted RAG search or scheme template dumps.
    """
    import re
    q_clean = re.sub(r'[^\w\s]', '', query.lower()).strip()

    # Direct conversational / audio check / greeting phrases
    conversational_phrases = [
        r'can you hear me', r'are you listening', r'can you hear', r'am i audible',
        r'hello', r'hi\b', r'hey\b', r'who are you', r'what is your name', r'how are you',
        r'good morning', r'good afternoon', r'good evening',
        r'mic check', r'audio check', r'testing', r'is anyone there', r'are you there',
        r'thank you', r'thanks', r'ok\b', r'okay\b', r'got it', r'understood', r'goodbye', r'bye\b'
    ]

    for pattern in conversational_phrases:
        if re.search(pattern, q_clean):
            return True

    ack_words = {
        'ok', 'okay', 'k', 'kk', 'thanks', 'thank you', 'thx', 'thankyou', 
        'got it', 'understood', 'cool', 'great', 'fine', 'sure', 'right', 
        'yes', 'no', 'hello', 'hi', 'hey', 'bye', 'goodbye', 'nice', 'awesome', 'ok thanks', 'okay thanks'
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


def _build_voice_companion_prompt(query: str, context: str = "") -> str:
    """Build a prompt tailored specifically for live voice mode companion interaction."""
    ctx_str = f"SCHEME CONTEXT:\n{context}\n\n" if context else ""
    return f"""You are a helpful, thoughtful real-time companion guiding an Indian citizen in live voice mode.
{ctx_str}USER QUESTION: {query}

CRITICAL VOICE RULES:
1. Speak in plain, warm, natural spoken prose only — NO markdown, NO bullet points, NO section titles, NO asterisks, NO URLs.
2. Keep your answer concise, natural, and thoughtful (2 to 3 sentences max, under 50 words total).
3. Prioritize understanding their intent: answer their question clearly, and if brief or ambiguous, offer a quick, polite clarification.
4. Sound like a real-time conversation partner right next to them — warm, responsive, and friendly.
5. End with a subtle, helpful check-in (e.g. "Should I check if you qualify?" or "Want to know how to apply?").
"""


def _build_direct_answer_prompt(query: str, context: str, web_results: str = "", search_query: str = "") -> str:
    """
    Build a prompt that answers specific questions directly and concisely,
    calculating eligibility dynamically without repeating 4-section template headings.
    """
    extra_web = f"\nADDITIONAL WEB SEARCH CONTEXT:\n{web_results}\n" if web_results else ""
    target_topic = f"\nTARGET SCHEME / QUESTION TOPIC:\n{search_query}\n" if search_query else ""
    return f"""You are an authoritative government scheme assistant for Indian citizens.
Answer the user's question directly, calculate eligibility accurately based on their answers, and be concise.
{target_topic}
SCHEME CONTEXT:
{context}
{extra_web}
USER QUESTION / RESPONSE: {query}

CRITICAL RULES:
1. FOCUS STRICTLY ON THE TARGET SCHEME / TOPIC ASKED BY THE USER ({search_query or query}).
   - Calculate eligibility STRICTLY for the scheme being discussed in the conversation (e.g. Free Digital Education / Skill India / PMGDISHA).
   - DO NOT switch to or evaluate completely unrelated schemes (such as Gruha Lakshmi Scheme or Sukanya Samriddhi) unless the user explicitly requested them.
2. DO NOT OUTPUT FULL TEMPLATE HEADINGS (such as "## Scheme Details:", "## Eligibility Criteria:", "## How to Apply:", "## Documents Required:").
3. Give ONLY a direct, concise 2-4 sentence answer. Calculate their eligibility immediately based on their provided details (income, land, age, category).
4. If they are eligible, provide the 1-click official portal link (e.g. [Apply on Portal](https://...)). If they do not qualify, explain clearly in 1-2 sentences why.
5. Do NOT repeat questions that the user has already answered in the chat.
"""


def resolve_standalone_query(query_english: str, chat_history: list = None, prefer_fast: bool = False) -> str:
    """
    Converts ambiguous follow-up queries (e.g., 'is it not available for foreign citizens?')
    into a self-contained search query using recent conversation context.
    """
    if not chat_history or is_conversational_ack(query_english):
        return query_english

    try:
        history_lines = []
        for m in chat_history[-6:]:
            role_label = "User" if m.get("role") == "user" else "Assistant"
            history_lines.append(f"{role_label}: {m.get('content', '')}")

        history_str = "\n".join(history_lines)

        prompt = f"""Given the conversation history below and a follow-up question, rephrase the follow-up question into a standalone, self-contained query that includes the specific scheme or topic name being discussed.
Do NOT answer the question. ONLY return the single rephrased standalone query in English.

CONVERSATION HISTORY:
{history_str}

FOLLOW-UP QUESTION: {query_english}

STANDALONE QUERY:"""

        standalone = _call_groq_with_fallback(
            messages=[{"role": "user", "content": prompt}],
            max_tokens=45,
            prefer_fast=prefer_fast
        )
        safe_log = standalone.encode('ascii', 'ignore').decode('ascii')
        print(f"[RAG] Multi-Turn context resolved: '{query_english}' -> '{safe_log}'")
        return standalone if len(standalone) > 3 else query_english
    except Exception as e:
        print(f"[RAG] Standalone query resolution error: {e}")
        return query_english


def _save_web_knowledge_to_db(query: str, answer: str):
    """
    Auto-learning engine: Extracts structured scheme information from newly generated web search
    responses and persists it to the database & FAISS index for future knowledge base hits.
    """
    import re
    from .models import GovernmentScheme
    from .embeddings import seed_db

    try:
        # Extract title from answer
        title_match = re.search(r'\*\*(?:Scheme Details|Name):\*\*\s*\n?\s*\*?\*?([^\*\n]+)', answer, re.IGNORECASE)
        if not title_match:
            title_match = re.search(r'##\s*([^\n]+)', answer)
            
        clean_title = title_match.group(1).strip() if title_match else query.title()[:100]
        
        # Don't save duplicates
        if GovernmentScheme.objects.filter(title__iexact=clean_title).exists():
            return

        # Simple extraction of details
        desc = answer[:500]
        
        scheme = GovernmentScheme.objects.create(
            title=clean_title,
            description=desc,
            details=answer
        )
        print(f"[Auto-Learning] Successfully saved new scheme '{clean_title}' (ID: {scheme.id}) to DB.")
        
        # Trigger index rebuild in background or lazily next search
        seed_db()
    except Exception as err:
        print(f"[Auto-Learning] Failed to auto-save scheme: {err}")


# -------------------------------------------------------
# RAG Pipeline Core Function
# -------------------------------------------------------
def get_rag_response(query_english: str, original_query: str, chat_history: list = None, selected_state: str = "", is_voice_mode: bool = False) -> dict:
    """
    Execute the RAG Pipeline:
    1. Check for conversational acknowledgments
    2. Resolve multi-turn history context into a standalone query
    3. Search FAISS index
    4. Search web if score < SIMILARITY_THRESHOLD or not found
    5. Construct prompt & call Groq with model failover (optimized for Voice Mode latency & accuracy)

    Args:
        query_english:  The user's query translated into English
        original_query: The original query in user's language (for logging)
        chat_history:   Optional list of previous turns: [{"role": "user"|"assistant", "content": "..."}]
        selected_state: Optional state filter selected by user (e.g. "Karnataka", "Maharashtra")
        is_voice_mode:  If True, optimizes prompt and token length for sub-500ms voice generation

    Returns:
        dict: {
            "response": str,   # AI-generated answer in English
            "source":   str,   # "knowledge_base" or "web"
        }
    """
    # Step -1: Check for simple conversational acknowledgment / chit-chat / audio check / greetings
    if is_conversational_ack(query_english):
        print(f"[RAG] Conversational greeting / audio check detected: '{query_english}'")
        try:
            client = _get_groq_client()
            prompt = (
                f"The user said: '{query_english}' to JanSeva AI (an Indian government scheme voice assistant). "
                f"Give a punchy, warm, energetic, 1-sentence ChatGPT-style greeting! "
                f"Examples:\n"
                f"- If they asked 'can you hear me' or audio check: 'Loud and clear! I\\'m all ears — ask me about any government scheme!'\n"
                f"- If they said 'hi' or 'hello': 'Hey there! Ready when you are — what government scheme can I help you with today?'\n"
                f"- If they said 'who are you': 'I\\'m JanSeva AI, your personal guide for all Indian government schemes. What can I help you find?'\n"
                f"CRITICAL: Do NOT output any scheme details, fake scheme names, or markdown headings. Keep it strictly to 1 punchy sentence under 20 words."
            )
            res = client.chat.completions.create(
                messages=[{"role": "user", "content": prompt}],
                model="llama-3.1-8b-instant" if is_voice_mode else "llama-3.3-70b-versatile",
                max_tokens=40
            )
            return {
                "response": res.choices[0].message.content.strip(),
                "source": "conversational"
            }
        except Exception as e:
            return {
                "response": "Loud and clear! Ready when you are — ask me about any government scheme!",
                "source": "conversational"
            }
    # Step 0: Contextual query resolution for multi-turn conversations
    search_query = query_english
    if chat_history:
        search_query = resolve_standalone_query(query_english, chat_history, prefer_fast=is_voice_mode)

    # Append selected state to search query if a specific State/UT is selected
    if selected_state and selected_state != "All India / Central Govt" and selected_state.lower() not in search_query.lower():
        search_query = f"{search_query} in {selected_state}"
        print(f"[RAG] State filter applied: '{selected_state}' -> Search query: '{search_query}'")

    # Detect if user is asking a specific direct question vs a general scheme overview
    is_direct_q = is_specific_question(query_english, chat_history) or is_voice_mode

    # Step 1: Search the FAISS knowledge base using resolved standalone query
    matched_scheme, score = retrieve_from_knowledge_base(search_query)

    # Step 2: Build the appropriate prompt
    # VOICE MODE FAST PATH: Uses dedicated companion prompt and skips web search for sub-second latency
    if is_voice_mode:
        if matched_scheme:
            kb_context_str = "\n".join([f"{s['title']}: {s['description']}\n{s.get('details','')}" for s in matched_scheme])
            prompt = _build_voice_companion_prompt(query_english, kb_context_str)
            source = "knowledge_base"
            print(f"[RAG][VOICE] Instant KB voice companion prompt for '{query_english}'.")
        else:
            prompt = _build_voice_companion_prompt(query_english)
            source = "llm_fallback"
            print(f"[RAG][VOICE] Instant LLM voice companion prompt for '{query_english}'.")
    elif matched_scheme:
        if is_direct_q:
            web_results = search_web(search_query)
            kb_context_str = "\n".join([f"{s['title']}: {s['description']}\n{s.get('details','')}" for s in matched_scheme])
            prompt = _build_direct_answer_prompt(query_english, kb_context_str, web_results=web_results, search_query=search_query)
            print(f"[RAG] Direct question prompt generated for '{query_english}' using KB context.")
        else:
            web_results = search_web(search_query)
            prompt = _build_kb_prompt(search_query, matched_scheme, web_results=web_results)
            print(f"[RAG] Using knowledge base (score: {score:.4f}) with web enrichment.")
        source = "knowledge_base"
    else:
        web_results = search_web(search_query)
        if is_direct_q:
            prompt = _build_direct_answer_prompt(query_english, web_results or search_query, web_results=web_results, search_query=search_query)
            source = "web"
            print(f"[RAG] Direct question prompt generated for '{query_english}' using web search.")
        elif web_results:
            prompt = _build_web_prompt(search_query, web_results)
            source = "web"
            print(f"[RAG] Using web search fallback for: '{search_query}'")
        else:
            prompt = _build_fallback_prompt(search_query)
            source = "llm_fallback"
            print(f"[RAG] Using LLM general knowledge fallback for: '{search_query}'")

    # Step 3: Construct chat message payload for Groq LLM
    messages_payload = [{"role": "user", "content": prompt}]

    # Step 4: Generate response using Groq with model failover
    # Voice mode: prefer fast 8B model + tight token cap for instant sub-second response
    try:
        max_t = 85 if is_voice_mode else None
        answer = _call_groq_with_fallback(
            messages=messages_payload,
            max_tokens=max_t,
            prefer_fast=is_voice_mode   # Use instant 8B model for voice
        )

        # Post-processing: Strip out any introductory meta-commentary preamble if general scheme overview
        if not is_direct_q:
            import re
            match = re.search(r'(\*\*Scheme Details:\*\*|## Scheme Details:)', answer, re.IGNORECASE)
            if match:
                answer = answer[match.start():].strip()

        print(f"[RAG] Groq response generated ({len(answer)} chars)")

        # Step 5: Auto-learning! If general scheme overview wasn't in DB, save it so future queries hit KB
        if not matched_scheme and not is_direct_q and answer:
            _save_web_knowledge_to_db(search_query, answer)

    except Exception as e:
        print(f"[RAG] Groq API timeout or error (using mock fallback): {e}")
        if is_voice_mode:
            answer = "I ran into a temporary network delay trying to fetch that. Could you ask me again?"
        elif matched_scheme:
            scheme = matched_scheme[0]
            answer = (
                f"I am experiencing network connectivity issues and cannot generate a conversational response right now. "
                f"However, I found the exact scheme you are looking for in the local database:\n\n"
                f"**Scheme Details:**\n"
                f"**{scheme.get('title', 'Unknown Scheme')}**\n"
                f"{scheme.get('description', '')}\n\n"
                f"**Key Details & Eligibility:**\n"
                f"{scheme.get('details', 'No additional details provided.')}\n\n"
                f"**Target Demographic:**\n"
                f"Applicable for {scheme.get('target_demographic', 'eligible citizens')} in {scheme.get('state', 'all states')}.\n\n"
                f"**How to Apply:**\n"
                f"Please refer to the official government portal regarding this scheme.\n\n"
                f"**Documents Required:**\n"
                f"- Aadhaar Card\n"
                f"- Domicile/Resident Certificate\n"
                f"- Bank Passbook\n"
                f"- Passport-sized photograph"
            )
        else:
            answer = (
                "I'm operating in disconnected mode due to a system network error. "
                "Your query didn't perfectly match any locally cached schemes. "
                "Please check back when network connectivity is restored for a full web search."
            )
        source = "offline_mock"

    return {
        "response": answer,
        "source": source,
    }
