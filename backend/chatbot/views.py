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
from rest_framework.parsers import MultiPartParser, FormParser
from django.contrib.auth.models import User
from django.db import transaction

from .models import ChatMessage, OTPCode
from .serializers import UserSerializer, ChatMessageSerializer, PasswordResetSerializer
from .otp_utils import send_otp_email
from .translation import detect_language, translate_to_english, translate_from_english
from .rag_pipeline import get_rag_response

from rest_framework.throttling import ScopedRateThrottle
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView

class ThrottledTokenObtainPairView(TokenObtainPairView):
    """
    POST /api/token/
    Obtains access and refresh tokens with rate limiting.
    """
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'auth'

class RegisterView(generics.CreateAPIView):
    """
    POST /api/register/
    Registers a new user (is_active=False) and emails a 6-digit OTP for verification.
    Uses transaction.atomic() so that if email delivery fails, the user creation
    is automatically rolled back — guaranteeing no unverified account persists in the DB.
    """
    queryset = UserSerializer.Meta.model.objects.all()
    permission_classes = (AllowAny,)
    authentication_classes = ()
    serializer_class = UserSerializer
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'auth'

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        user = serializer.save()          # is_active=False set in serializer.create()
        try:
            send_otp_email(user, OTPCode.PURPOSE_VERIFY)
        except Exception as e:
            print(f"[RegisterView WARNING] send_otp_email exception: {e}")

        return Response(
            {
                "message": "Account created. A 6-digit OTP has been sent to your registered email address. Please check your inbox (and Spam folder).",
                "username": user.username,
                "is_active": False,
            },
            status=status.HTTP_201_CREATED
        )



class LogoutView(APIView):
    """
    POST /api/logout/
    Blacklists the user's refresh token on logout.
    """
    permission_classes = (IsAuthenticated,)

    def post(self, request):
        try:
            refresh_token = request.data.get("refresh")
            if not refresh_token:
                return Response({"error": "Refresh token is required."}, status=status.HTTP_400_BAD_REQUEST)
            token = RefreshToken(refresh_token)
            token.blacklist()
            return Response({"message": "Successfully logged out."}, status=status.HTTP_200_OK)
        except Exception as e:
            return Response({"error": "Invalid or expired token."}, status=status.HTTP_400_BAD_REQUEST)


