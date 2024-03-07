import express from 'express';
const app = express();


import https from 'httpolyglot'
import fs from 'fs'
import path from 'path';
const __dirname = path.resolve();


import { Server } from 'socket.io';
import mediasoup from 'mediasoup';


app.get('/', (req, res) => {
    res.send('Hello World!');
});

app.use('/sfu', express.static(path.join(__dirname, 'public')));

const options = {
    key: fs.readFileSync('./certs/cert.key'),
    cert: fs.readFileSync('./certs/cert.crt'),
}


const httpsServer = https.createServer(options, app);

httpsServer.listen(3000, () => {
    console.log('Example app listening on port 3000!');
})


const io = new Server(httpsServer);

const peers = io.of('/mediasoup');

let worker;
let router;
let producerTransport;
let consumerTransport;
let producer
let consumer

const createWorker = async () => {
    worker = await mediasoup.createWorker({
        rtcMinPort: 3000,
        rtcMaxPort: 3030,
    })

    console.log('worker created', worker.pid, worker.lastError)

    worker.on('died', (error) => {
        console.log('worker died, exiting in 2 seconds... [pid: ' + worker.pid + ']')
        setTimeout(() => process.exit(1), 2000) // exit in 2 seconds
    })

    return worker;
}


worker = createWorker();

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
  

peers.on('connection', async (socket) => {
    console.log(socket.id, 'connected');

    socket.emit('connection-success', {
        id: socket.id
    })

    socket.on('disconnect', () => {
        console.log(socket.id, 'disconnected');
    })

    router = await worker.createRouter({ mediaCodecs})

    socket.on('getRtpCapabilities', (callback) => {
        const rtpCapabilities = router.rtpCapabilities
        // console.log('Server RTP Capabilities', rtpCapabilities)
        callback({rtpCapabilities})
    })

    socket.on('createWebRtcTransport', async ({sender}, callback) => {
        console.log("is this a sender request?", sender)

        if (sender) {
            producerTransport = await createWebRtcTransport(callback);
        } else {
            consumerTransport = await createWebRtcTransport(callback);
        }
    })

    socket.on('transport-connect', async ({ dtlsParameters }) => {

        console.log('DTLS params', dtlsParameters);

        await producerTransport.connect({ dtlsParameters });
    })

    socket.on('transport-produce', async ({ kind, rtpParameters, appData }, callback) => {
        producer = await producerTransport.produce({
            kind,
            rtpParameters,
            appData
        })

        console.log("ProducerId", producer.id, producer.kind);

        producer.on('transportclose', () => {
            console.log("Transport for the producer is closed");
            producer.close();
        })

        callback({
            id: producer.id
        })
    })

    socket.on('transport-recv-connect', async ({ dtlsParameters }) => {
        console.log("DTLS params", dtlsParameters);
        await consumerTransport.connect({ dtlsParameters });
    })

    socket.on('consume', async ({ rtpCapabilities }, callback) => {
        try {

            if (router.canConsume({
                producerId: producer.id,
                rtpCapabilities
            })) {
                consumer = await consumerTransport.consume({
                    producerId: producer.id,
                    rtpCapabilities,
                    paused: true,
                })

                consumer.on('transportclose', () => {
                    console.log("Transport for the consumer is closed");
                })

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

    socket.on('consumer-resume', async () => {
        console.log('Resuming consumer');
        await consumer.resume();
    })
    
});


const createWebRtcTransport = async (callback) => {

    try {
        
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

        const transport = await router.createWebRtcTransport(webRtcTransport_options);
        console.log('Transport id', transport.id);

        transport.on('dtlsstatechange', (dtlsState) => {
            if (dtlsState === 'closed') {
                transport.close();
            }
        });

        transport.on('close', () => {
            console.log('Transport closed');
        })

        callback({
            params: {
                id: transport.id,
                iceParameters: transport.iceParameters,
                iceCandidates: transport.iceCandidates,
                dtlsParameters: transport.dtlsParameters,
            }
        })

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