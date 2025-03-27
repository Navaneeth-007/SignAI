import asyncio
import websockets
import json
import cv2
import numpy as np
import base64
import sys
import os
from pathlib import Path

# Add the model directory to Python path
sys.path.append(str(Path(__file__).parent.parent / 'model'))

from sign_interpreter import SignLanguageInterpreter
import speech_recognition as sr
from gtts import gTTS
import tempfile
import threading
import queue

class SignAIServer:
    def __init__(self):
        self.interpreter = SignLanguageInterpreter()
        self.recognizer = sr.Recognizer()
        self.clients = {}  # Store client websocket connections and their roles
        self.audio_queue = queue.Queue()
        
    async def register(self, websocket, role):
        """Register a new client connection"""
        self.clients[websocket] = {"role": role, "partner": None}
        
    async def unregister(self, websocket):
        """Unregister a client connection"""
        if websocket in self.clients:
            del self.clients[websocket]

    def process_video_frame(self, frame_data):
        """Process video frame and return sign language interpretation"""
        # Decode base64 image
        img_bytes = base64.b64decode(frame_data.split(',')[1])
        img_arr = np.frombuffer(img_bytes, np.uint8)
        frame = cv2.imdecode(img_arr, cv2.IMREAD_COLOR)
        
        # Get prediction from the model
        prediction = self.interpreter.predict(frame)
        return prediction

    def text_to_speech(self, text):
        """Convert text to speech and return audio data"""
        with tempfile.NamedTemporaryFile(suffix='.mp3', delete=False) as fp:
            tts = gTTS(text=text, lang='en')
            tts.save(fp.name)
            with open(fp.name, 'rb') as audio_file:
                audio_data = audio_file.read()
            os.unlink(fp.name)
        return base64.b64encode(audio_data).decode('utf-8')

    def process_audio(self, audio_data):
        """Process audio and return transcribed text"""
        try:
            # Convert base64 audio to wav
            audio_bytes = base64.b64decode(audio_data)
            with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as fp:
                fp.write(audio_bytes)
                fp.flush()
                
                with sr.AudioFile(fp.name) as source:
                    audio = self.recognizer.record(source)
                    text = self.recognizer.recognize_google(audio)
                
            os.unlink(fp.name)
            return text
        except Exception as e:
            print(f"Error processing audio: {e}")
            return None

    async def handle_client(self, websocket, path):
        """Handle client connection and messages"""
        try:
            # Wait for initial role message
            message = await websocket.recv()
            data = json.loads(message)
            role = data.get('role')
            
            await self.register(websocket, role)
            
            async for message in websocket:
                data = json.loads(message)
                message_type = data.get('type')
                
                if message_type == 'video_frame' and role == 'accessibility':
                    # Process sign language video
                    frame_data = data.get('data')
                    prediction = self.process_video_frame(frame_data)
                    
                    if prediction:
                        # Convert prediction to speech for regular user
                        audio_data = self.text_to_speech(prediction)
                        
                        # Send to regular user
                        for client, info in self.clients.items():
                            if info['role'] == 'normal':
                                await client.send(json.dumps({
                                    'type': 'interpretation',
                                    'text': prediction,
                                    'audio': audio_data
                                }))
                
                elif message_type == 'audio' and role == 'normal':
                    # Process speech from regular user
                    audio_data = data.get('data')
                    text = self.process_audio(audio_data)
                    
                    if text:
                        # Convert to speech for accessibility user
                        audio_data = self.text_to_speech(text)
                        
                        # Send to accessibility user
                        for client, info in self.clients.items():
                            if info['role'] == 'accessibility':
                                await client.send(json.dumps({
                                    'type': 'interpretation',
                                    'text': text,
                                    'audio': audio_data
                                }))
                                
        except websockets.exceptions.ConnectionClosed:
            pass
        finally:
            await self.unregister(websocket)

async def main():
    server = SignAIServer()
    async with websockets.serve(server.handle_client, "localhost", 8765):
        await asyncio.Future()  # run forever

if __name__ == "__main__":
    asyncio.run(main()) 