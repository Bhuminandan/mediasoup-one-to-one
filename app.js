// Global imports
import express from 'express';
import https from 'httpolyglot'
import fs from 'fs'
import path from 'path';
import { Server } from 'socket.io';
import mediasoup from 'mediasoup';


// creating express app
const app = express();

const __dirname = path.resolve();

// Normal Route
app.get('/', (req, res) => {
    res.send('Hello World!');
});

// Serving static files
app.use('/sfu', express.static(path.join(__dirname, 'public')));


// HTTPS config
const options = {
    key: fs.readFileSync('./certs/cert.key'),
    cert: fs.readFileSync('./certs/cert.crt'),
}

// Creating HTTPS server
const httpsServer = https.createServer(options, app);

// Starting HTTPS server
httpsServer.listen(3000, () => {
    console.log('Example app listening on port 3000!');
})

// Creating socket.io server
const io = new Server(httpsServer);

// Creating namespace 
// This is done for achieving modularity
const peers = io.of('/mediasoup');

// Global variables
let worker;
let router;
let producerTransport;
let consumerTransport;
let producer
let consumer


// Step 2:  Create Worker
const createWorker = async () => {
    worker = await mediasoup.createWorker({
        rtcMinPort: 3000,
        rtcMaxPort: 3030,
    })

    console.log('worker created', worker.pid, worker.lastError)

    // Listen for worker close event
    worker.on('died', (error) => {
        console.log('worker died, exiting in 2 seconds... [pid: ' + worker.pid + ']')
        setTimeout(() => process.exit(1), 2000) // exit in 2 seconds
    })

    return worker;
}

// Calling createWorker
worker = createWorker();


// Mediacodes for creating router
// https://mediasoup.org/documentation/v3/mediasoup/rtp-parameters-and-capabilities/#RtpCodecParameters
const mediaCodecs = [
    {
      kind: 'audio',
      mimeType: 'audio/opus',
      clockRate: 48000,
      channels: 2,
    },
    {
      kind: 'video',
      mimeType: 'video/VP8',
      clockRate: 90000,
      parameters: {
        'x-google-start-bitrate': 1000,
      },
    },
]
  

