from rest_framework import serializers
from django.contrib.auth.models import User
from .models import ChatMessage

from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError

class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ('id', 'username', 'password', 'email')
        extra_kwargs = {
            'password': {'write_only': True, 'min_length': 8},
            'email': {'required': True, 'allow_blank': False}  # Email is mandatory for OTP
        }

    def validate_email(self, value):
        if not value or not value.strip():
            raise serializers.ValidationError("A valid email address is required.")
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError("An account with this email already exists.")
        return value.lower().strip()

    def validate_password(self, value):
        user = User(username=self.initial_data.get('username', ''))
        try:
            validate_password(password=value, user=user)
        except DjangoValidationError as e:
            raise serializers.ValidationError(list(e.messages))
        return value

    def create(self, validated_data):
        user = User.objects.create_user(
            username=validated_data['username'],
            email=validated_data['email'],
            password=validated_data['password'],
            is_active=False,   # Account is inactive until email OTP is verified
        )
        return user


class PasswordResetSerializer(serializers.Serializer):
    new_password = serializers.CharField(min_length=8, write_only=True)

    def validate_new_password(self, value):
        try:
            validate_password(value)
        except DjangoValidationError as e:
            raise serializers.ValidationError(list(e.messages))
        return value


class ChatMessageSerializer(serializers.ModelSerializer):
    class Meta:
        model = ChatMessage
        fields = ['id', 'user', 'session_id', 'session_title', 'is_pinned', 'query', 'response', 'language', 'source', 'timestamp']
        read_only_fields = ('user', 'timestamp')


from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from django.contrib.auth import authenticate

class CustomTokenObtainPairSerializer(TokenObtainPairSerializer):
    """
    Custom Token Obtain Pair Serializer:
    Supports logging in with Username (case-sensitive) or Registered Email (case-insensitive).
    """
    def validate(self, attrs):
        username_or_email = str(attrs.get('username', '')).strip()
        password = attrs.get('password', '')

        user = authenticate(request=self.context.get('request'), username=username_or_email, password=password)
        if not user:
            raise serializers.ValidationError({'detail': 'No active account found with the given credentials.'})

        attrs['username'] = user.username
        return super().validate(attrs)

