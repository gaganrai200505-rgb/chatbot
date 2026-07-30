import time
import requests

res = requests.post('http://127.0.0.1:8000/api/token/', json={'username': 'testuser', 'password': 'testpass'})
token = res.json().get('access')
headers = {'Authorization': f'Bearer {token}'}

queries = [
    'Tell me about PM Kisan',
    'Ayushman Bharat eligibility',
    'Hello'
]

print("=== LATENCY BENCHMARK ===")
times = []
for q in queries:
    t0 = time.time()
    resp = requests.post('http://127.0.0.1:8000/api/chat/', json={'query': q, 'is_voice': True}, headers=headers)
    dt = (time.time() - t0) * 1000
    times.append(dt)
    print(f"Query: '{q}' -> {dt:.1f} ms (Status: {resp.status_code})")

print(f"Average Response Time: {sum(times)/len(times):.1f} ms")
