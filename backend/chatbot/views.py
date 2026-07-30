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
        try:
            user = User.objects.get(username=username, is_active=False)
        except User.DoesNotExist:
            return Response({'error': 'No pending account found for this username.'}, status=status.HTTP_404_NOT_FOUND)
        try:
            send_otp_email(user, OTPCode.PURPOSE_VERIFY)
        except Exception as e:
            return Response({'error': f'Failed to send email: {str(e)}'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        return Response({'message': 'A new OTP has been sent to your email.'}, status=status.HTTP_200_OK)


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
        if not user:
            # Don't reveal whether email exists
            return Response(
                {'message': 'If an account with that email exists, a reset OTP has been sent.'},
                status=status.HTTP_200_OK
            )

        try:
            send_otp_email(user, OTPCode.PURPOSE_RESET)
        except Exception as e:
            print(f"[ForgotPasswordView ERROR] send_otp_email failed for {email}: {e}")
            return Response(
                {'error': 'Could not send password reset email. Please try again in a moment.'},
                status=status.HTTP_503_SERVICE_UNAVAILABLE
            )
        return Response(
            {'message': 'A password reset OTP has been sent to your email. Please check your inbox (and Spam folder).'},
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
    Synthesizes text into high-quality neural MP3 audio stream using edge-tts with gTTS fallback.
    """
    permission_classes = (AllowAny,)
    authentication_classes = ()

    def post(self, request, format=None):
        import edge_tts
        import io
        from gtts import gTTS
        from asgiref.sync import async_to_sync
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
        if not clean_text:
            clean_text = "Here is the information you requested."

        voice_id = request.data.get("voice_id", "").lower().strip()

        # Map language code & voice_id to ChatGPT & Regional Indian Neural Voices
        VOICE_MAP = {
            "en": "en-US-ChristopherNeural",            # Onyx smooth voice
            "en-in": "en-IN-PrabhatNeural",             # Warm Indian male neural voice
            "hi": "hi-IN-MadhurNeural",                 # Hindi male neural voice
            "kn": "kn-IN-GaganNeural",                  # Kannada male neural voice
            "ta": "ta-IN-ValluvarNeural",               # Tamil male neural voice
            "te": "te-IN-MohanNeural",                  # Telugu male neural voice
            "mr": "mr-IN-ManoharNeural",                # Marathi male neural voice
            "bn": "bn-IN-BashkarNeural",                # Bengali male neural voice
            "gu": "gu-IN-NiranjanNeural",               # Gujarati male neural voice
            "ml": "ml-IN-MidhunNeural",                 # Malayalam male neural voice
            "pa": "hi-IN-MadhurNeural",                 # Punjabi neural voice
            "auto": "en-US-ChristopherNeural",
        }

        if voice_id in ["sky", "breeze", "female"]:
            chosen_voice = "en-US-AvaMultilingualNeural"
        elif voice_id in ["onyx", "cove", "male"]:
            chosen_voice = "en-US-ChristopherNeural"
        else:
            chosen_voice = VOICE_MAP.get(language, "en-US-ChristopherNeural")

        async def generate_edge_mp3():
            communicate = edge_tts.Communicate(clean_text, chosen_voice, rate="+6%", pitch="+0Hz")
            mp3_data = bytearray()
            async for chunk in communicate.stream():
                if chunk["type"] == "audio":
                    mp3_data.extend(chunk["data"])
            return bytes(mp3_data)

        try:
            try:
                audio_bytes = async_to_sync(generate_edge_mp3)()
                print(f"[TTS API] Edge-TTS success: {len(audio_bytes)} bytes for '{clean_text[:30]}'")
            except Exception as edge_err:
                print(f"[TTS API] Edge-TTS error ({edge_err}), using fallback gTTS...")
                gtts_lang = language if language in ['hi', 'kn', 'ta', 'te', 'mr', 'bn', 'gu'] else 'en'
                tts = gTTS(text=clean_text, lang=gtts_lang)
                fp = io.BytesIO()
                tts.write_to_fp(fp)
                audio_bytes = fp.getvalue()

            response = HttpResponse(audio_bytes, content_type="audio/mpeg")
            response["Content-Disposition"] = 'inline; filename="speech.mp3"'
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
