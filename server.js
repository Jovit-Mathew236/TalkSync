const path = require('path');
const express = require('express');
const http = require('http');
const moment = require('moment');
const socketio = require('socket.io');
const bodyParser = require('body-parser');
const { TranslationServiceClient } = require('@google-cloud/translate').v3beta1;
const speech = require('@google-cloud/speech');

const PORT = process.env.PORT || 3000;
const GOOGLE_CLOUD_PROJECT_ID = 'talksync-412709'; // Replace with your Google Cloud project ID
const GOOGLE_CLOUD_TRANSLATE_API_KEY = 'AIzaSyB_SCg-Fq7Cxi_fSlFABTXziDg7KEyvn6o';
const GOOGLE_CLOUD_SPEECH_API_KEY = 'AIzaSyB_SCg-Fq7Cxi_fSlFABTXziDg7KEyvn6o';

const translationClient = new TranslationServiceClient({ apiKey: GOOGLE_CLOUD_TRANSLATE_API_KEY });
const speechClient = new speech.SpeechClient({ apiKey: GOOGLE_CLOUD_SPEECH_API_KEY });


const app = express();
const server = http.createServer(app);

const io = socketio(server);

app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.json());

app.post('/transcribe', async (req, res) => {
    const audioData = req.body.audio;
    try {
        const transcription = await transcribeAudio(audioData);
        res.send(transcription);
    } catch (error) {
        console.error('Error transcribing audio:', error);
        res.status(500).send('Error transcribing audio');
    }
});

app.post('/translate', async (req, res) => {
    const text = req.body.text;
    const sourceLanguage = req.body.sourceLanguage;
    const targetLanguage = req.body.targetLanguage;
    try {
        const translation = await translateText(text, sourceLanguage, targetLanguage);
        res.send(translation);
    } catch (error) {
        console.error('Error translating text:', error);
        res.status(500).send('Error translating text');
    }
});

let rooms = {};
let socketroom = {};
let socketname = {};
let micSocket = {};
let videoSocket = {};
let roomBoard = {};

io.on('connect', socket => {
    socket.on("join room", (roomid, username) => {

        socket.join(roomid);
        socketroom[socket.id] = roomid;
        socketname[socket.id] = username;
        micSocket[socket.id] = 'on';
        videoSocket[socket.id] = 'on';

        if (rooms[roomid] && rooms[roomid].length > 0) {
            rooms[roomid].push(socket.id);
            socket.to(roomid).emit('message', `${username} joined the room.`, 'Bot', moment().format(
                "h:mm a"
            ));
            io.to(socket.id).emit('join room', rooms[roomid].filter(pid => pid != socket.id), socketname, micSocket, videoSocket);
        }
        else {
            rooms[roomid] = [socket.id];
            io.to(socket.id).emit('join room', null, null, null, null);
        }

        io.to(roomid).emit('user count', rooms[roomid].length);

    });

    socket.on('action', msg => {
        if (msg == 'mute')
            micSocket[socket.id] = 'off';
        else if (msg == 'unmute')
            micSocket[socket.id] = 'on';
        else if (msg == 'videoon')
            videoSocket[socket.id] = 'on';
        else if (msg == 'videooff')
            videoSocket[socket.id] = 'off';

        socket.to(socketroom[socket.id]).emit('action', msg, socket.id);
    })

    socket.on('video-offer', (offer, sid) => {
        socket.to(sid).emit('video-offer', offer, socket.id, socketname[socket.id], micSocket[socket.id], videoSocket[socket.id]);
    })

    socket.on('video-answer', (answer, sid) => {
        socket.to(sid).emit('video-answer', answer, socket.id);
    })

    socket.on('new icecandidate', (candidate, sid) => {
        socket.to(sid).emit('new icecandidate', candidate, socket.id);
    })

    socket.on('message', (msg, username, roomid) => {
        io.to(roomid).emit('message', msg, username, moment().format(
            "h:mm a"
        ));
    })

    socket.on('getCanvas', () => {
        if (roomBoard[socketroom[socket.id]])
            socket.emit('getCanvas', roomBoard[socketroom[socket.id]]);
    });

    socket.on('draw', (newx, newy, prevx, prevy, color, size) => {
        socket.to(socketroom[socket.id]).emit('draw', newx, newy, prevx, prevy, color, size);
    })

    socket.on('clearBoard', () => {
        socket.to(socketroom[socket.id]).emit('clearBoard');
    });

    socket.on('store canvas', url => {
        roomBoard[socketroom[socket.id]] = url;
    })

     // Start translation when receiving 'startTranslation' event from client
     socket.on('startTranslation', async ({ sourceLanguage, targetLanguage }) => {
        console.log('Received startTranslation event from client');
        console.log('Source language:', sourceLanguage);
        console.log('Target language:', targetLanguage);

        // When receiving audio stream from the client
        socket.on('audio_stream', async function (audioBuffer) {
            console.log('Received audio stream from client');

            try {
                // Transcribe the audio stream
                const transcription = await transcribeAudio(audioBuffer);
                
                // Translate the transcription
                const translation = await translateText(transcription, sourceLanguage, targetLanguage);

                // Emit the translated text to all clients
                io.emit('translatedText', translation);
                console.log('Sent translated text to all clients:', translation);
            } catch (error) {
                console.error('Error transcribing and translating audio:', error);
            }
        });
    });


    socket.on('disconnect', () => {
        if (!socketroom[socket.id]) return;
        socket.to(socketroom[socket.id]).emit('message', `${socketname[socket.id]} left the chat.`, `Bot`, moment().format(
            "h:mm a"
        ));
        socket.to(socketroom[socket.id]).emit('remove peer', socket.id);
        var index = rooms[socketroom[socket.id]].indexOf(socket.id);
        rooms[socketroom[socket.id]].splice(index, 1);
        io.to(socketroom[socket.id]).emit('user count', rooms[socketroom[socket.id]].length);
        delete socketroom[socket.id];
    });
});

async function transcribeAudio(audioBuffer) {
    const audio = {
        content: audioBuffer.toString('base64'),
    };

    const config = {
        encoding: 'LINEAR16',
        sampleRateHertz: 16000,
        languageCode: 'en-US', // Adjust language code if necessary
    };

    const request = {
        audio: audio,
        config: config,
    };

    const [response] = await speechClient.recognize(request);
    const transcription = response.results.map(result => result.alternatives[0].transcript).join('\n');
    return transcription;
}

async function translateText(text, sourceLanguage, targetLanguage) {
    const request = {
        parent: `projects/${talksync-412709}`,
        contents: [text],
        mimeType: 'text/plain',
        sourceLanguageCode: sourceLanguage,
        targetLanguageCode: targetLanguage,
    };

    const [response] = await translationClient.translateText(request);
    const translation = response.translations[0].translatedText;
    return translation;
}

server.listen(PORT, () => console.log(`Server is up and running on port ${PORT}`));
