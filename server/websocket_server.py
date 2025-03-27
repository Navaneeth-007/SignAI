import asyncio
import websockets
import json
import cv2
import numpy as np
import base64
import sys
import os
from pathlib import Path
from datetime import datetime
import speech_recognition as sr
from gtts import gTTS
import tempfile
import logging

# Add the model directory to Python path
current_dir = Path(__file__).parent
model_dir = current_dir.parent / 'model'
sys.path.append(str(model_dir))

try:
    from sign_interpreter import SignLanguageInterpreter
except ImportError as e:
    print(f"Error importing SignLanguageInterpreter: {e}")
    print(f"Looking in path: {model_dir}")
    sys.exit(1)

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger(__name__)

# Get port from environment variable (for Render)
PORT = int(os.environ.get("PORT", "10000"))
HOST = "0.0.0.0"  # Bind to all interfaces

class CallConnection:
    def __init__(self, call_id):
        self.call_id = call_id
        self.users = {}  # {user_id: {websocket, role}}
        self.interpreter = SignLanguageInterpreter()
        self.recognizer = sr.Recognizer()

    def add_user(self, user_id, websocket, role):
        if len(self.users) < 2:
            self.users[user_id] = {"websocket": websocket, "role": role}
            return True
        return False

    def remove_user(self, user_id):
        if user_id in self.users:
            del self.users[user_id]

    def get_other_user(self, user_id):
        for uid, data in self.users.items():
            if uid != user_id:
                return uid, data
        return None, None

    def is_full(self):
        return len(self.users) >= 2

    def process_video_frame(self, frame_data):
        try:
            # Decode base64 image
            img_bytes = base64.b64decode(frame_data.split(',')[1])
            img_arr = np.frombuffer(img_bytes, np.uint8)
            frame = cv2.imdecode(img_arr, cv2.IMREAD_COLOR)
            
            # Get prediction from the model
            prediction = self.interpreter.predict(frame)
            if prediction:
                logger.info(f"Prediction made: {prediction}")
            return prediction
        except Exception as e:
            logger.error(f"Error processing video frame: {e}")
            return None

    def process_audio(self, audio_data):
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
            logger.info(f"Audio processed to text: {text}")
            return text
        except Exception as e:
            logger.error(f"Error processing audio: {e}")
            return None

    def text_to_speech(self, text):
        try:
            with tempfile.NamedTemporaryFile(suffix='.mp3', delete=False) as fp:
                tts = gTTS(text=text, lang='en')
                tts.save(fp.name)
                with open(fp.name, 'rb') as audio_file:
                    audio_data = audio_file.read()
                os.unlink(fp.name)
            logger.info(f"Text converted to speech: {text}")
            return base64.b64encode(audio_data).decode('utf-8')
        except Exception as e:
            logger.error(f"Error converting text to speech: {e}")
            return None

class CallManager:
    def __init__(self):
        self.calls = {}  # {call_id: CallConnection}

    def create_or_join_call(self, call_id, user_id, websocket, role):
        if call_id not in self.calls:
            self.calls[call_id] = CallConnection(call_id)
        
        call = self.calls[call_id]
        if call.add_user(user_id, websocket, role):
            return call
        return None

    def remove_user_from_call(self, call_id, user_id):
        if call_id in self.calls:
            call = self.calls[call_id]
            call.remove_user(user_id)
            if len(call.users) == 0:
                del self.calls[call_id]
                return None
            return call
        return None

call_manager = CallManager()

async def handle_client(websocket, path):
    call = None
    user_id = None
    call_id = None
    
    try:
        logger.info(f"New connection from {websocket.remote_address}")
        
        # Wait for initial connection message
        message = await websocket.recv()
        data = json.loads(message)
        
        if data['type'] == 'join':
            user_id = data.get('userId')
            call_id = data.get('callId')
            role = data.get('role')
            
            if not all([user_id, call_id, role]):
                raise ValueError("userId, callId, and role are required")

            call = call_manager.create_or_join_call(call_id, user_id, websocket, role)
            
            if not call:
                await websocket.send(json.dumps({
                    'type': 'error',
                    'message': 'Call is full'
                }))
                return

            # Notify client of successful connection
            await websocket.send(json.dumps({
                'type': 'connected',
                'role': role,
                'isCallReady': call.is_full()
            }))

            # Notify other user if present
            other_id, other_data = call.get_other_user(user_id)
            if other_id:
                await other_data['websocket'].send(json.dumps({
                    'type': 'user_joined',
                    'role': role
                }))

        # Handle messages
        async for message in websocket:
            if not call:
                continue

            try:
                data = json.loads(message)
                message_type = data.get('type')

                if message_type in ['offer', 'answer', 'ice-candidate']:
                    # Handle WebRTC signaling
                    other_id, other_data = call.get_other_user(user_id)
                    if other_id:
                        await other_data['websocket'].send(message)
                        logger.info(f"Forwarded {message_type} to peer")
                    else:
                        logger.warning(f"No peer found for {message_type}")

                elif message_type == 'video_frame':
                    # Handle sign language interpretation
                    frame_data = data.get('data')
                    prediction = call.process_video_frame(frame_data)
                    if prediction:
                        audio_data = call.text_to_speech(prediction)
                        other_id, other_data = call.get_other_user(user_id)
                        if other_id:
                            await other_data['websocket'].send(json.dumps({
                                'type': 'interpretation',
                                'text': prediction,
                                'audio': audio_data
                            }))

                elif message_type == 'audio':
                    # Handle speech-to-text
                    audio_data = data.get('data')
                    text = call.process_audio(audio_data)
                    if text:
                        audio_data = call.text_to_speech(text)
                        other_id, other_data = call.get_other_user(user_id)
                        if other_id:
                            await other_data['websocket'].send(json.dumps({
                                'type': 'interpretation',
                                'text': text,
                                'audio': audio_data
                            }))

            except json.JSONDecodeError as e:
                logger.error(f"Invalid JSON: {e}")
                await websocket.send(json.dumps({
                    'type': 'error',
                    'message': 'Invalid message format'
                }))

    except websockets.exceptions.ConnectionClosed:
        logger.info("Client disconnected normally")
    except Exception as e:
        logger.error(f"Error handling client: {e}")
        try:
            await websocket.send(json.dumps({
                'type': 'error',
                'message': str(e)
            }))
        except:
            pass
    finally:
        if call_id and user_id:
            call = call_manager.remove_user_from_call(call_id, user_id)
            if call:
                other_id, other_data = call.get_other_user(user_id)
                if other_id:
                    try:
                        await other_data['websocket'].send(json.dumps({
                            'type': 'user_left'
                        }))
                    except:
                        pass
        logger.info("Client cleanup completed")

async def main():
    logger.info(f"Starting WebSocket server on {HOST}:{PORT}")
    async with websockets.serve(
        handle_client,
        host=HOST,
        port=PORT,
        ping_interval=20,
        ping_timeout=20,
        close_timeout=10
    ):
        await asyncio.Future()  # run forever

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Server stopped by user")
    except Exception as e:
        logger.error(f"Server error: {e}")
        sys.exit(1)