import sys
sys.stdout = open("out.txt", "w")
import os
import time
from google import genai
from dotenv import load_dotenv

load_dotenv()
client = genai.Client()

with open("test.webm", "wb") as f:
    f.write(b"dummy webm data")

file = client.files.upload(file="test.webm")
print("Uploaded:", file.name, file.state.name if file.state else file.state)

while file.state and file.state.name == "PROCESSING":
    time.sleep(2)
    file = client.files.get(name=file.name)
    print("State:", file.state.name if file.state else file.state)

print("Final state:", file.state.name if file.state else file.state)
