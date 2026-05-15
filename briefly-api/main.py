from fastapi import FastAPI, UploadFile, File, Form, Body
from fastapi.middleware.cors import CORSMiddleware
from google import genai
from google.genai import types
from dotenv import load_dotenv
import tempfile
import datetime
import os
import time
import json
import re

load_dotenv()

def parse_json(text: str) -> dict:
    """Robustly extract JSON from Gemini responses that may have extra text."""
    if not text:
        return {}
    # Strip markdown code fences if present
    text = re.sub(r'^```(?:json)?\s*', '', text.strip(), flags=re.IGNORECASE)
    text = re.sub(r'\s*```$', '', text.strip())
    # Try direct parse first
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    # Extract first complete JSON object using brace matching
    start = text.find('{')
    if start == -1:
        return {}
    depth = 0
    for i, ch in enumerate(text[start:], start):
        if ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(text[start:i+1])
                except json.JSONDecodeError:
                    break
    return {}


app = FastAPI()

api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

client = genai.Client(
    api_key=api_key,
    http_options=types.HttpOptions(
        retry_options=types.HttpRetryOptions(
            attempts=3,
            initial_delay=2.0,
            http_status_codes=[503, 429] 
        )
    )
)

if api_key:
    print("Using Gemini API key from", "GEMINI_API_KEY" if os.getenv("GEMINI_API_KEY") else "GOOGLE_API_KEY")
else:
    print("Warning: no Gemini API key found in environment")

@app.post("/process-audio")
async def process_audio(
    file: UploadFile = File(...),
    language: str = Form(...),
    participants: str = Form(default=None),     # JSON array of names from Google Meet DOM
    speaker_timeline: str = Form(default=None)  # JSON array of { name, timestamp } pairs
):
    temp_path = None
    uploaded_file = None
    
    try:
        print(f"\n--- NEW REQUEST ---")
        with tempfile.NamedTemporaryFile(delete=False, suffix=".webm") as temp_file:
            temp_file.write(await file.read())
            temp_path = temp_file.name

        print("Uploading to Google Gemini Storage...")
        uploaded_file = client.files.upload(file=temp_path, config={'mime_type': 'audio/webm'})
        
        if uploaded_file and uploaded_file.name:
            while uploaded_file.state and uploaded_file.state.name == "PROCESSING":
                time.sleep(2)
                uploaded_file = client.files.get(name=uploaded_file.name)
                
            if uploaded_file.state and uploaded_file.state.name == "FAILED":
                raise Exception("Gemini failed to process the audio. The recording might be too short or corrupted. Try recording for at least 5 seconds.")

        now = datetime.datetime.now().strftime("%Y-%m-%dT%H:%M:%S")

        # Build the speaker context block if real names are available from Google Meet DOM
        speaker_context = ""
        participant_list = []
        if participants:
            try:
                participant_list = json.loads(participants)
            except Exception:
                pass

        if participant_list:
            names_str = ", ".join(participant_list)
            speaker_context = f"""
        IMPORTANT SPEAKER CONTEXT: This meeting was recorded from Google Meet.
        The following real participant names were detected from the meeting UI: [{names_str}].
        When identifying speakers in the 'accountability' field, USE THESE EXACT REAL NAMES instead of
        generic labels like 'Speaker 1'. Match each voice you detect to the most likely person from this list.
        If you cannot confidently match a voice to a name, use the name 'Unknown Participant'.
        """

        prompt = f"""
        Analyze this audio. Today's date and time is {now}.
        {speaker_context}
        Return a JSON object in {language} with exactly seven keys:
        - 'summary': a 3-5 sentence paragraph.
        - 'action_items': an array of strings.
        - 'decisions': an array of strings.
        - 'mermaid_diagram': a Mermaid.js flowchart string representing any system architecture, workflow, or process discussed. Use proper mermaid syntax (graph TD). If no process/architecture is discussed, return an empty string.
        - 'calendar_events': an array of objects for any deadlines or meetings mentioned. Each object should have 'title' (string), 'start_time_iso' (ISO 8601 string, guess based on today if relative), 'end_time_iso' (ISO 8601 string, guess based on start_time), and 'description' (string). If none, return an empty array.
        - 'transcript': the full word-for-word transcript of the audio.
        - 'accountability': an array of objects identifying distinct speakers and their most important statements. Listen carefully for voice changes to distinguish between speakers. For each speaker, extract only statements that are significant — such as commitments ("I will do X"), decisions ("We should go with Y"), opinions on key topics, or questions that changed the discussion. Each object must have exactly two keys: 'speaker' (use the real participant names if provided above, otherwise use "Speaker 1", "Speaker 2", etc.) and 'statement' (the important quote or paraphrased key point from that speaker). If the audio has only one speaker or no important statements can be identified per speaker, return an empty array.
        """
        
        config = types.GenerateContentConfig(response_mime_type="application/json")
        
        print("Analyzing with Gemini...")
        response = client.models.generate_content(
            model="gemini-3.1-flash-lite-preview",
            contents=[uploaded_file, prompt],
            config=config
        )
        
        return {"status": "success", "data": parse_json(response.text)}

    except Exception as e:
        print(f"Error: {e}")
        return {"status": "error", "message": str(e)}

    finally:
        if uploaded_file and uploaded_file.name:
            try: client.files.delete(name=uploaded_file.name)
            except: pass
        if temp_path and os.path.exists(temp_path):
            try: os.remove(temp_path)
            except: pass

@app.post("/chat")
async def chat(transcript: str = Body(...), question: str = Body(...)):
    try:
        prompt = f"""
        Based ONLY on this transcript:
        "{transcript}"
        
        Answer this question: "{question}"
        
        Keep the answer concise and professional.
        """
        response = client.models.generate_content(
            model="gemini-3.1-flash-lite-preview",
            contents=prompt
        )
        return {"status": "success", "answer": response.text}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.post("/chat-global")
async def chat_global(history: list = Body(...), question: str = Body(...)):
    try:
        context = ""
        for idx, item in enumerate(history):
            context += f"Meeting {idx+1} (Date: {item.get('date', 'Unknown')}):\n{item.get('transcript', '')}\n\n"
        
        prompt = f"""
        Based on the transcripts of ALL past meetings provided below:
        {context}
        
        Answer this question: "{question}"
        Keep the answer concise, professional, and cite the meeting dates if relevant.
        """
        response = client.models.generate_content(
            model="gemini-3.1-flash-lite-preview",
            contents=prompt
        )
        return {"status": "success", "answer": response.text}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.post("/generate-ticket")
async def generate_ticket(action_item: str = Body(...), transcript: str = Body(...), language: str = Body(default="English")):
    try:
        prompt = f"""
        Based on the following meeting transcript, generate a professional Jira ticket for this action item: "{action_item}"
        
        Transcript:
        "{transcript}"
        
        Generate the entire ticket (title, description, and acceptance criteria) in the following language: {language}.
        
        Return a JSON object with exactly three keys:
        - 'title': A concise, professional title for the Jira ticket.
        - 'description': A detailed description providing context from the meeting.
        - 'acceptance_criteria': An array of strings representing the acceptance criteria.
        """
        config = types.GenerateContentConfig(response_mime_type="application/json")
        response = client.models.generate_content(
            model="gemini-3.1-flash-lite-preview",
            contents=prompt,
            config=config
        )
        return {"status": "success", "ticket": parse_json(response.text)}
    except Exception as e:
        return {"status": "error", "message": str(e)}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)