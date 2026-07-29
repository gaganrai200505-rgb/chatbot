"""
views.py — Chat API Endpoint
=============================

This module exposes endpoints for users to register,
chat with the RAG pipeline, and fetch their chat history.
"""

from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status, generics
from rest_framework.permissions import AllowAny, IsAuthenticated

from .models import ChatMessage
from .serializers import UserSerializer, ChatMessageSerializer
from .translation import detect_language, translate_to_english, translate_from_english
from .rag_pipeline import get_rag_response

class RegisterView(generics.CreateAPIView):
    """
    POST /api/register/
    Registers a new user.
    """
    queryset = UserSerializer.Meta.model.objects.all()
    permission_classes = (AllowAny,)
    authentication_classes = ()
    serializer_class = UserSerializer

class ChatHistoryView(generics.ListAPIView):
    """
    GET /api/history/
    Returns the chat history of the currently logged-in user.
    """
    permission_classes = (IsAuthenticated,)
    serializer_class = ChatMessageSerializer

    def get_queryset(self):
        return ChatMessage.objects.filter(user=self.request.user)

class ChatAPIView(APIView):
    """
    POST /api/chat/
    Requires JWT Authentication.
    """
    permission_classes = (IsAuthenticated,)

    def post(self, request, format=None):
        import uuid
        query = request.data.get("query", "").strip()
        requested_language = request.data.get("language", "")
        session_id = request.data.get("session_id", "").strip()

        if not session_id:
            session_id = f"session_{uuid.uuid4().hex[:12]}"

        if not query:
            return Response(
                {"error": "Query cannot be empty."},
                status=status.HTTP_400_BAD_REQUEST
            )

        state_filter = request.data.get("state", "").strip()
        is_voice = request.data.get("is_voice", False)

        print(f"\n[{'*'*40}]")
        print(f"[API] New Query: '{query}' | VoiceMode: {is_voice} | State Filter: '{state_filter}' | Session: '{session_id}' | User: {request.user}")

        try:
            if not requested_language or requested_language == "auto":
                detected_lang = detect_language(query)
            else:
                detected_lang = requested_language
            
            query_english = translate_to_english(query, detected_lang)

            # Retrieve recent conversation history for THIS specific session
            recent_msgs = ChatMessage.objects.filter(user=request.user, session_id=session_id).order_by('-timestamp')[:6]
            chat_history = []
            for m in reversed(recent_msgs):
                chat_history.append({"role": "user", "content": m.query})
                chat_history.append({"role": "assistant", "content": m.response})

            rag_result = get_rag_response(query_english, query, chat_history=chat_history, selected_state=state_filter, is_voice_mode=is_voice)
            english_response = rag_result["response"]
            source = rag_result["source"]
            final_response = translate_from_english(english_response, detected_lang)

            # SAVE TO DATABASE WITH SESSION ID
            saved_msg = ChatMessage.objects.create(
                user=request.user,
                session_id=session_id,
                query=query,
                response=final_response,
                language=detected_lang,
                source=source
            )

            print(f"[{'*'*40}]\n")
            return Response(
                {
                    "id": saved_msg.id,
                    "session_id": session_id,
                    "response": final_response,
                    "source": source,
                    "language": detected_lang,
                },
                status=status.HTTP_200_OK
            )

        except Exception as e:
            import traceback
            err_tb = traceback.format_exc()
            print(f"[API] Error processing request: {e}\n{err_tb}")
            return Response(
                {"error": "Internal server error while processing the chat request."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


class SessionDetailAPIView(APIView):
    permission_classes = (IsAuthenticated,)

    def delete(self, request, session_id, format=None):
        from django.db.models import Q
        query_filter = Q(user=request.user) & Q(session_id=session_id)
        if session_id.startswith("session_legacy_"):
            try:
                msg_id = int(session_id.replace("session_legacy_", ""))
                query_filter = Q(user=request.user) & (Q(session_id=session_id) | Q(id=msg_id))
            except ValueError:
                pass

        deleted_count, _ = ChatMessage.objects.filter(query_filter).delete()
        print(f"[API] Deleted {deleted_count} messages for session: '{session_id}'")
        return Response({"message": f"Session '{session_id}' deleted successfully.", "deleted": deleted_count}, status=status.HTTP_200_OK)

    def patch(self, request, session_id, format=None):
        from django.db.models import Q
        title = request.data.get("title")
        is_pinned = request.data.get("is_pinned")

        update_kwargs = {}
        if title is not None:
            update_kwargs["session_title"] = title
        if is_pinned is not None:
            update_kwargs["is_pinned"] = bool(is_pinned)

        if update_kwargs:
            query_filter = Q(user=request.user) & Q(session_id=session_id)
            if session_id.startswith("session_legacy_"):
                try:
                    msg_id = int(session_id.replace("session_legacy_", ""))
                    query_filter = Q(user=request.user) & (Q(session_id=session_id) | Q(id=msg_id))
                except ValueError:
                    pass

            ChatMessage.objects.filter(query_filter).update(**update_kwargs)
            print(f"[API] Updated session '{session_id}' with {update_kwargs}")

        return Response({"message": "Session updated successfully."}, status=status.HTTP_200_OK)


class CheckEligibilityAPIView(APIView):
    permission_classes = (IsAuthenticated,)

    def post(self, request, format=None):
        import json, re
        from .models import GovernmentScheme
        from .rag_pipeline import _get_groq_client

        age = request.data.get("age", "")
        income_lakhs = request.data.get("income_lakhs", "")
        state = request.data.get("state", "All India")
        category = request.data.get("category", "General")
        occupation = request.data.get("occupation", "General")
        is_taxpayer = request.data.get("is_taxpayer", False)

        schemes = list(GovernmentScheme.objects.all().values("title", "description", "details"))
        schemes_summary = "\n\n".join([f"Scheme: {s['title']}\nDesc: {s['description']}\nDetails: {s['details'][:300]}" for s in schemes])

        prompt = f"""You are an expert Indian Government Scheme eligibility evaluator.
Evaluate the following citizen profile against all registered government schemes below:

CITIZEN PROFILE:
- Age: {age} years
- Annual Family Income: Rs {income_lakhs} Lakh per year
- State/UT: {state}
- Social Category: {category}
- Occupation / Primary Status: {occupation}
- Income Taxpayer: {is_taxpayer}

REGISTERED SCHEMES:
{schemes_summary}

Task: Evaluate each scheme to determine if the citizen IS ELIGIBLE or NOT ELIGIBLE under current government rules.
Return ONLY a valid JSON array of objects. Do NOT include markdown codeblocks or preamble.
JSON Array schema per item:
{{
  "title": "Exact Scheme Title",
  "eligible": true or false,
  "reason": "1-2 concise sentences explaining why they qualify or do not qualify",
  "key_benefit": "Key benefit offered (e.g. Rs 5 Lakh health cover or Rs 6000/yr)",
  "portal_url": "Official portal URL or empty string"
}}
"""

        try:
            from .rag_pipeline import _call_groq_with_fallback
            raw_content = _call_groq_with_fallback(
                messages=[{"role": "user", "content": prompt}],
                temperature=0.1
            )

            cleaned_json = re.sub(r"^```(json)?", "", raw_content, flags=re.IGNORECASE)
            cleaned_json = re.sub(r"```$", "", cleaned_json, flags=re.IGNORECASE).strip()

            results = json.loads(cleaned_json)
            return Response({"results": results}, status=status.HTTP_200_OK)

        except Exception as err:
            print(f"[Eligibility API] Error: {err}")
            return Response({"error": "Failed to evaluate eligibility."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class TextToSpeechAPIView(APIView):
    """
    POST /api/tts/
    Synthesizes text into high-quality neural MP3 audio stream using edge-tts.
    """
    permission_classes = (AllowAny,)
    authentication_classes = ()

    def post(self, request, format=None):
        import asyncio
        import edge_tts
        from django.http import HttpResponse

        text = request.data.get("text", "").strip()
        language = request.data.get("language", "en").lower().strip()

        if not text:
            return Response({"error": "Text is required."}, status=status.HTTP_400_BAD_REQUEST)

        # Sanitize text for TTS
        import re
        clean_text = re.sub(r'https?://\S+', '', text)
        clean_text = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', clean_text)
        clean_text = re.sub(r'[*_~`#|]', '', clean_text).strip()

        # Map language code to Microsoft Neural Male Voices (ChatGPT Onyx/Cove style)
        VOICE_MAP = {
            "en": "en-US-ChristopherNeural",   # Warm, smooth ChatGPT-like male voice (Onyx style)
            "en-in": "en-IN-PrabhatNeural",    # Indian English neural male voice
            "hi": "hi-IN-MadhurNeural",        # High quality Hindi neural male voice
            "kn": "kn-IN-GaganNeural",         # High quality Kannada neural male voice
            "auto": "en-US-ChristopherNeural",
        }
        chosen_voice = VOICE_MAP.get(language, "en-US-ChristopherNeural")

        async def generate_mp3_bytes():
            communicate = edge_tts.Communicate(clean_text, chosen_voice, rate="+8%", pitch="+0Hz")
            mp3_data = bytearray()
            async for chunk in communicate.stream():
                if chunk["type"] == "audio":
                    mp3_data.extend(chunk["data"])
            return bytes(mp3_data)

        try:
            audio_bytes = asyncio.run(generate_mp3_bytes())
            response = HttpResponse(audio_bytes, content_type="audio/mpeg")
            response["Content-Disposition"] = 'inline; filename="speech.mp3"'
            return response
        except Exception as e:
            print(f"[TTS API] Synthesis Error: {e}")
            return Response({"error": f"Speech synthesis failed: {str(e)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class PingView(APIView):
    """
    GET /api/ping/
    Lightweight no-auth health check endpoint.
    Pinged every 10 minutes by the frontend to prevent Render free-tier sleep.
    Returns a minimal JSON response to minimize server load.
    """
    permission_classes = (AllowAny,)
    authentication_classes = ()

    def get(self, request):
        return Response({"ok": True, "status": "alive"}, status=status.HTTP_200_OK)
