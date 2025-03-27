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
import threading
import queue
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

# Get port from environment variable (for Heroku)
PORT = int(os.environ.get("PORT", 8765))
HOST = os.environ.get("HOST", "0.0.0.0")

class CallRoom:
    def __init__(self, room_id):
        self.room_id = room_id
        self.clients = {}  # {websocket: {'role': role}}
        self.max_clients = 2

    def is_full(self):
        return len(self.clients) >= self.max_clients

    def add_client(self, websocket, role):
        if not self.is_full():
            self.clients[websocket] = {'role': role}
            return True
        return False

    def remove_client(self, websocket):
        if websocket in self.clients:
            del self.clients[websocket]

    def get_other_client(self, websocket):
        for client in self.clients:
            if client != websocket:
                return client
        return None

class SignalServer:
    def __init__(self):
        self.rooms = {}  # {room_id: CallRoom}

    def create_or_join_room(self, room_id, websocket, role):
        if room_id not in self.rooms:
            self.rooms[room_id] = CallRoom(room_id)
        
        room = self.rooms[room_id]
        if room.add_client(websocket, role):
            return room
        return None

    def remove_client(self, websocket):
        for room in list(self.rooms.values()):
            if websocket in room.clients:
                room.remove_client(websocket)
                if len(room.clients) == 0:
                    del self.rooms[room.room_id]
                return room
        return None

signal_server = SignalServer()

class SignAIServer:
    def __init__(self):
        try:
            self.interpreter = SignLanguageInterpreter()
            self.recognizer = sr.Recognizer()
            self.clients = {}  # Store client websocket connections and their roles
            self.pairs = {}  # Store paired users
            logging.info("SignAI Server initialized successfully")
        except Exception as e:
            logging.error(f"Error initializing SignAI Server: {e}")
            raise

    async def register(self, websocket, role):
        """Register a new client connection and attempt pairing"""
        self.clients[websocket] = {"role": role, "partner": None, "connected_at": datetime.now().isoformat()}
        logging.info(f"New client registered with role: {role}")

        # Attempt to pair the user
        await self.pair_users()

    async def unregister(self, websocket):
        """Unregister a client connection and clean up pairing"""
        if websocket in self.clients:
            partner = self.clients[websocket]["partner"]
            if partner:
                # Notify the partner that the user has disconnected
                await partner.send(json.dumps({
                    'type': 'error',
                    'message': 'Your partner has disconnected.'
                }))
                self.clients[partner]["partner"] = None

            # Remove the client and clean up pairing
            del self.clients[websocket]
            logging.info(f"Client unregistered")

    async def pair_users(self):
        """Pair users based on their roles"""
        normal_user = None
        accessibility_user = None

        # Find unpaired users
        for websocket, info in self.clients.items():
            if info["partner"] is None:
                if info["role"] == "normal" and normal_user is None:
                    normal_user = websocket
                elif info["role"] == "accessibility" and accessibility_user is None:
                    accessibility_user = websocket

        # Pair the users if both roles are available
        if normal_user and accessibility_user:
            self.clients[normal_user]["partner"] = accessibility_user
            self.clients[accessibility_user]["partner"] = normal_user

            # Notify both users about the pairing
            await normal_user.send(json.dumps({
                'type': 'connection_status',
                'status': 'paired',
                'message': 'You are now connected to an accessibility user.'
            }))
            await accessibility_user.send(json.dumps({
                'type': 'connection_status',
                'status': 'paired',
                'message': 'You are now connected to a normal user.'
            }))
            logging.info("Users paired successfully")

    def process_video_frame(self, frame_data):
        """Process video frame and return sign language interpretation"""
        try:
            # Decode base64 image
            img_bytes = base64.b64decode(frame_data.split(',')[1])
            img_arr = np.frombuffer(img_bytes, np.uint8)
            frame = cv2.imdecode(img_arr, cv2.IMREAD_COLOR)
            
            # Get prediction from the model
            prediction = self.interpreter.predict(frame)
            if prediction:
                logging.info(f"Prediction made: {prediction}")
            return prediction
        except Exception as e:
            logging.error(f"Error processing video frame: {e}")
            return None

    def text_to_speech(self, text):
        """Convert text to speech and return audio data"""
        try:
            with tempfile.NamedTemporaryFile(suffix='.mp3', delete=False) as fp:
                tts = gTTS(text=text, lang='en')
                tts.save(fp.name)
                with open(fp.name, 'rb') as audio_file:
                    audio_data = audio_file.read()
                os.unlink(fp.name)
            logging.info(f"Text converted to speech: {text}")
            return base64.b64encode(audio_data).decode('utf-8')
        except Exception as e:
            logging.error(f"Error converting text to speech: {e}")
            return None

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
            logging.info(f"Audio processed to text: {text}")
            return text
        except Exception as e:
            logging.error(f"Error processing audio: {e}")
            return None

    async def handle_client(self, websocket, path):
        """Handle client connection and messages"""
        try:
            logger.info(f"New client connected from {websocket.remote_address}")

            # Wait for initial role message
            message = await websocket.recv()
            data = json.loads(message)
            client_role = data.get('role')

            if not client_role:
                logger.error("No role specified in initial message")
                await websocket.send(json.dumps({
                    'type': 'error',
                    'message': 'No role specified'
                }))
                return

            await self.register(websocket, client_role)

            async for message in websocket:
                try:
                    data = json.loads(message)
                    logger.info(f"Received {data['type']} message from {client_role} user")

                    partner = self.clients[websocket]["partner"]
                    if not partner:
                        await websocket.send(json.dumps({
                            'type': 'error',
                            'message': 'No partner connected.'
                        }))
                        continue

                    message_type = data.get('type')

                    if message_type == 'video_frame' and client_role == 'accessibility':
                        frame_data = data.get('data')
                        prediction = self.process_video_frame(frame_data)

                        if prediction:
                            audio_data = self.text_to_speech(prediction)
                            await partner.send(json.dumps({
                                'type': 'interpretation',
                                'text': prediction,
                                'audio': audio_data
                            }))

                    elif message_type == 'audio' and client_role == 'normal':
                        audio_data = data.get('data')
                        text = self.process_audio(audio_data)

                        if text:
                            audio_data = self.text_to_speech(text)
                            await partner.send(json.dumps({
                                'type': 'interpretation',
                                'text': text,
                                'audio': audio_data
                            }))
                except json.JSONDecodeError as e:
                    logger.error(f"Invalid JSON received: {e}")
                    await websocket.send(json.dumps({
                        'type': 'error',
                        'message': 'Invalid message format'
                    }))
                except Exception as e:
                    logger.error(f"Error processing message: {e}")
                    await websocket.send(json.dumps({
                        'type': 'error',
                        'message': f'Server error: {str(e)}'
                    }))

        except websockets.exceptions.ConnectionClosed:
            logger.info("Client connection closed")
        except Exception as e:
            logger.error(f"Unexpected error in handle_client: {e}")
        finally:
            await self.unregister(websocket)