// Connection event
peers.on('connection', async (socket) => {

    console.log(socket.id, 'connected');

    // Once the connection is established
    // Connection event itself emit a connection-success
    socket.emit('connection-success', {
        id: socket.id
    })

    // Disconnect event
    socket.on('disconnect', () => {
        console.log(socket.id, 'disconnected');
    })


    // Step 3: Create Router
    // We have to create router once the connection is established
    // While creating router we need to pass mediaCodecs
    // You can learn about mediacodescs in the documentation
    // Link: https://mediasoup.org/documentation/v3/mediasoup/rtp-parameters-and-capabilities/#RtpCodecParameters
    router = await worker.createRouter({ mediaCodecs})

    // Step: 5 Send RTP Capabilities
    // Listen for getRtpCapabilities event
    // Once that emitted provide the rtpCapabilities of the existing router
    socket.on('getRtpCapabilities', (callback) => {
        const rtpCapabilities = router.rtpCapabilities
        // console.log('Server RTP Capabilities', rtpCapabilities)
        callback({rtpCapabilities})
    })

    // Step 9: Create WebRtc Transport
    // If it is a sender then store the webRtcTransport in producerTransport
    // and if it is a consumer then store the webRtcTransport in consumerTransport
    socket.on('createWebRtcTransport', async ({sender}, callback) => {
        console.log("is this a sender request?", sender)

        if (sender) {
            producerTransport = await createWebRtcTransport(callback);
        } else {
            consumerTransport = await createWebRtcTransport(callback);
        }
    })

    // Listening on transport-connect 
    // Getting the 
    socket.on('transport-connect', async ({ dtlsParameters }) => {

        console.log('DTLS params', dtlsParameters);

        // after calling the connect and passing with the DTLS parameters
        // The produce event will be triggered 
        await producerTransport.connect({ dtlsParameters });
    })

    // Listening on transport-produce
    socket.on('transport-produce', async ({ kind, rtpParameters, appData }, callback) => {
        producer = await producerTransport.produce({
            kind,
            rtpParameters,
            appData
        })

        console.log("ProducerId", producer.id, producer.kind);

        // Once the produce is done close the transport
        producer.on('transportclose', () => {
            console.log("Transport for the producer is closed");
            producer.close();
        })

        // Send the producer id to the client
        callback({
            id: producer.id
        })
    })

    // Listening on transport-recv-connect
    // Passing the DTLS parameters
    socket.on('transport-recv-connect', async ({ dtlsParameters }) => {
        console.log("DTLS params", dtlsParameters);

        // This will trigger the consume event
        await consumerTransport.connect({ dtlsParameters });
    })

    socket.on('consume', async ({ rtpCapabilities }, callback) => {
        try {

            // Check if the consumer can consume
            // If it can then create the consumer
            if (router.canConsume({
                producerId: producer.id,
                rtpCapabilities
            })) {
                consumer = await consumerTransport.consume({
                    producerId: producer.id,
                    rtpCapabilities,
                    paused: true, // Mentioned in the docs while creating the consumer, add paused: true
                    // Some times consuming a video fails (video is not loaded) if I consume the video as paused = false .
                    // Thats why it is recommended to consume the video as paused = true
                    // We have to resume it once the video is loaded
                })

                // Listening on transportclose
                consumer.on('transportclose', () => {
                    console.log("Transport for the consumer is closed");
                })

                // Listening on producerclose
                consumer.on('producerclose', () => {
                    console.log("Producer for the consumer is closed");
                })

                const params = {
                    id: consumer.id,
                    producerId: consumer.producerId,
                    kind: consumer.kind,
                    rtpParameters: consumer.rtpParameters
                }

                callback({
                    params
                })
            }
            
        } catch (error) {
            console.log(error.message)
            callback({
                params: {
                    error: error
                }
            })
        }
    })

    // Resuming the consumer
    // We are gonna call this event when the video is loaded
    // From the client side 
    socket.on('consumer-resume', async () => {
        console.log('Resuming consumer');
        await consumer.resume();
    })
    
});

// Step 10: Create WebRtc Transport Method
// Method for creating WebRtc Transport
const createWebRtcTransport = async (callback) => {

    try {
        
        // Learn more about these options here:
        // https://mediasoup.org/documentation/v3/mediasoup/api/#Router-methods
        const webRtcTransport_options = {
            listenIps: [
              {
                ip: '0.0.0.0', // replace with relevant IP address
                announcedIp: '127.0.0.1',
              }
            ],
            enableUdp: true,
            enableTcp: true,
            preferUdp: true,
          };

        // Creating the WebRtc Transport
        const transport = await router.createWebRtcTransport(webRtcTransport_options);
        console.log('Transport id', transport.id);

        // Listening for transport's events
        // Datagram Transport Layer Security (DTLS) is a protocol that uses TLS to secure datagram transport
        // If you abruptly close the client, the PeerConnection in the browser may send a DTLS Close alert.
        // If we got that alert we are going to close the transport
        // Closing the transport helps in cleaning up the PeerConnection
        transport.on('dtlsstatechange', (dtlsState) => {
            if (dtlsState === 'closed') {
                transport.close();
            }
        });

        // Listening for transport's close event
        // incase of abrupt closure
        transport.on('close', () => {
            console.log('Transport closed');
        })

        // Sending the data back to the client
        callback({
            params: {
                id: transport.id,
                iceParameters: transport.iceParameters,
                iceCandidates: transport.iceCandidates,
                dtlsParameters: transport.dtlsParameters,
            }
        })

        // Here we are returning the transport because we need it in createSendTransport
        // to store them in local variables like producerTransport and consumerTransport
        return transport;

    } catch (error) {
        console.log(error);

        callback({
            params: {
                error: error
            }
        })
    }
}