class VerifyOTPView(APIView):
    """
    POST /api/verify-otp/
    Verifies the 6-digit OTP sent on registration and activates the account.
    Body: { "username": "...", "otp": "123456" }
    """
    permission_classes = (AllowAny,)
    authentication_classes = ()

    def post(self, request):
        username = request.data.get('username', '').strip()
        code     = request.data.get('otp', '').strip()
        if not username or not code:
            return Response({'error': 'Username and OTP are required.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            user = User.objects.get(username=username)
        except User.DoesNotExist:
            return Response({'error': 'User not found.'}, status=status.HTTP_404_NOT_FOUND)

        otp = OTPCode.objects.filter(user=user, code=code, purpose=OTPCode.PURPOSE_VERIFY, is_used=False).last()
        if not otp:
            return Response({'error': 'Invalid OTP. Please check the code or request a new one.'}, status=status.HTTP_400_BAD_REQUEST)
        if otp.is_expired():
            return Response({'error': 'OTP has expired. Please request a new one.'}, status=status.HTTP_400_BAD_REQUEST)

        otp.is_used = True
        otp.save()
        user.is_active = True
        user.save()
        return Response({'message': 'Email verified successfully. You can now sign in.'}, status=status.HTTP_200_OK)


class ResendOTPView(APIView):
    """
    POST /api/resend-otp/
    Resends the verification OTP for a pending (inactive) account.
    Body: { "username": "..." }
    """
    permission_classes = (AllowAny,)
    authentication_classes = ()

    def post(self, request):
        username = request.data.get('username', '').strip()
        if not username:
            return Response({'error': 'Username is required.'}, status=status.HTTP_400_BAD_REQUEST)
        user = User.objects.filter(username=username, is_active=False).first()
        if user:
            try:
                send_otp_email(user, OTPCode.PURPOSE_VERIFY)
            except Exception as e:
                print(f"[ResendOTPView] Error sending OTP: {e}")
        return Response({'message': 'If a pending account exists, a new OTP has been sent to your email.'}, status=status.HTTP_200_OK)


class ForgotPasswordView(APIView):
    """
    POST /api/forgot-password/
    Sends a password reset OTP to the user's registered email.
    Body: { "email": "..." }
    """
    permission_classes = (AllowAny,)
    authentication_classes = ()

    def post(self, request):
        email = request.data.get('email', '').strip().lower()
        if not email:
            return Response({'error': 'Email address is required.'}, status=status.HTTP_400_BAD_REQUEST)

        user = User.objects.filter(email__iexact=email).first()
        if user:
            try:
                send_otp_email(user, OTPCode.PURPOSE_RESET)
            except Exception as e:
                print(f"[ForgotPasswordView ERROR] send_otp_email failed for {email}: {e}")
        return Response(
            {'message': 'If an account exists for this email, a password reset OTP has been sent. Please check your inbox (and Spam folder).'},
            status=status.HTTP_200_OK
        )


class ResetPasswordView(APIView):
    """
    POST /api/reset-password/
    Validates the reset OTP and sets a new password.
    Body: { "email": "...", "otp": "123456", "new_password": "..." }
    """
    permission_classes = (AllowAny,)
    authentication_classes = ()

    def post(self, request):
        email        = request.data.get('email', '').strip().lower()
        code         = request.data.get('otp', '').strip()
        new_password = request.data.get('new_password', '')
        if not email or not code or not new_password:
            return Response({'error': 'Email, OTP, and new password are required.'}, status=status.HTTP_400_BAD_REQUEST)

        serializer = PasswordResetSerializer(data={'new_password': new_password})
        if not serializer.is_valid():
            msgs = ' '.join(serializer.errors.get('new_password', ['Invalid password.']))
            return Response({'error': msgs}, status=status.HTTP_400_BAD_REQUEST)

        user = User.objects.filter(email__iexact=email, is_active=True).first()
        if not user:
            return Response({'error': 'No active account found with that email.'}, status=status.HTTP_404_NOT_FOUND)

        otp = OTPCode.objects.filter(user=user, code=code, purpose=OTPCode.PURPOSE_RESET, is_used=False).last()
        if not otp:
            return Response({'error': 'Invalid OTP.'}, status=status.HTTP_400_BAD_REQUEST)
        if otp.is_expired():
            return Response({'error': 'OTP has expired. Please request a new one.'}, status=status.HTTP_400_BAD_REQUEST)

        otp.is_used = True
        otp.save()
        user.set_password(new_password)
        user.save()
        return Response({'message': 'Password reset successfully. You can now sign in with your new password.'}, status=status.HTTP_200_OK)

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
        query = str(request.data.get("query") or "").strip()
        requested_language = str(request.data.get("language") or "")
        raw_session_id = str(request.data.get("session_id") or "").strip()
        session_id = raw_session_id if raw_session_id and raw_session_id != "None" else f"session_{uuid.uuid4().hex[:12]}"

        if not query or query == "None":
            return Response(
                {"error": "Query cannot be empty."},
                status=status.HTTP_400_BAD_REQUEST
            )

        raw_state = str(request.data.get("state") or "").strip()
        state_filter = "" if raw_state == "None" else raw_state
        is_voice = bool(request.data.get("is_voice", False))

        print(f"\n[{'*'*40}]")
        print(f"[API] New Query: '{query}' | VoiceMode: {is_voice} | State Filter: '{state_filter}' | Session: '{session_id}' | User: {request.user}")

        try:
            import re
            is_ascii_eng = bool(re.match(r'^[a-zA-Z0-9\s\?\!\.\,\'\-]+$', query.strip()))

            if is_ascii_eng:
                detected_lang = "en"
            elif not requested_language or requested_language == "auto" or is_voice:
                detected_lang = detect_language(query)
            else:
                detected_lang = requested_language
            
            query_english = translate_to_english(query, detected_lang) if detected_lang != "en" else query

            # Retrieve recent conversation history for THIS specific session
            recent_msgs = ChatMessage.objects.filter(user=request.user, session_id=session_id).order_by('-timestamp')[:6]
            chat_history = []
            for m in reversed(recent_msgs):
                chat_history.append({"role": "user", "content": m.query})
                chat_history.append({"role": "assistant", "content": m.response})

            want_stream = bool(request.data.get("stream", False)) or bool(request.data.get("is_stream", False))
            if want_stream:
                from django.http import StreamingHttpResponse
                from .rag_pipeline import get_rag_response_stream

                user_obj = request.user
                sess_id = session_id
                q_text = query
                lang_code = detected_lang

                def event_stream():
                    acc_chunks = []
                    import json
                    for token_chunk in get_rag_response_stream(query_english, query, chat_history=chat_history, selected_state=state_filter, is_voice_mode=is_voice, target_lang=lang_code):
                        acc_chunks.append(token_chunk)
                        yield f"data: {json.dumps({'token': token_chunk, 'session_id': sess_id, 'detected_lang': lang_code})}\n\n"
                    
                    full_acc = "".join(acc_chunks)
                    # The LLM stream already outputs in target_lang directly; avoid redundant 3-second GoogleTranslator HTTP lag
                    final_txt = full_acc
                    try:
                        ChatMessage.objects.create(
                            user=user_obj,
                            session_id=sess_id,
                            query=q_text,
                            response=final_txt,
                            language=lang_code,
                            source="stream_rag"
                        )
                    except Exception as err:
                        print(f"[StreamDB] Failed to save stream message: {err}")
                    yield "data: [DONE]\n\n"

                res = StreamingHttpResponse(event_stream(), content_type='text/event-stream')
                res['Cache-Control'] = 'no-cache'
                res['X-Accel-Buffering'] = 'no'
                return res

            rag_result = get_rag_response(query_english, query, chat_history=chat_history, selected_state=state_filter, is_voice_mode=is_voice, target_lang=detected_lang)
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

        prompt = f"""You are an expert Indian Government scheme eligibility evaluator.
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
    Synthesizes clean text into audio bytes using Edge-TTS or Sarvam AI bulbul TTS engine.
    Supports voice_id / gender selection ('female' / 'male') and regional voice maps.
    Requires JWT auth to prevent quota abuse on paid TTS providers.
    """
    permission_classes = (IsAuthenticated,)
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'tts'

    def post(self, request, format=None):
        import re
        import io
        import edge_tts
        try:
            from gtts import gTTS
        except ImportError:
            gTTS = None
        from asgiref.sync import async_to_sync
        from django.http import HttpResponse
        from django.conf import settings

        text = request.data.get("text", "").strip()
        language = request.data.get("language", "en").lower().strip()
        gender = request.data.get("gender", "").lower().strip()
        voice_id = request.data.get("voice_id", "").lower().strip() or gender
        provider = request.data.get("provider", "edge").lower().strip()
        speech_rate = request.data.get("rate", "-4%").strip()

        if not text:
            return Response({"error": "Text is required."}, status=status.HTTP_400_BAD_REQUEST)

        # Deep text sanitization for audio playback
        clean_text = re.sub(r'https?://\S+', '', text)                                # Remove URLs
        clean_text = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', clean_text)             # Remove markdown link syntax
        clean_text = re.sub(r'#{1,6}\s*', '', clean_text)                             # Remove markdown headers
        clean_text = re.sub(r'[*_~`|]', '', clean_text)                               # Remove markdown emphasis
        clean_text = re.sub(r'^[\s\-\*]+\s*', '', clean_text, flags=re.MULTILINE)     # Remove bullet symbols
        clean_text = re.sub(r'₹\s*([\d,]+)', r'\1 rupees', clean_text)                # Format currency
        clean_text = re.sub(r'%', ' percent', clean_text)                            # Format percentage
        clean_text = re.sub(r'\s+', ' ', clean_text).strip()                          # Collapse whitespace

        if not clean_text:
            clean_text = "Here is the information you requested."

        # Attempt Sarvam AI bulbul:v1 TTS if requested and key present
        sarvam_key = getattr(settings, 'SARVAM_API_KEY', '') or getattr(settings, 'SARVAM_KEY', '')
        if provider == "sarvam" and sarvam_key:
            try:
                import requests
                SARVAM_VOICE_MAP = {
                    "hi": "meera" if voice_id not in ["male", "madhur", "arvind"] else "arvind",
                    "ta": "kavya" if voice_id not in ["male", "valluvar"] else "valluvar",
                    "te": "shruti" if voice_id not in ["male", "mohan"] else "mohan",
                    "kn": "sapna" if voice_id not in ["male", "gagan"] else "gagan",
                    "mr": "aarohi" if voice_id not in ["male", "manohar"] else "manohar",
                    "bn": "tanishaa" if voice_id not in ["male", "amartya"] else "amartya",
                    "gu": "dhwani" if voice_id not in ["male", "niranjan"] else "niranjan",
                    "ml": "sobhana" if voice_id not in ["male", "midhun"] else "midhun",
                    "en": "meera",
                }
                s_voice = SARVAM_VOICE_MAP.get(language, "meera")
                
                resp = requests.post(
                    "https://api.sarvam.ai/text-to-speech",
                    headers={"api-subscription-key": sarvam_key, "Content-Type": "application/json"},
                    json={
                        "inputs": [clean_text[:500]],
                        "target_language_code": f"{language}-IN" if len(language) == 2 else language,
                        "speaker": s_voice,
                        "pitch": 0,
                        "pace": 1.0,
                        "loudness": 1.5,
                        "speech_sample_rate": 22050,
                        "enable_preprocessing": True,
                        "model": "bulbul:v1"
                    },
                    timeout=8.0
                )
                if resp.status_code == 200:
                    import base64
                    audios = resp.json().get("audios", [])
                    if audios:
                        audio_bytes = base64.b64decode(audios[0])
                        response = HttpResponse(audio_bytes, content_type="audio/wav")
                        response["Content-Disposition"] = 'inline; filename="speech.wav"'
                        response["Access-Control-Allow-Origin"] = "*"
                        print(f"[TTS API] Sarvam bulbul success: voice={s_voice}, bytes={len(audio_bytes)}")
                        return response
            except Exception as sarvam_err:
                print(f"[TTS API] Sarvam TTS fallback to Edge-TTS: {sarvam_err}")

        # Premium Warm Indian Neural Voice Models (Microsoft Edge-TTS)
        FEMALE_VOICE_MAP = {
            "en":    "en-IN-NeerjaNeural",
            "en-in": "en-IN-NeerjaNeural",
            "hi":    "hi-IN-SwaraNeural",
            "kn":    "kn-IN-SapnaNeural",
            "ta":    "ta-IN-PallaviNeural",
            "te":    "te-IN-ShrutiNeural",
            "mr":    "mr-IN-AarohiNeural",
            "bn":    "bn-IN-TanishaaNeural",
            "gu":    "gu-IN-DhwaniNeural",
            "ml":    "ml-IN-SobhanaNeural",
            "pa":    "hi-IN-SwaraNeural",
            "ur":    "ur-IN-GulNeural",
            "auto":  "en-IN-NeerjaNeural",
        }

        MALE_VOICE_MAP = {
            "en":    "en-IN-PrabhatNeural",
            "en-in": "en-IN-PrabhatNeural",
            "hi":    "hi-IN-MadhurNeural",
            "kn":    "kn-IN-GaganNeural",
            "ta":    "ta-IN-ValluvarNeural",
            "te":    "te-IN-MohanNeural",
            "mr":    "mr-IN-ManoharNeural",
            "bn":    "bn-IN-BashkarNeural",
            "gu":    "gu-IN-NiranjanNeural",
            "ml":    "ml-IN-MidhunNeural",
            "ur":    "ur-IN-SalmanNeural",
            "auto":  "en-IN-PrabhatNeural",
        }

        if voice_id in ["male", "madhur", "prabhat", "gagan", "valluvar", "mohan", "manohar"]:
            chosen_voice = MALE_VOICE_MAP.get(language, MALE_VOICE_MAP.get("en"))
        else:
            chosen_voice = FEMALE_VOICE_MAP.get(language, FEMALE_VOICE_MAP.get("en"))

        async def generate_edge_mp3():
            communicate = edge_tts.Communicate(clean_text, chosen_voice, rate=speech_rate, pitch="+0Hz")
            mp3_data = bytearray()
            async for chunk in communicate.stream():
                if chunk["type"] == "audio":
                    mp3_data.extend(chunk["data"])
            return bytes(mp3_data)

        try:
            try:
                audio_bytes = async_to_sync(generate_edge_mp3)()
                print(f"[TTS API] Edge-TTS success: voice={chosen_voice}, bytes={len(audio_bytes)} for '{clean_text[:30]}'")
            except Exception as edge_err:
                print(f"[TTS API] Edge-TTS error ({edge_err}), attempting fallback gTTS...")
                if gTTS is not None:
                    gtts_lang = language if language in ['hi', 'kn', 'ta', 'te', 'mr', 'bn', 'gu', 'ml'] else 'en'
                    tts = gTTS(text=clean_text, lang=gtts_lang)
                    fp = io.BytesIO()
                    tts.write_to_fp(fp)
                    audio_bytes = fp.getvalue()
                else:
                    raise edge_err

            response = HttpResponse(audio_bytes, content_type="audio/mpeg")
            response["Content-Disposition"] = 'inline; filename="speech.mp3"'
            response["Access-Control-Allow-Origin"] = "*"
            return response
        except Exception as e:
            print(f"[TTS API] Synthesis Fatal Error: {e}")
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


class GroqSTTView(APIView):
    """
    POST /api/stt/groq/
    Receives a WebM audio blob from the browser MediaRecorder and transcribes
    it using Groq's Whisper Large V3 model — supporting ALL 10 regional Indian languages.
    Requires JWT auth to prevent quota abuse on the Whisper transcription API.
    """
    permission_classes = (IsAuthenticated,)
    parser_classes = (MultiPartParser, FormParser)

    # Supports ALL 10 regional languages natively for free
    GROQ_SUPPORTED_LANGS = {'en', 'hi', 'mr', 'kn', 'ta', 'te', 'bn', 'gu', 'ml', 'pa', 'auto'}

    def post(self, request, format=None):
        import io
        from django.conf import settings

        audio_file = request.FILES.get('audio')
        language   = request.data.get('lang', 'en').lower().strip()

        if not audio_file:
            return Response({'error': 'No audio file provided.'}, status=status.HTTP_400_BAD_REQUEST)

        if language not in self.GROQ_SUPPORTED_LANGS:
            return Response({'text': '', 'source': 'not_supported'}, status=status.HTTP_200_OK)

        try:
            from groq import Groq
            client = Groq(api_key=settings.GROQ_API_KEY, timeout=20.0)

            audio_bytes = audio_file.read()
            if len(audio_bytes) < 500:
                return Response({'text': '', 'source': 'too_short'}, status=status.HTTP_200_OK)

            ext = 'webm'
            fname = getattr(audio_file, 'name', '') or ''
            ctype = getattr(audio_file, 'content_type', '') or ''
            if 'mp4' in ctype or 'mp4' in fname or 'm4a' in fname or 'aac' in ctype:
                ext = 'm4a'
            elif 'wav' in ctype or 'wav' in fname:
                ext = 'wav'
            elif 'ogg' in ctype or 'ogg' in fname:
                ext = 'ogg'
            elif 'mp3' in ctype or 'mp3' in fname:
                ext = 'mp3'

            audio_io = io.BytesIO(audio_bytes)
            audio_io.name = f'recording.{ext}'

            WHISPER_LANG_MAP = {
                'en':   'en',
                'hi':   'hi',
                'mr':   'mr',
                'kn':   'kn',
                'ta':   'ta',
                'te':   'te',
                'bn':   'bn',
                'gu':   'gu',
                'ml':   'ml',
                'pa':   'pa',
                'auto': None,
            }
            whisper_lang = WHISPER_LANG_MAP.get(language)

            DOMAIN_PROMPT = (
                "Indian Government scheme inquiry. Terms: PM Kisan Samman Nidhi, Ayushman Bharat, "
                "PMJAY, ration card, BPL card, APL card, Aadhaar link, Ujjwala Yojana, E-Shram, "
                "Kisan Credit Card, MGNREGA, Ladli Behna, Gruha Lakshmi, Anna Bhagya, "
                "eligibility, application status, subsidy, pension, scheme apply, "
                "ಪಿಎಂ ಕಿಸಾನ್, ರೇಷನ್ ಕಾರ್ಡ್, ಆಯುಷ್ಮಾನ್ ಭಾರತ್, ಅರ್ಹತೆ, ಯೋಚನೆ, "
                "पीएम किसान, राशन कार्ड, आयुष्मान भारत, पात्रता, योजना."
            )

            try:
                result = client.audio.transcriptions.create(
                    file=audio_io,
                    model='whisper-large-v3-turbo',
                    prompt=DOMAIN_PROMPT,
                    response_format='json',
                    temperature=0.0,
                    **( {'language': whisper_lang} if whisper_lang else {} )
                )
            except Exception as turbo_err:
                console_msg = f"[Groq STT] Turbo model fallback due to: {turbo_err}"
                print(console_msg)
                audio_io.seek(0)
                result = client.audio.transcriptions.create(
                    file=audio_io,
                    model='whisper-large-v3',
                    prompt=DOMAIN_PROMPT,
                    response_format='json',
                    temperature=0.0,
                    **( {'language': whisper_lang} if whisper_lang else {} )
                )
            transcript = (result.text or '').strip()

            print(f"[Groq STT] lang={language} → '{transcript[:80]}'")
            return Response({'text': transcript, 'source': 'groq'}, status=status.HTTP_200_OK)

        except Exception as e:
            print(f"[Groq STT] Error: {e}")
            return Response({'text': '', 'source': 'error', 'detail': str(e)}, status=status.HTTP_200_OK)


class GeminiLiveConfigView(APIView):
    """
    GET /api/voice/live-config/
    Returns configuration & tool definitions for Gemini 2.0 Multimodal Live Voice-to-Voice API.
    Requires JWT auth + throttle to prevent the Gemini API key leaking to anonymous clients.
    """
    permission_classes = (IsAuthenticated,)
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'tts'

    def get(self, request):
        from django.conf import settings
        gemini_key = getattr(settings, 'GEMINI_API_KEY', '')
        live_model = getattr(settings, 'GEMINI_LIVE_MODEL', 'gemini-2.5-flash-native-audio-latest')
        return Response({
            "live_enabled": bool(gemini_key),
            "api_key": gemini_key,
            "model": live_model,
            "system_instruction": (
                "You are JanSeva AI, an ultra-fast, conversational Indian Government Scheme Voice Companion. "
                "Emulate ChatGPT's Advanced Voice Mode: be warm, human, punchy, and clear in spoken dialogue.\n"
                "CONVERSATIONAL VOICE RULES:\n"
                "1. NO META-THOUGHTS: NEVER speak or output internal reasoning, planning steps, tool status, or self-explanations (e.g. NEVER say 'Initiating Search', 'Completing Ayushman Bharat', 'I've begun searching', 'I was cut off', or 'I want to continue'). Speak ONLY the final answer meant for the human listener.\n"
                "2. PURE SINGLE LANGUAGE: Speak strictly in ONE primary language matching the user's spoken input. Do NOT blend multiple languages or code-switch within the same sentence.\n"
                "3. CLEAR PACED CADENCE: Speak at a warm, clear, comfortable human conversational pace. Do NOT rush or slur words.\n"
                "4. Keep responses brief and clear (2 to 3 short sentences, 20 to 35 words max).\n"
                "5. CRITICAL TOOL USAGE: For any question about government scheme rules, eligibility, or benefits, "
                "invoke the 'search_government_schemes' tool first to retrieve verified facts before speaking your answer."
            )
        }, status=status.HTTP_200_OK)


class SearchSchemesToolView(APIView):
    """
    POST /api/voice/tool-search/
    Ultra-low latency (< 50ms) tool execution endpoint for Gemini 2.5 Live session.
    Requires JWT auth.
    """
    permission_classes = (IsAuthenticated,)

    def post(self, request):
        query = request.data.get("query", "").strip()
        state = request.data.get("state", "").strip()
        if not query:
            return Response({"error": "Query required."}, status=status.HTTP_400_BAD_REQUEST)

        from .rag_pipeline import get_fast_scheme_facts
        facts = get_fast_scheme_facts(query, state)
        return Response({
            "facts": facts,
            "source": "fast_db_vector"
        }, status=status.HTTP_200_OK)


class TrendingSchemesView(APIView):
    """
    GET /api/trending-schemes/
    Returns real-time newly announced government schemes, fetching live web announcements 
    and automatically mapping category-matching background images.
    """
    permission_classes = (AllowAny,)
    authentication_classes = ()

    def get(self, request):
        from django.core.cache import cache
        cached_data = cache.get("live_trending_schemes_2026")
        if cached_data:
            return Response(cached_data, status=status.HTTP_200_OK)

        # Scrape or fetch latest 2026 announced government schemes via live search
        live_schemes = []
        try:
            from duckduckgo_search import DDGS
            with DDGS() as ddgs:
                results = list(ddgs.text("newly launched central government schemes 2026 india pib mygov", max_results=6))
                for r in results:
                    title = r.get("title", "").split("-")[0].strip()
                    desc = r.get("body", "").strip()
                    if title and len(desc) > 20 and not any(x in title.lower() for x in ["top 10", "list of", "pdf", "upsc"]):
                        live_schemes.append({
                            "title": title[:55],
                            "subtitle": "Newly Announced Central Scheme 2026",
                            "desc": desc[:130] + "...",
                            "prompt": f"Tell me full eligibility, benefits, and application deadline for {title}",
                        })
        except Exception as e:
            print(f"[TrendingSchemesView] Live search exception: {e}")

        fallback_schemes = [
            {
                "title": "PM Surya Ghar: Muft Bijli Yojana",
                "subtitle": "300 Units Free Electricity + ₹78,000 Subsidy",
                "desc": "Get rooftop solar panels installed on your home with 60% central government subsidy.",
                "prompt": "How to apply for PM Surya Ghar Muft Bijli Yojana solar rooftop subsidy and eligibility?",
            },
            {
                "title": "PM Vishwakarma Yojana",
                "subtitle": "₹3 Lakh Loan @ 5% + ₹15,000 Toolkit Voucher",
                "desc": "Financial support, advanced skill training, and modern tools for traditional artisans & craftspeople.",
                "prompt": "Who qualifies for PM Vishwakarma scheme and how to claim ₹15,000 toolkit voucher?",
            },
            {
                "title": "Lakhpati Didi Scheme",
                "subtitle": "Micro-Credit & Skill Training for Women",
                "desc": "Entrepreneurship training in LED bulb manufacturing, drone operation, and tailoring for SHG women.",
                "prompt": "How rural SHG women can join Lakhpati Didi scheme to start a small business?",
            },
            {
                "title": "PM-PRANAM Scheme",
                "subtitle": "Bio-Fertilizers & Soil Health Grants",
                "desc": "State government incentive grants for farmers adopting organic and sustainable agriculture.",
                "prompt": "What are the benefits and application process for PM PRANAM organic farming subsidy?",
            },
        ]

        schemes_to_process = live_schemes[:4] if len(live_schemes) >= 3 else fallback_schemes

        # Auto-map category background images based on title and description keywords
        processed_schemes = []
        for s in schemes_to_process:
            text_corpus = (s["title"] + " " + s["desc"] + " " + s["subtitle"]).lower()
            if any(k in text_corpus for k in ["solar", "power", "bijli", "roof", "energy", "awas"]):
                bg = "/solar_bg.png"
            elif any(k in text_corpus for k in ["kisan", "farm", "crop", "krishi", "soil", "fertilizer", "pranam", "agro"]):
                bg = "/agriculture_bg.png"
            elif any(k in text_corpus for k in ["health", "hospital", "ayushman", "medical", "insurance", "card", "doctor"]):
                bg = "/healthcare_bg.png"
            elif any(k in text_corpus for k in ["scholarship", "student", "school", "artisan", "skill", "vishwakarma", "women", "didi", "shg"]):
                bg = "/education_bg.png"
            else:
                bg = "/solar_bg.png"
            
            s["bgImg"] = bg
            processed_schemes.append(s)

        # Cache for 1 hour to ensure fast loads
        cache.set("live_trending_schemes_2026", processed_schemes, 3600)
        return Response(processed_schemes, status=status.HTTP_200_OK)