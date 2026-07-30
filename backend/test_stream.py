import time
import requests

res = requests.post('http://127.0.0.1:8000/api/token/', json={'username': 'testuser', 'password': 'testpass'})
token = res.json().get('access')
headers = {'Authorization': f'Bearer {token}'}

t0 = time.time()
stream_res = requests.post('http://127.0.0.1:8000/api/chat/', json={'query': 'Tell me about PM Kisan', 'is_voice': True, 'stream': True}, headers=headers, stream=True)

print("=== REALTIME SSE STREAM BENCHMARK ===")
first_chunk_time = None
chunk_count = 0

for line in stream_res.iter_lines():
    if line:
        dt = (time.time() - t0) * 1000
        if first_chunk_time is None:
            first_chunk_time = dt
            print(f"FIRST TOKEN ARRIVED IN: {first_chunk_time:.1f} ms!")
        chunk_count += 1
        txt = line.decode('utf-8')
        if chunk_count <= 5 or 'DONE' in txt:
            print(f"[{dt:.0f}ms] Chunk #{chunk_count}: {txt[:60]}")

print(f"\nTotal Chunks: {chunk_count}")
print(f"First-Token Latency: {first_chunk_time:.1f} ms")
