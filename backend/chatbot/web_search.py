"""
web_search.py — Advanced Live Web Search Pipeline for Government Schemes
=========================================================================

Features:
1. Multi-Engine Live Search (DDG HTML, DDG Lite, DuckDuckGo API, Wikipedia)
2. URL unquoting and domain classification (.gov.in priority)
3. Fallback to general scheme portals (VikasPedia, India.gov, scheme portals)
4. Robust error handling & zero crash fallback
"""

import urllib.request
import urllib.parse
import json
import re
from bs4 import BeautifulSoup

HEADERS = {
    'User-Agent': (
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
        'AppleWebKit/537.36 (KHTML, like Gecko) '
        'Chrome/122.0.0.0 Safari/537.36'
    )
}

def clean_url(raw_url: str) -> str:
    """Extract actual target URL from DDG redirect links."""
    if not raw_url:
        return ""
    match = re.search(r'uddg=([^&]+)', raw_url)
    if match:
        return urllib.parse.unquote(match.group(1))
    if raw_url.startswith('//'):
        return 'https:' + raw_url
    return raw_url

def search_ddg_html(query: str) -> list:
    """Scrape DuckDuckGo HTML endpoint for rich real-time snippets."""
    try:
        search_term = f"{query} scheme india eligibility apply documents"
        url = 'https://html.duckduckgo.com/html/?q=' + urllib.parse.quote(search_term)
        req = urllib.request.Request(url, headers=HEADERS)
        html = urllib.request.urlopen(req, timeout=6).read().decode('utf-8', 'ignore')
        soup = BeautifulSoup(html, 'html.parser')
        
        results = []
        for a, p in zip(soup.find_all('a', class_='result__a'), soup.find_all('a', class_='result__snippet')):
            title = a.text.strip()
            snippet = p.text.strip()
            link = clean_url(a.get('href', ''))
            if title and snippet:
                results.append({'title': title, 'snippet': snippet, 'url': link})
        return results
    except Exception as e:
        print(f"[WebSearch] DDG HTML search error: {e}")
        return []

def search_ddg_lite(query: str) -> list:
    """Fallback using DuckDuckGo Lite endpoint."""
    try:
        search_term = f"{query} scheme india eligibility apply documents"
        url = 'https://lite.duckduckgo.com/lite/'
        data = urllib.parse.urlencode({'q': search_term}).encode('utf-8')
        req = urllib.request.Request(url, data=data, headers=HEADERS)
        html = urllib.request.urlopen(req, timeout=6).read().decode('utf-8', 'ignore')
        soup = BeautifulSoup(html, 'html.parser')
        
        results = []
        snippets = soup.find_all('td', class_='result-snippet')
        links = soup.find_all('a', class_='result-link')
        for a, p in zip(links, snippets):
            title = a.text.strip()
            snippet = p.text.strip()
            link = clean_url(a.get('href', ''))
            if title and snippet:
                results.append({'title': title, 'snippet': snippet, 'url': link})
        return results
    except Exception as e:
        print(f"[WebSearch] DDG Lite search error: {e}")
        return []

def search_ddg_lib(query: str) -> list:
    """Fallback using duckduckgo_search library if installed."""
    try:
        from duckduckgo_search import DDGS
        results = []
        with DDGS() as ddgs:
            raw_res = list(ddgs.text(f"{query} scheme india", max_results=10, safesearch="off"))
            for r in raw_res:
                results.append({
                    'title': r.get('title', ''),
                    'snippet': r.get('body', ''),
                    'url': r.get('href', '')
                })
        return results
    except Exception as e:
        print(f"[WebSearch] DDGS library error: {e}")
        return []

def fallback_wikipedia_search(query: str) -> str:
    """Search Wikipedia API for scheme background."""
    print(f"[WebSearch] Searching Wikipedia for: '{query}'")
    try:
        safe_query = urllib.parse.quote(query)
        search_url = f"https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch={safe_query}&utf8=&format=json&srlimit=1"
        
        req = urllib.request.Request(search_url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=5) as response:
            search_data = json.loads(response.read().decode())
        
        if not search_data.get('query', {}).get('search'):
            return ""

        title = search_data['query']['search'][0]['title']
        safe_title = urllib.parse.quote(title)
        extract_url = f"https://en.wikipedia.org/w/api.php?action=query&prop=extracts&exintro&explaintext&titles={safe_title}&format=json"
        
        req2 = urllib.request.Request(extract_url, headers=HEADERS)
        with urllib.request.urlopen(req2, timeout=5) as response2:
            extract_data = json.loads(response2.read().decode())
        
        pages = extract_data.get('query', {}).get('pages', {})
        for _, page_info in pages.items():
            extract = page_info.get('extract', '')
            if extract:
                print(f"[WebSearch] Wikipedia success for '{title}'")
                return f"1. **{title}**\n   {extract}\n   Source: https://en.wikipedia.org/wiki/{safe_title}"
        return ""
    except Exception as ex:
        print(f"[WebSearch] Wikipedia fallback error: {ex}")
        return ""

def search_web(query: str, max_results: int = 5) -> str:
    """
    Main Live Web Search entrypoint.
    Executes multi-engine search, ranks government portals higher, and returns formatted context.
    """
    print(f"[WebSearch] Executing live web search for: '{query}'")
    
    # Step 1: Execute primary live search (DDG HTML -> DDG Lite -> DDGS library)
    results = search_ddg_html(query)
    if not results:
        print("[WebSearch] Trying DDG Lite backend...")
        results = search_ddg_lite(query)
    if not results:
        print("[WebSearch] Trying DDGS python package...")
        results = search_ddg_lib(query)
        
    # Step 2: Sort / Rank results by domain authority
    if results:
        gov_results = []
        other_results = []
        for item in results:
            url_lower = item['url'].lower()
            if '.gov.in' in url_lower or '.nic.in' in url_lower or 'myscheme.gov.in' in url_lower:
                gov_results.append(item)
            else:
                other_results.append(item)
                
        # Combine: official government results first, followed by general web portals
        ranked_results = gov_results + other_results
        
        formatted_items = []
        for i, item in enumerate(ranked_results[:max_results], 1):
            source_tag = "[Official Government Source]" if ('.gov.in' in item['url'].lower() or '.nic.in' in item['url'].lower()) else "[Web Source]"
            formatted_items.append(
                f"{i}. **{item['title']}** {source_tag}\n"
                f"   {item['snippet']}\n"
                f"   Source URL: {item['url']}"
            )
            
        formatted_context = "\n\n".join(formatted_items)
        print(f"[WebSearch] Successfully compiled {len(formatted_items)} live web search results.")
        return formatted_context
        
    # Step 3: If all web search scrapers returned no results, use Wikipedia fallback
    print("[WebSearch] Scrapers returned 0 results. Falling back to Wikipedia API...")
    wiki_res = fallback_wikipedia_search(query)
    if wiki_res:
        return wiki_res
        
    return ""
