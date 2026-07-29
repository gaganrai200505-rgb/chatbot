from django.contrib import admin
from .models import ChatMessage, GovernmentScheme

@admin.register(ChatMessage)
class ChatMessageAdmin(admin.ModelAdmin):
    list_display = ('user', 'query', 'language', 'timestamp')
    search_fields = ('query', 'response')
    list_filter = ('language', 'timestamp')

@admin.register(GovernmentScheme)
class GovernmentSchemeAdmin(admin.ModelAdmin):
    list_display = ('title', 'created_at', 'updated_at')
    search_fields = ('title', 'description', 'details')