async def handle_client(websocket, path):
    room = None
    try:
        logger.info(f"New connection from {websocket.remote_address}")
        
        # Wait for initial connection message
        message = await websocket.recv()
        data = json.loads(message)
        
        if 'type' not in data:
            raise ValueError("Message type not specified")

        if data['type'] == 'join':
            room_id = data.get('roomId')
            role = data.get('role')
            
            if not room_id or not role:
                raise ValueError("Room ID and role are required")

            room = signal_server.create_or_join_room(room_id, websocket, role)
            
            if not room:
                await websocket.send(json.dumps({
                    'type': 'error',
                    'message': 'Room is full'
                }))
                return

            # Notify client of successful connection
            await websocket.send(json.dumps({
                'type': 'connected',
                'role': role,
                'clients': len(room.clients)
            }))

            # Notify other client if present
            other_client = room.get_other_client(websocket)
            if other_client:
                await other_client.send(json.dumps({
                    'type': 'user_joined',
                    'role': role
                }))

        # Handle WebRTC signaling
        async for message in websocket:
            try:
                data = json.loads(message)
                message_type = data.get('type')

                if not room:
                    logger.error("No room found for client")
                    continue

                if message_type in ['offer', 'answer', 'ice-candidate']:
                    other_client = room.get_other_client(websocket)
                    if other_client:
                        await other_client.send(message)
                        logger.info(f"Forwarded {message_type} to peer")
                    else:
                        logger.warning(f"No peer found for {message_type}")

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
        if room:
            room = signal_server.remove_client(websocket)
            if room:
                other_client = room.get_other_client(websocket)
                if other_client:
                    try:
                        await other_client.send(json.dumps({
                            'type': 'user_left'
                        }))
                    except:
                        pass
        logger.info("Client cleanup completed")

async def main():
    try:
        logger.info(f"Starting WebSocket server on {HOST}:{PORT}...")
        async with websockets.serve(handle_client, HOST, PORT):
            logger.info(f"WebSocket server is running on ws://{HOST}:{PORT}")
            await asyncio.Future()  # run forever
    except Exception as e:
        logger.error(f"Server error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Server stopped by user")
    except Exception as e:
        logger.error(f"Server crashed: {e}")
        sys.exit(1)